import { withSystem, type Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant, runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { defineSystemJob, type JobContext } from '../../lib/jobs.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { approveOrRefuse, decideWithSod } from '../ten/index.js'

const MANAGE = 'privacy.manage'
/** D-V1A-10: preview samples and items applied per schedule and run. */
const RETENTION_SAMPLE_MAX = 20
const RETENTION_RUN_ITEMS_MAX = 1000
const DEFERRED_STATE = 'PV001'

const idParams = z.object({ id: z.uuid() })
const proposeBody = z.strictObject({
  data_class: z.enum(['privacy_request', 'terminated_participant']),
  market_id: z.uuid().nullable(),
  retain_days: z.number().int().min(1).max(3650),
  basis: z.string().trim().min(1).max(500),
  effective_from: z.iso.date(),
})
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), note: z.string().trim().min(1).max(500).optional() })
const runsQuery = z.strictObject({ schedule_id: z.uuid().optional(), ...pageQuery })

/** D-V1A-09: a schedule of a market needs privacy.manage over it; an all-markets schedule (market NULL) needs it for all markets. */
const covers = (scope: readonly string[] | null, marketId: string | null): boolean => scope === null || (marketId !== null && scope.includes(marketId))
const scopeOf = (request: FastifyRequest) => marketScope(currentAuth(request), MANAGE)

const SCHEDULE_SELECT = `
  SELECT s.id, s.data_class, CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('id', m.id, 'code', m.code) END AS market,
         s.retain_days, s.basis, to_char(s.effective_from, 'YYYY-MM-DD') AS effective_from, s.state,
         s.id IS NOT DISTINCT FROM retention_schedule_in_force(s.data_class, s.market_id, current_date) AS in_force,
         jsonb_build_object('id', p.id, 'display_name', p.display_name) AS proposed_by, s.proposed_at,
         CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'display_name', u.display_name) END AS approver, s.decided_at
  FROM retention_schedule s LEFT JOIN market m ON m.id = s.market_id JOIN user_account p ON p.id = s.proposed_by
  LEFT JOIN approval a ON a.id = s.approval_id LEFT JOIN user_account u ON u.id = a.approver_id`

// Schedules for every market apply in each market without its own, so every privacy.manage holder sees them.
const VISIBLE = '($1::uuid[] IS NULL OR s.market_id IS NULL OR s.market_id = ANY ($1))'

async function scheduleOf(tx: Tx, request: FastifyRequest, id: string, lock = false) {
  const { rows } = await tx.query<{ id: string; data_class: string; market_id: string | null; state: string; proposed_by: string }>(
    `SELECT id, data_class, market_id, state, proposed_by FROM retention_schedule s WHERE id = $2 AND ${VISIBLE}${lock ? ' FOR UPDATE' : ''}`,
    [scopeOf(request), id],
  )
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

async function scheduleView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  return (await tx.query(`${SCHEDULE_SELECT} WHERE s.id = $1`, [id])).rows[0]!
}

async function propose(tx: Tx, request: FastifyRequest, body: z.infer<typeof proposeBody>) {
  if (!covers(scopeOf(request), body.market_id)) {
    throw new ApiError(403, 'SCOPE_NOT_HELD', 'A schedule for this market needs privacy.manage over it (all markets when no market is named).')
  }
  if (body.market_id !== null && (await tx.query('SELECT 1 FROM market WHERE id = $1', [body.market_id])).rowCount === 0) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'market_id is not a market of this tenant.', { field: 'market_id' })
  }
  const { rows: today } = await tx.query<{ ok: boolean }>('SELECT $1::date >= current_date AS ok', [body.effective_from])
  if (!today[0]!.ok) throw new ApiError(422, 'VALIDATION_FAILED', 'effective_from is in the past.', { field: 'effective_from' })
  let id: string
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO retention_schedule (tenant_id, data_class, market_id, retain_days, basis, effective_from)
       VALUES (app_tenant_id(), $1, $2, $3, $4, $5) RETURNING id`,
      [body.data_class, body.market_id, body.retain_days, body.basis, body.effective_from],
    )
    id = rows[0]!.id
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ApiError(409, 'SCHEDULE_PROPOSED', 'A schedule for this data class and market is already waiting for a decision.')
    }
    throw error
  }
  await recordAudit(tx, {
    action: 'RETENTION_SCHEDULE.PROPOSED', objectType: 'retention_schedule', objectId: id,
    after: { data_class: body.data_class, market_id: body.market_id, retain_days: body.retain_days, effective_from: body.effective_from },
  })
  return scheduleView(tx, id)
}

/** AC-PRV3-1: another privacy.manage holder decides (step-up); the proposer gets 422 SOD_SELF_APPROVAL. */
async function decide(tx: Tx, request: FastifyRequest, id: string, body: z.infer<typeof decisionBody>) {
  const schedule = await scheduleOf(tx, request, id, true)
  if (schedule.state !== 'proposed') throw new ApiError(409, 'SCHEDULE_DECIDED', `The schedule is already ${schedule.state}.`)
  const decision = body.decision === 'approve' ? 'approved' : 'rejected'
  const { approvalId } = await approveOrRefuse(tx, {
    objectType: 'retention_schedule', objectId: id, preparerId: schedule.proposed_by, contributorIds: [], excludedIds: [], decision,
    reason: body.note ?? null, factorVerifiedAt: currentAuth(request).stepUpAt, approverPermission: MANAGE,
    marketId: schedule.market_id, allMarkets: schedule.market_id === null,
  })
  await tx.query('UPDATE retention_schedule SET state = $2, approval_id = $3, decided_at = now() WHERE id = $1', [id, decision, approvalId])
  await recordAudit(tx, {
    action: `RETENTION_SCHEDULE.${decision.toUpperCase()}`, objectType: 'retention_schedule', objectId: id, after: { approval_id: approvalId },
  })
  return { statusCode: 200, body: envelope(await scheduleView(tx, id)) }
}

/** AC-PRV3-2 dry run: the same SQL as the cron, nothing written. */
async function preview(tx: Tx, request: FastifyRequest, id: string) {
  await scheduleOf(tx, request, id)
  const { rows } = await tx.query<{ object_type: string; object_id: string; ref: string; held: boolean }>(
    'SELECT object_type, object_id, ref, held FROM prv_retention_due($1, $2)', [id, RETENTION_RUN_ITEMS_MAX],
  )
  const due = rows.filter((row) => !row.held)
  return {
    due: due.length, held: rows.length - due.length,
    sample: due.slice(0, RETENTION_SAMPLE_MAX).map(({ object_type, object_id, ref }) => ({ object_type, object_id, ref })),
  }
}

async function listRuns(tx: Tx, request: FastifyRequest, query: z.infer<typeof runsQuery>) {
  const after = decodeCursor(query.cursor, z.tuple([z.iso.datetime({ offset: true }), z.uuid()]))
  const { rows } = await tx.query<{ id: string; started_at: Date }>(
    `SELECT r.id, r.schedule_id, s.data_class, r.started_at, r.finished_at, r.due, r.applied, r.held, r.deferred, r.items
     FROM retention_run r JOIN retention_schedule s ON s.id = r.schedule_id
     WHERE ${VISIBLE} AND ($2::uuid IS NULL OR r.schedule_id = $2)
       AND ($3::timestamptz IS NULL OR (date_trunc('milliseconds', r.started_at), r.id) < ($3::timestamptz, $4::uuid))
     ORDER BY date_trunc('milliseconds', r.started_at) DESC, r.id DESC LIMIT $5`,
    [scopeOf(request), query.schedule_id ?? null, after?.[0] ?? null, after?.[1] ?? null, query.limit + 1],
  )
  return toPage(rows, query.limit, (row) => [row.started_at.toISOString(), row.id])
}

/** FR-PRV-003 (D-V1A-08, SC-15): retention schedules approved by a second DPO, their dry run and the cron's log. */
export function registerRetentionRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission(MANAGE)] }
  const stepped = { preHandler: [...read.preHandler, requireStepUp()] }

  app.get('/v1/retention/schedules', read, async (request) =>
    envelope(await inTenant(request, async (tx) =>
      (await tx.query(`${SCHEDULE_SELECT} WHERE ${VISIBLE} ORDER BY s.data_class, m.code NULLS FIRST, s.effective_from DESC, s.proposed_at DESC`,
        [scopeOf(request)])).rows)))

  app.post('/v1/retention/schedules', read, async (request, reply) => {
    const body = parse(proposeBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await propose(tx, request, body)) })))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/retention/schedules/:id/decision', stepped, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(decisionBody, request.body)
    return sendIdempotent(reply, await decideWithSod(request, (tx) => decide(tx, request, id, body)))
  })

  app.get('/v1/retention/schedules/:id/preview', read, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => preview(tx, request, id)))
  })

  app.get('/v1/retention/runs', read, async (request) => {
    const query = parse(runsQuery, request.query)
    return inTenant(request, (tx) => listRuns(tx, request, query))
  })
}

type Outcome = 'applied' | 'held' | 'deferred'

// One item in a savepoint: a PV001 deferral (legal hold, money owed, credits outstanding) or any failure rolls back only it.
async function applyItem(tx: Tx, scheduleId: string, item: { object_type: string; object_id: string }, ctx: JobContext): Promise<Outcome | null> {
  await tx.query('SAVEPOINT retention_item')
  try {
    if (item.object_type === 'participant') await tx.query('SELECT prv_retention_erase($1, $2)', [scheduleId, item.object_id])
    else await tx.query('SELECT prv_retention_clear_request($1)', [item.object_id])
    await tx.query('RELEASE SAVEPOINT retention_item')
    return 'applied'
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT retention_item')
    if ((error as { code?: string }).code === DEFERRED_STATE) return 'deferred'
    ctx.log.error({ err: error, scheduleId, objectId: item.object_id }, 'retention item failed; retried next run')
    return null
  }
}

/** One schedule of one tenant: its due items applied, held ones skipped, one retention_run row and one audit event. */
async function applySchedule(tx: Tx, scheduleId: string, ctx: JobContext): Promise<void> {
  const { rows: started } = await tx.query<{ now: Date }>('SELECT clock_timestamp() AS now')
  const { rows } = await tx.query<{ object_type: string; object_id: string; held: boolean }>(
    'SELECT object_type, object_id, held FROM prv_retention_due($1, $2)', [scheduleId, RETENTION_RUN_ITEMS_MAX],
  )
  const items: { object_type: string; object_id: string; outcome: Outcome }[] = []
  for (const row of rows) {
    const outcome = row.held ? 'held' : await applyItem(tx, scheduleId, row, ctx)
    if (outcome !== null) items.push({ object_type: row.object_type, object_id: row.object_id, outcome })
  }
  const count = (outcome: Outcome) => items.filter((item) => item.outcome === outcome).length
  const { rows: run } = await tx.query<{ id: string }>(
    `INSERT INTO retention_run (tenant_id, schedule_id, started_at, finished_at, due, applied, held, deferred, items)
     VALUES (app_tenant_id(), $1, $2, clock_timestamp(), $3, $4, $5, $6, $7) RETURNING id`,
    [scheduleId, started[0]!.now, rows.length, count('applied'), count('held'), count('deferred'), JSON.stringify(items)],
  )
  await recordAudit(tx, {
    action: 'RETENTION.APPLIED', objectType: 'retention_run', objectId: run[0]!.id,
    after: { schedule_id: scheduleId, applied: count('applied'), held: count('held'), deferred: count('deferred') },
  })
}

/** D-V1A-08 daily at 02:30 UTC: every in-force schedule of every tenant not archived, each in its own transaction. */
export const retentionApplyCron = defineSystemJob({
  name: 'prv.retention.apply',
  cron: '30 2 * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) =>
      tx.query<{ tenant_id: string; schedule_id: string }>('SELECT tenant_id, schedule_id FROM retention_schedules_due($1)', [RETENTION_RUN_ITEMS_MAX]))
    // shortcut: at most 1000 schedules (and 1000 items each) per day; a later run picks up the rest, batch when tenants need more.
    for (const row of rows) {
      const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
      try {
        await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, actor, (tx) => applySchedule(tx, row.schedule_id, ctx))
      } catch (error) {
        ctx.log.error({ err: error, tenantId: row.tenant_id, scheduleId: row.schedule_id }, 'retention schedule failed')
      }
    }
  },
})
