import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { currentAuth } from '../../lib/auth.js'
import { ApiError } from '../../lib/errors.js'
import { defineTenantJob, enqueue } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { assertSecondPerson } from '../iam/index.js'
import { assertSameRequest, inVendorThenTenant, lockTenant, type VendorIdempotency } from '../support/index.js'

/** What the vendor sees of an offboarding (SC-39): dates and blocker counts, never the ids of tenant data. */
export interface VendorOffboardingView {
  id: string
  state: string
  requested_at: Date
  confirmed_at: Date | null
  archived_at: Date | null
  retain_until: string | null
  purge_requested_by: string | null
  blockers: { kind: string; blocking: boolean; count: number }[]
}

interface OffboardingRow {
  id: string
  state: string
  purge_requested_by: string | null
  retain_until: string | null
}

const VIEW_SELECT = `
  SELECT id, state, requested_at, confirmed_at, archived_at, to_char(retain_until, 'YYYY-MM-DD') AS retain_until, purge_requested_by
  FROM tenant_offboarding`

/** The tenant's latest offboarding record with blocker counts, or null. Vendor realm (offboarding_blockers gives no ids there). */
export async function vendorOffboardingView(tx: Tx, tenantId: string): Promise<VendorOffboardingView | null> {
  const { rows } = await tx.query<Omit<VendorOffboardingView, 'blockers'>>(
    `${VIEW_SELECT} WHERE tenant_id = $1 ORDER BY requested_at DESC, id DESC LIMIT 1`, [tenantId],
  )
  if (rows[0] === undefined) return null
  const blockers = await tx.query<{ kind: string; blocking: boolean; count: number }>(
    'SELECT kind, blocking, count::int AS count FROM offboarding_blockers($1)', [tenantId],
  )
  return { ...rows[0], blockers: blockers.rows }
}

async function lockOpen(tx: Tx, tenantId: string): Promise<OffboardingRow | undefined> {
  const { rows } = await tx.query<OffboardingRow>(
    `SELECT id, state, purge_requested_by, to_char(retain_until, 'YYYY-MM-DD') AS retain_until FROM tenant_offboarding
     WHERE tenant_id = $1 AND state NOT IN ('purged', 'cancelled', 'restored') FOR UPDATE`,
    [tenantId],
  )
  return rows[0]
}

const stateRefusal = (state: string | null): ApiError =>
  new ApiError(409, 'OFFBOARDING_STATE', state === null ? 'No offboarding is open.' : `The offboarding is ${state}; this step is not possible.`, { state })

/** The SQL guard's refusals (DETAIL of its check_violation) as API errors; the blocker list carries counts only. */
async function guardRefusal(tx: Tx, tenantId: string, offboarding: OffboardingRow, error: unknown): Promise<ApiError | null> {
  const detail = (error as { detail?: unknown } | null)?.detail
  if (detail === 'export_required') {
    return new ApiError(422, 'EXPORT_REQUIRED', 'Name a completed full export made after the confirmation.')
  }
  if (detail === 'retention_not_elapsed') {
    return new ApiError(409, 'RETENTION_NOT_ELAPSED', 'The retention period has not passed.', { retain_until: offboarding.retain_until })
  }
  if (detail === 'legal_hold_present') return new ApiError(409, 'LEGAL_HOLD_PRESENT', 'A legal hold is active in this tenant.')
  if (detail === 'offboarding_blocked') {
    const view = await vendorOffboardingView(tx, tenantId)
    return new ApiError(409, 'OFFBOARDING_BLOCKED', 'The tenant still has blocking items.', {
      blockers: view?.blockers.filter((blocker) => blocker.count > 0) ?? [],
    })
  }
  return null
}

interface Step {
  /** Audit action suffix: OFFBOARDING.<action>. */
  readonly action: string
  readonly from: readonly string[]
  /** SET clause of the update; $1 = offboarding id, $2 = acting vendor user, $3 = the export id (archive only). */
  readonly set: string
  /** Checks on the locked record before the update (refusals). */
  readonly before?: (tx: Tx, offboarding: OffboardingRow, actorId: string) => Promise<void>
}

export const OFFBOARDING_STEPS = {
  archive: { action: 'ARCHIVED', from: ['confirmed'], set: `state = 'archived', export_id = $3::uuid, archived_by = $2, archived_at = now()` },
  restore: { action: 'RESTORED', from: ['archived', 'purge_requested'], set: `state = 'restored', closed_by = $2, closed_at = now()` },
  'purge-request': {
    action: 'PURGE_REQUESTED', from: ['archived'], set: `state = 'purge_requested', purge_requested_by = $2, purge_requested_at = now()`,
  },
  'purge-approve': {
    action: 'PURGE_APPROVED', from: ['purge_requested'], set: `state = 'purge_approved', purge_approved_by = $2, purge_approved_at = now()`,
    // E-ADR-31: an independent second vendor user (assert_vendor_second_person backs it in the guard).
    before: (tx, offboarding, actorId) =>
      assertSecondPerson(tx, { actorId, initiatorId: offboarding.purge_requested_by, action: 'OFFBOARDING.PURGE_APPROVED' }),
  },
  cancel: { action: 'CANCELLED', from: ['requested', 'confirmed'], set: `state = 'cancelled', closed_by = $2, closed_at = now()` },
} as const satisfies Record<string, Step>

export type OffboardingStep = keyof typeof OFFBOARDING_STEPS

/**
 * One vendor step of D-V1A-07 on the tenant's open offboarding, in the vendor log and the tenant's log (one transaction,
 * E-ADR-21). Archive and restore move the tenant's state by trigger.
 */
export function moveOffboarding(
  request: FastifyRequest, tenantId: string, step: OffboardingStep, exportId?: string,
): Promise<VendorOffboardingView> {
  const definition: Step = OFFBOARDING_STEPS[step]
  const actorId = currentAuth(request).userId
  return inVendorThenTenant(
    request,
    async (tx) => {
      await lockTenant(tx, tenantId)
      const open = await lockOpen(tx, tenantId)
      if (open === undefined || !definition.from.includes(open.state)) throw stateRefusal(open?.state ?? null)
      await definition.before?.(tx, open, actorId)
      if (step === 'archive') {
        // Blocking items first: the guard reports them and a missing export under one DETAIL.
        const view = await vendorOffboardingView(tx, tenantId)
        const blocking = view?.blockers.filter((blocker) => blocker.blocking && blocker.count > 0) ?? []
        if (blocking.length > 0) throw new ApiError(409, 'OFFBOARDING_BLOCKED', 'The tenant still has blocking items.', { blockers: blocking })
      }
      try {
        await tx.query('SAVEPOINT offboarding_step')
        await tx.query(`UPDATE tenant_offboarding SET ${definition.set} WHERE id = $1`,
          exportId === undefined ? [open.id, actorId] : [open.id, actorId, exportId])
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT offboarding_step')
        throw (await guardRefusal(tx, tenantId, open, error)) ?? error
      }
      const event = { action: `OFFBOARDING.${definition.action}`, objectType: 'tenant_offboarding', objectId: open.id, before: { state: open.state } }
      await recordVendorAudit(tx, { ...event, after: { tenant_id: tenantId } })
      return { tenantId, event, view: (await vendorOffboardingView(tx, tenantId))! }
    },
    async (tx, moved) => {
      await recordAudit(tx, moved.event)
      return moved.view
    },
  )
}

// Vendor creating POSTs keep their Idempotency-Key with what they create (support/vendor-idempotency.ts); the
// offboarding record has no such columns, so the key and request hash travel in the REQUESTED vendor event.
// shortcut: replay looks the key up in audit.vendor_event; give tenant_offboarding key columns if a second vendor route needs it.
async function replayOf(tx: Tx, actorId: string, idempotency: VendorIdempotency): Promise<string | null> {
  const { rows } = await tx.query<{ tenant_id: string; request_sha256: string }>(
    `SELECT after_ref::jsonb -> 'after' ->> 'tenant_id' AS tenant_id, after_ref::jsonb -> 'after' ->> 'request_sha256' AS request_sha256
     FROM audit.vendor_event
     WHERE actor_id = $1 AND action = 'OFFBOARDING.REQUESTED' AND after_ref::jsonb -> 'after' ->> 'idempotency_key' = $2`,
    [actorId, idempotency.key],
  )
  if (rows[0] === undefined) return null
  assertSameRequest(Buffer.from(rows[0].request_sha256, 'hex'), idempotency)
  return rows[0].tenant_id
}

export interface RequestedOffboarding {
  readonly offboarding: VendorOffboardingView
  readonly replayed: boolean
}

/** POST /v1/tenants/:id/offboarding: the vendor asks a live or implementation tenant to confirm its offboarding (mailed to its admins). */
export function requestOffboarding(
  request: FastifyRequest, tenantId: string, reason: string, idempotency: VendorIdempotency,
): Promise<RequestedOffboarding> {
  const actorId = currentAuth(request).userId
  return inVendorThenTenant(
    request,
    async (tx) => {
      const tenant = await lockTenant(tx, tenantId)
      const earlier = await replayOf(tx, actorId, idempotency)
      if (earlier !== null) return { tenantId: earlier, created: null, view: (await vendorOffboardingView(tx, earlier))! }
      if (tenant.state !== 'live' && tenant.state !== 'implementation') {
        throw new ApiError(409, 'TENANT_STATE', `The tenant is ${tenant.state}; only a live or implementation tenant is offboarded.`, { state: tenant.state })
      }
      if ((await lockOpen(tx, tenantId)) !== undefined) throw new ApiError(409, 'OFFBOARDING_OPEN', 'The tenant already has an open offboarding.')
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO tenant_offboarding (tenant_id, state, reason, previous_state, requested_by)
         VALUES ($1, 'requested', $2, $3, $4) RETURNING id`,
        [tenantId, reason, tenant.state, actorId],
      )
      const id = rows[0]!.id
      await recordVendorAudit(tx, {
        action: 'OFFBOARDING.REQUESTED', objectType: 'tenant_offboarding', objectId: id,
        after: { tenant_id: tenantId, idempotency_key: idempotency.key, request_sha256: idempotency.hash.toString('hex') },
      })
      // Read in the vendor realm: in the tenant realm offboarding_blockers would return ids.
      return { tenantId, created: id, view: (await vendorOffboardingView(tx, tenantId))! }
    },
    async (tx, requested) => {
      if (requested.created !== null) {
        await recordAudit(tx, { action: 'OFFBOARDING.REQUESTED', objectType: 'tenant_offboarding', objectId: requested.created })
        await enqueue(tx, offboardingRequestedMailJob, { offboarding_id: requested.created })
      }
      return { offboarding: requested.view, replayed: requested.created === null }
    },
  )
}

/** D-V1A-07: the tenant's active Tenant admins learn of the request by mail (MAIL_DIR); they review it on SC-29. */
export const offboardingRequestedMailJob = defineTenantJob({
  name: 'ops.offboarding.requested-mail',
  payload: z.strictObject({ offboarding_id: z.uuid() }),
  async run(tx, payload, ctx) {
    const { rows } = await tx.query<{ email: string; legal_name: string; reason: string; state: string }>(
      `SELECT DISTINCT u.email, t.legal_name, o.reason, o.state
       FROM tenant_offboarding o JOIN tenant t ON t.id = o.tenant_id
       JOIN user_account u ON u.tenant_id = o.tenant_id AND u.realm = 'tenant' AND u.state = 'active'
       JOIN role_assignment ra ON ra.user_id = u.id AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())
       JOIN role r ON r.id = ra.role_id AND r.name = 'Tenant admin'
       WHERE o.id = $1 ORDER BY u.email`,
      [payload.offboarding_id],
    )
    for (const admin of rows.filter((row) => row.state === 'requested')) {
      await sendMail(ctx.config.mailDir, {
        to: admin.email,
        subject: `Offboarding of ${admin.legal_name} requested`,
        text: [
          `The platform operator asked to offboard and archive ${admin.legal_name}.`,
          `Reason given: ${admin.reason}`,
          '',
          `Review the open items and confirm or cancel under Settings: ${ctx.config.webUrl}/settings`,
          'Once confirmed, the account becomes read-only: you can read and export, not change data.',
        ].join('\n'),
      })
    }
  },
})
