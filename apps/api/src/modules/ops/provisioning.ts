import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { currentAuth } from '../../lib/auth.js'
import { ApiError } from '../../lib/errors.js'
import { enqueue } from '../../lib/jobs.js'
import { assertSecondPerson } from '../iam/index.js'
import { assertBreachContactRecorded } from '../prv/index.js'
import { assertSameRequest, inVendorThenTenant, lockTenant, type TenantRow, type VendorIdempotency } from '../support/index.js'
import { sendFirstAdminInvitationJob } from './first-admin-invitation.js'
import { createTenantRows, grantFirstAdminRole, insertTenant, type NewTenant } from './tenant-creation.js'
import { getTenant, type TenantDetail } from './tenants.js'

export interface CreatedTenant {
  readonly tenant: TenantDetail
  readonly replayed: boolean
}

/**
 * FR-TEN-001 step 1 (vendor ops): the tenant in state provisioning with its routing entry, markets and first
 * admin (invited, Tenant admin role), logged in the vendor log and the new tenant's log, one transaction.
 * Nothing reaches the first admin until a second vendor user approves (approveProvisioning).
 */
export function createTenant(request: FastifyRequest, input: NewTenant, idempotency: VendorIdempotency): Promise<CreatedTenant> {
  const creatorId = currentAuth(request).userId
  return inVendorThenTenant(
    request,
    (tx) => insertTenant(tx, creatorId, input, idempotency),
    async (tx, created) => {
      if (!created.replayed) await createTenantRows(tx, created.tenantId, input)
      return { tenant: await getTenant(tx, created.tenantId), replayed: created.replayed }
    },
  )
}

interface Transition {
  readonly from: string
  readonly to: string
  readonly action: string
  /** Vendor-side step on the locked tenant in the expected state, before its state changes (checks, actor column). */
  readonly before?: (tx: Tx, tenant: TenantRow) => Promise<void>
}

const tenantChange = (tenantId: string, transition: Transition) => ({
  action: transition.action, objectType: 'tenant', objectId: tenantId, before: { state: transition.from }, after: { state: transition.to },
})

// The tenant table belongs to the vendor realm: the state changes there, logged in the vendor log.
async function moveState(tx: Tx, tenantId: string, transition: Transition): Promise<{ tenantId: string }> {
  const tenant = await lockTenant(tx, tenantId)
  if (tenant.state !== transition.from) {
    throw new ApiError(409, 'TENANT_STATE_INVALID', `The tenant is ${tenant.state}; this step needs ${transition.from}.`)
  }
  await transition.before?.(tx, tenant)
  await tx.query('UPDATE tenant SET state = $2 WHERE id = $1', [tenant.id, transition.to])
  await recordVendorAudit(tx, tenantChange(tenant.id, transition))
  return { tenantId: tenant.id }
}

export interface ApprovedTenant {
  readonly tenant: TenantDetail
  readonly replayed: boolean
}

const UNIQUE_VIOLATION = '23505'

// TR-API-13: the same approver retrying with the same key gets the tenant as it is now, not 409.
async function approvalReplay(tx: Tx, approverId: string, idempotency: VendorIdempotency): Promise<string | null> {
  const { rows } = await tx.query<{ id: string; approval_request_hash: Buffer }>(
    'SELECT id, approval_request_hash FROM tenant WHERE approved_by = $1 AND approval_idempotency_key = $2',
    [approverId, idempotency.key],
  )
  if (rows[0] === undefined) return null
  assertSameRequest(rows[0].approval_request_hash, idempotency)
  return rows[0].id
}

// approved_by is set while the tenant is still provisioning, then the state moves (0043 checks both on the row).
async function recordApprover(tx: Tx, tenantId: string, approverId: string, idempotency: VendorIdempotency): Promise<void> {
  try {
    await tx.query(
      'UPDATE tenant SET approved_by = $2, approval_idempotency_key = $3, approval_request_hash = $4 WHERE id = $1',
      [tenantId, approverId, idempotency.key, idempotency.hash],
    )
  } catch (error) {
    // The same key is being used at this moment to approve another tenant.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw keyReused()
    throw error
  }
}

const keyReused = (): ApiError =>
  new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.')

// Vendor part: the tenant locked first, so a retry that raced the original waits for it and then replays it.
async function approveInVendorRealm(
  tx: Tx, tenantId: string, transition: Transition, approverId: string, idempotency: VendorIdempotency,
): Promise<{ tenantId: string; replayed: boolean }> {
  await lockTenant(tx, tenantId)
  const earlier = await approvalReplay(tx, approverId, idempotency)
  if (earlier !== null) return { tenantId: earlier, replayed: true }
  await moveState(tx, tenantId, {
    ...transition,
    before: async (stepTx, tenant) => {
      await assertSecondPerson(stepTx, { actorId: approverId, initiatorId: tenant.created_by, action: transition.action })
      await recordApprover(stepTx, tenant.id, approverId, idempotency)
    },
  })
  return { tenantId, replayed: false }
}

// Tenant part: the first admin's role takes effect now, granted by the second person, and the invitation is queued.
async function activateFirstAdmins(tx: Tx, tenantId: string, transition: Transition, approverId: string): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(`SELECT id FROM user_account WHERE state = 'invited' ORDER BY id`)
  for (const { id } of rows) {
    await grantFirstAdminRole(tx, id)
    await enqueue(tx, sendFirstAdminInvitationJob, { user_id: id, invited_by: approverId })
  }
  await recordAudit(tx, tenantChange(tenantId, transition))
}

/**
 * FR-TEN-001 second-person approval (step-up checked by the route, Idempotency-Key required): a vendor user other
 * than the creator and not tied to them (BUG-031) moves the tenant to implementation, grants the first admin Tenant admin and queues the
 * invitation. Any failure rolls the whole step back, so the tenant stays in provisioning and can be approved again.
 */
export function approveProvisioning(request: FastifyRequest, tenantId: string, idempotency: VendorIdempotency): Promise<ApprovedTenant> {
  const approverId = currentAuth(request).userId
  const transition: Transition = { from: 'provisioning', to: 'implementation', action: 'TENANT.PROVISIONING_APPROVED' }
  return inVendorThenTenant(
    request,
    (tx) => approveInVendorRealm(tx, tenantId, transition, approverId, idempotency),
    async (tx, approved) => {
      if (!approved.replayed) await activateFirstAdmins(tx, tenantId, transition, approverId)
      return { tenant: await getTenant(tx, approved.tenantId), replayed: approved.replayed }
    },
  )
}

/**
 * Go-live (implementation -> live): blocked until a breach contact is recorded (AC-53.1, MVP_A C-21). A second-person
 * step (BUG-031): not the tenant's creator nor anyone tied to them; recorded as went_live_by.
 */
export function goLive(request: FastifyRequest, tenantId: string): Promise<TenantDetail> {
  const actorId = currentAuth(request).userId
  const transition: Transition = {
    from: 'implementation', to: 'live', action: 'TENANT.WENT_LIVE',
    before: async (tx, tenant) => {
      await assertSecondPerson(tx, { actorId, initiatorId: tenant.created_by, action: 'TENANT.WENT_LIVE' })
      await tx.query('UPDATE tenant SET went_live_by = $2 WHERE id = $1', [tenant.id, actorId])
    },
  }
  return inVendorThenTenant(
    request,
    (tx) => moveState(tx, tenantId, transition),
    async (tx) => {
      await assertBreachContactRecorded(tx)
      await recordAudit(tx, tenantChange(tenantId, transition))
      return getTenant(tx, tenantId)
    },
  )
}
