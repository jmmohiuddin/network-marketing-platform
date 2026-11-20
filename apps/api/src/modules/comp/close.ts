import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { createJournalExport, lockLedger, unmappedAccountTypes } from '../led/index.js'
import { periodInScope } from './period.js'

// D-B6-04 period close (PLAN B6 section 2.2): paid -> closed by a period.close holder once SQL period_close_blockers is
// empty, with the period's GL journal export made in the same transaction; nothing posts into a closed period after.

type Scope = readonly string[] | null

/** A blocker of SQL period_close_blockers with its object id also as `id` (the kind names which `*_id` it is). */
type Blocker = { readonly kind: string; readonly id: string } & Readonly<Record<string, string>>

async function closeBlockers(tx: Tx, periodId: string): Promise<Blocker[]> {
  const { rows } = await tx.query<{ blockers: Record<string, string>[] }>('SELECT period_close_blockers($1) AS blockers', [periodId])
  return rows[0]!.blockers.map(withId)
}

const withId = (b: Record<string, string>): Blocker => ({ ...b, kind: b.kind!, id: Object.entries(b).find(([key]) => key.endsWith('_id'))![1] })

const blocked = (blockers: readonly Blocker[]): ApiError =>
  new ApiError(422, 'PERIOD_CLOSE_BLOCKED', 'Resolve every listed item before closing the period.', { blockers })

/** GET /v1/periods/:id/close-check. */
export async function closeCheck(tx: Tx, periodId: string, scope: Scope) {
  const period = await periodInScope(tx, periodId, scope)
  const blockers = await closeBlockers(tx, periodId)
  const glUnmapped = await unmappedAccountTypes(tx, periodId)
  return { state: period.state, closable: period.state === 'paid' && blockers.length === 0 && glUnmapped.length === 0, blockers, gl_unmapped: glUnmapped }
}

/** The GL export of the period at close; null when the period has no ledger entries (nothing to export). */
async function closeExport(tx: Tx, periodId: string): Promise<string | null> {
  const { rows } = await tx.query<{ any: boolean }>('SELECT EXISTS (SELECT 1 FROM journal_entry WHERE period_id = $1) AS any', [periodId])
  if (!rows[0]!.any) return null
  // The export at close carries every entry of the period (period_state_guard checks its debit total), so the
  // configured row cap of on-request exports does not apply: Number.MAX_SAFE_INTEGER never refuses.
  const created = await createJournalExport(tx, periodId, null, Number.MAX_SAFE_INTEGER)
  if (created.refused !== undefined) throw new Error('the export at close passed Number.MAX_SAFE_INTEGER rows')
  return created.view.id
}

/** SQL period_close's guard re-reads the blockers under the ledger lock: one that appeared since ours is a 422 too. */
function closeRefusal(error: unknown): never {
  const detail = typeof error === 'object' && error !== null && 'code' in error && error.code === '23514' && 'detail' in error ? error.detail : undefined
  if (typeof detail === 'string' && detail.startsWith('[')) throw blocked((JSON.parse(detail) as Record<string, string>[]).map(withId))
  throw error
}

/** POST /v1/periods/:id/close: blockers, GL export, close, outbox period.closed and audit in one transaction. */
export async function closePeriod(tx: Tx, periodId: string, note: string, scope: Scope) {
  const visible = await periodInScope(tx, periodId, scope)
  // Ledger lock before anything audits (B4 lock order): no posting enters the period between the export and the close.
  await lockLedger(tx, visible.market_id)
  const period = await periodInScope(tx, periodId, scope, true)
  if (period.state !== 'paid') throw new ApiError(409, 'PERIOD_NOT_PAID', 'Only a paid period can be closed.', { state: period.state })
  const blockers = await closeBlockers(tx, periodId)
  if (blockers.length > 0) throw blocked(blockers)
  const journalExportId = await closeExport(tx, periodId)
  await tx.query('SELECT period_close($1, $2, $3)', [periodId, note, journalExportId]).catch(closeRefusal)
  const closed = await periodInScope(tx, periodId, null)
  await enqueueOutbox(tx, {
    type: 'period.closed', key: periodId,
    payload: { period_id: periodId, calendar_id: closed.calendar_id, market_id: closed.market_id, journal_export_id: journalExportId },
  })
  await recordAudit(tx, {
    action: 'PERIOD.CLOSED', objectType: 'period', objectId: periodId, before: { state: 'paid' },
    after: { state: 'closed', journal_export_id: journalExportId },
  })
  return { period: { id: periodId, state: closed.state, closed_at: closed.closed_at, closed_by: closed.closed_by }, journal_export_id: journalExportId }
}

const id = z.object({ id: z.uuid() })
const closeBody = z.strictObject({ note: z.string().trim().min(1).max(1000) })

export function registerCloseRoutes(app: FastifyInstance): void {
  app.get('/v1/periods/:id/close-check', { preHandler: [requireRealm('tenant'), requirePermission('period.read')] }, async (request) => {
    const { id: periodId } = parse(id, request.params)
    return envelope(await inTenant(request, (tx) => closeCheck(tx, periodId, marketScope(currentAuth(request), 'period.read'))))
  })

  const close = { preHandler: [requireRealm('tenant'), requirePermission('period.close'), requireStepUp()] }
  app.post('/v1/periods/:id/close', close, async (request, reply) => {
    const { id: periodId } = parse(id, request.params)
    const { note } = parse(closeBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 200, body: envelope(await closePeriod(tx, periodId, note, marketScope(currentAuth(request), 'period.close'))),
    })))
    return sendIdempotent(reply, result)
  })
}
