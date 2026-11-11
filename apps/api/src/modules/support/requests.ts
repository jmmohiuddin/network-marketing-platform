import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { currentAuth } from '../../lib/auth.js'
import { ApiError } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { getSession, type ScopePermission, type SessionScope, type SupportSessionView } from './sessions.js'
import { assertSameRequest, type VendorIdempotency } from './vendor-idempotency.js'
import { inVendorThenTenant, lockTenant } from './vendor-tx.js'

export interface SessionRequest {
  readonly tenantId: string
  readonly reason: string
  readonly permissions: readonly ScopePermission[]
  readonly minutes: number
}

export interface RequestOutcome {
  readonly session: SupportSessionView
  readonly replayed: boolean
}

// Support needs a tenant whose staff can decide: not while provisioning, not once archived.
const SUPPORTED_TENANT_STATES = new Set(['implementation', 'live'])

interface Filed {
  readonly tenantId: string
  readonly id: string
  readonly replayed: boolean
}

async function findByKey(tx: Tx, requesterId: string, key: string) {
  const { rows } = await tx.query<{ id: string; tenant_id: string; request_hash: Buffer }>(
    'SELECT id, tenant_id, request_hash FROM support_session WHERE requester_id = $1 AND idempotency_key = $2',
    [requesterId, key],
  )
  return rows[0]
}

async function replay(tx: Tx, requesterId: string, idempotency: VendorIdempotency): Promise<Filed | null> {
  const stored = await findByKey(tx, requesterId, idempotency.key)
  if (stored === undefined) return null
  assertSameRequest(stored.request_hash, idempotency)
  return { tenantId: stored.tenant_id, id: stored.id, replayed: true }
}

// Region-bound sessions (AC-31.1, TS-57): the requester's region is what vendor operations recorded for the user,
// never what the request says; unknown (NULL) is out of every tenant's region, so the decider must approve it.
async function requestScope(tx: Tx, requesterId: string, input: SessionRequest): Promise<SessionScope> {
  const { rows } = await tx.query<{ work_region: string | null }>('SELECT work_region FROM user_account WHERE id = $1', [requesterId])
  return { permissions: [...input.permissions], requester_region: rows[0]?.work_region ?? null }
}

// Inserted in the vendor realm, so policy vendor_request checks it: state requested, no decision, no window,
// requester a vendor user. A concurrent request with the same key waits here until the first commits (then
// nothing is inserted and the caller replays) or rolls back (then this one is inserted).
async function insertRequest(tx: Tx, requesterId: string, input: SessionRequest, idempotency: VendorIdempotency) {
  const scope = await requestScope(tx, requesterId, input)
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO support_session (tenant_id, requester_id, reason, scope, requested_minutes, state, created_by,
       idempotency_key, request_hash)
     VALUES ($1, $2, $3, $4, $5, 'requested', $2, $6, $7)
     ON CONFLICT (requester_id, idempotency_key) DO NOTHING RETURNING id`,
    [input.tenantId, requesterId, input.reason, scope, input.minutes, idempotency.key, idempotency.hash],
  )
  return rows[0]?.id ?? null
}

async function fileRequest(tx: Tx, requesterId: string, input: SessionRequest, idempotency: VendorIdempotency): Promise<Filed> {
  const earlier = await replay(tx, requesterId, idempotency)
  if (earlier !== null) return earlier
  const tenant = await lockTenant(tx, input.tenantId)
  if (!SUPPORTED_TENANT_STATES.has(tenant.state)) {
    throw new ApiError(422, 'TENANT_NOT_AVAILABLE', 'Support sessions are available only for tenants in implementation or live.')
  }
  const id = await insertRequest(tx, requesterId, input, idempotency)
  if (id === null) return (await replay(tx, requesterId, idempotency))!
  await recordVendorAudit(tx, {
    action: 'SUPPORT_SESSION.REQUESTED', objectType: 'support_session', objectId: id,
    after: { tenant_id: tenant.id, minutes: input.minutes, permissions: input.permissions },
  })
  return { tenantId: tenant.id, id, replayed: false }
}

// FR-IAM-005 pre-condition: someone in the tenant can decide the request.
// shortcut: reads iam's role_assignment, role and user_account directly (iam/index.ts exports no "users holding a
// permission" facade); call that facade once iam exports one.
async function assertDeciderExists(tx: Tx): Promise<void> {
  const { rows } = await tx.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM role_assignment ra JOIN role r ON r.id = ra.role_id JOIN user_account u ON u.id = ra.user_id
       WHERE u.state = 'active' AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())
         AND 'vendor_access.decide' = ANY (r.permissions)) AS exists`,
  )
  if (rows[0]?.exists !== true) {
    throw new ApiError(422, 'TENANT_HAS_NO_ADMIN', 'Nobody in this tenant can decide a support request yet.')
  }
}

/**
 * API-08 request (vendor): the request is filed in the vendor realm and logged there, then the same
 * transaction logs it in the tenant's audit log and notifies the tenant's admins (outbox). The tenant id in
 * the body is allowed here only (API C-8) and is checked against an existing tenant.
 */
export function requestSession(request: FastifyRequest, input: SessionRequest, idempotency: VendorIdempotency): Promise<RequestOutcome> {
  const requesterId = currentAuth(request).userId
  return inVendorThenTenant(
    request,
    (tx) => fileRequest(tx, requesterId, input, idempotency),
    async (tx, filed) => {
      if (!filed.replayed) {
        await assertDeciderExists(tx)
        await recordAudit(tx, {
          action: 'SUPPORT_SESSION.REQUESTED', objectType: 'support_session', objectId: filed.id,
          after: { minutes: input.minutes, permissions: input.permissions }, reason: input.reason,
        })
        await enqueueOutbox(tx, { type: 'support_session.requested', key: filed.id, payload: { support_session_id: filed.id } })
      }
      return { session: await getSession(tx, filed.id), replayed: filed.replayed }
    },
  )
}
