import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requireAllMarkets, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { pgDetail } from './pg.js'

/** One offboarding item (SQL offboarding_blockers): the tenant realm sees the first 20 ids, the vendor counts only. */
interface Blocker {
  kind: string
  blocking: boolean
  count: number
  ids: string[] | null
}

interface OffboardingView {
  id: string
  state: string
  reason: string
  requested_at: Date
  confirmed_at: Date | null
  retention_basis: string | null
  retention_months: number | null
  retain_until: string | null
  archived_at: Date | null
  export_id: string | null
}

// The record that is not finished: requested, confirmed, archived, purge requested or approved (D-V1A-07).
const OPEN_SELECT = `
  SELECT id, state, reason, requested_at, confirmed_at, retention_basis, retention_months,
         to_char(retain_until, 'YYYY-MM-DD') AS retain_until, archived_at, export_id
  FROM tenant_offboarding WHERE state NOT IN ('purged', 'cancelled', 'restored')`

async function openOffboarding(tx: Tx, lock: boolean): Promise<OffboardingView | undefined> {
  const { rows } = await tx.query<OffboardingView>(`${OPEN_SELECT}${lock ? ' FOR UPDATE' : ''}`)
  return rows[0]
}

async function blockersOf(tx: Tx): Promise<Blocker[]> {
  const { rows } = await tx.query<Blocker>(
    'SELECT kind, blocking, count::int AS count, ids FROM offboarding_blockers(app_tenant_id())',
  )
  return rows
}

const WARNING_KINDS = ['credits_outstanding'] as const
const confirmBody = z.strictObject({
  retention_basis: z.string().trim().min(1).max(2000),
  retention_months: z.number().int().min(1).max(240),
  acknowledged_warnings: z.array(z.enum(WARNING_KINDS)).max(WARNING_KINDS.length),
})

const stateRefusal = (state: string | null): ApiError =>
  new ApiError(409, 'OFFBOARDING_STATE', state === null ? 'No offboarding is open.' : `The offboarding is ${state}; this step is not possible.`, { state })

async function requested(tx: Tx, allowed: readonly string[]): Promise<OffboardingView> {
  const open = await openOffboarding(tx, true)
  if (open === undefined || !allowed.includes(open.state)) throw stateRefusal(open?.state ?? null)
  return open
}

/** AC-TEN5-1: confirmed only with no blocking item and every warning with a count acknowledged. */
async function confirm(tx: Tx, userId: string, body: z.infer<typeof confirmBody>): Promise<OffboardingView> {
  const open = await requested(tx, ['requested'])
  const blockers = await blockersOf(tx)
  if (blockers.some((blocker) => blocker.blocking && blocker.count > 0)) {
    throw new ApiError(409, 'OFFBOARDING_BLOCKED', 'Close the blocking items before confirming the offboarding.', {
      blockers: blockers.filter((blocker) => blocker.count > 0),
    })
  }
  const missing = blockers.filter((blocker) => !blocker.blocking && blocker.count > 0 && !body.acknowledged_warnings.includes(blocker.kind as never))
  if (missing.length > 0) {
    throw new ApiError(422, 'WARNING_NOT_ACKNOWLEDGED', 'Acknowledge every warning before confirming.', { kinds: missing.map((blocker) => blocker.kind) })
  }
  try {
    await tx.query(
      `UPDATE tenant_offboarding SET state = 'confirmed', confirmed_by = $2, confirmed_at = now(), retention_basis = $3,
         retention_months = $4, acknowledged_warnings = $5 WHERE id = $1`,
      [open.id, userId, body.retention_basis, body.retention_months, body.acknowledged_warnings],
    )
  } catch (error) {
    // A blocking item appeared after the check above (the guard re-checks at the update).
    if (pgDetail(error) === 'offboarding_blocked') {
      throw new ApiError(409, 'OFFBOARDING_BLOCKED', 'Close the blocking items before confirming the offboarding.', { blockers: await blockersOf(tx) })
    }
    throw error
  }
  await recordAudit(tx, {
    action: 'OFFBOARDING.CONFIRMED', objectType: 'tenant_offboarding', objectId: open.id,
    after: { retention_months: body.retention_months, acknowledged_warnings: body.acknowledged_warnings },
  })
  return (await openOffboarding(tx, false))!
}

async function cancel(tx: Tx, userId: string): Promise<{ id: string; state: 'cancelled' }> {
  const open = await requested(tx, ['requested', 'confirmed'])
  await tx.query(`UPDATE tenant_offboarding SET state = 'cancelled', closed_by = $2, closed_at = now() WHERE id = $1`, [open.id, userId])
  await recordAudit(tx, { action: 'OFFBOARDING.CANCELLED', objectType: 'tenant_offboarding', objectId: open.id, before: { state: open.state } })
  return { id: open.id, state: 'cancelled' }
}

/** FR-TEN-005 tenant side (D-V1A-07, SC-29): the Tenant admin sees the vendor's request with its blockers, confirms or cancels. */
export function registerOffboardingRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission('tenant.offboard'), requireAllMarkets('tenant.offboard')] }
  const write = { preHandler: [...read.preHandler, requireStepUp()] }

  app.get('/v1/offboarding', read, async (request) =>
    envelope(await inTenant(request, async (tx) => ({ offboarding: (await openOffboarding(tx, false)) ?? null, blockers: await blockersOf(tx) }))))

  app.post('/v1/offboarding/confirm', write, async (request) => {
    const body = parse(confirmBody, request.body)
    return envelope(await inTenant(request, (tx) => confirm(tx, currentAuth(request).userId, body)))
  })

  // Allowed while read-only (lib/tenant-state.ts): a confirmed offboarding can still be called off.
  app.post('/v1/offboarding/cancel', write, async (request) =>
    envelope(await inTenant(request, (tx) => cancel(tx, currentAuth(request).userId))))
}
