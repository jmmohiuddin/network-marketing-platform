// Parallel-run reconciliation (PLAN B6 D-B6-11, FR-MIG-002): a COMP simulation of kind parallel_run of the plan version in
// force at the cutover period, compared per payee and bonus with the batch's legacy payout lines by SQL mig_compare (cron
// mig.parallel-runs.compare); differences classified by the consultant, accepted by a Finance approver other than the
// classifier, and the migration signed off once nothing is unexplained.
import { recordApproval, withSystem, type EligibleApprover, type Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requireAnyPermission, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant, runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { defineSystemJob } from '../../lib/jobs.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { requestParallelRunSimulation } from '../comp/index.js'
import { approveAcrossMarkets, decideAcrossMarkets } from '../cpl/index.js'
import { assertState, loadMigration, planAtCutover, READERS, readScope, writeScope, type MigrationRow } from './access.js'
import { migrationView } from './migrations.js'

const RULE_KEY = /^[a-z][a-z0-9_]{0,63}$/
const COMPARE_BATCH = 100
const requestBody = z.strictObject({
  bonus_map: z.record(z.string().min(1).max(100), z.string().regex(RULE_KEY)).refine((map) => Object.keys(map).length <= 1000, 'at most 1000 bonus types'),
})
const reasonBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })
const classifyBody = z.strictObject({ class: z.enum(['rule', 'data', 'rounding']), note: z.string().trim().min(1).max(1000) })
const runParams = z.object({ id: z.uuid(), runId: z.uuid() })
const differenceParams = runParams.extend({ diffId: z.uuid() })
const FILTERS = {
  all: 'true',
  mismatches: 'd.delta_minor <> 0',
  rounding: "d.class = 'rounding'",
  rule: "d.class = 'rule'",
  data: "d.class = 'data'",
  unexplained: 'd.delta_minor <> 0 AND d.accepted_at IS NULL',
} as const
const differencesQuery = z.strictObject({ ...pageQuery, filter: z.enum(Object.keys(FILTERS) as [keyof typeof FILTERS]).default('all') })

const RUN_VIEW = `
  SELECT r.id, r.migration_id, r.simulation_id, r.state, r.bonus_map, r.legacy_total_minor::text AS legacy_total_minor,
    r.platform_total_minor::text AS platform_total_minor, r.error, r.requested_by, r.requested_at, r.compared_at,
    (SELECT jsonb_build_object(
       'payees', count(DISTINCT d.payee_ref), 'zero', count(*) FILTER (WHERE d.delta_minor = 0),
       'by_class', jsonb_build_object(
         'rule', count(*) FILTER (WHERE d.class = 'rule'), 'data', count(*) FILTER (WHERE d.class = 'data'),
         'rounding', count(*) FILTER (WHERE d.class = 'rounding'), 'unclassified', count(*) FILTER (WHERE d.delta_minor <> 0 AND d.class IS NULL)),
       'accepted', count(*) FILTER (WHERE d.accepted_at IS NOT NULL),
       'unexplained', count(*) FILTER (WHERE d.delta_minor <> 0 AND d.accepted_at IS NULL))
     FROM parallel_run_difference d WHERE d.parallel_run_id = r.id) AS summary,
    EXISTS (SELECT 1 FROM parallel_run_difference d WHERE d.parallel_run_id = r.id AND NOT d.bonus_detail) AS bonus_detail_missing
  FROM parallel_run r`

const DIFFERENCE_VIEW = `
  SELECT d.id, (SELECT jsonb_build_object('id', p.id, 'external_ref', p.external_ref, 'display_name', p.display_name)
                FROM participant p WHERE p.id = d.participant_id) AS participant,
    d.payee_ref, d.rule_key, d.legacy_bonus_types, d.bonus_detail, d.legacy_minor::text AS legacy_minor,
    d.platform_minor::text AS platform_minor, d.delta_minor::text AS delta_minor, d.class, d.class_note, d.classified_by, d.classified_at,
    d.acceptance_approval_id, d.accepted_at
  FROM parallel_run_difference d`

async function runView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<Record<string, unknown>>(`${RUN_VIEW} WHERE r.id = $1`, [id])
  return rows[0]!
}

/** D-B6-11: one parallel run of the cutover period per request; it supersedes the earlier ones. */
async function requestRun(tx: Tx, migration: MigrationRow, bonusMap: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
  assertState(migration, 'opening_posted')
  const { versionId, plan } = (await planAtCutover(tx, migration.cutover_period_id, true))!
  const unknown = [...new Set(Object.values(bonusMap))].filter((key) => !plan.bonuses.some((bonus) => bonus.key === key)).sort()
  if (unknown.length > 0) throw new ApiError(422, 'RULE_UNKNOWN', 'A mapped rule key is not a bonus of the plan version in force at the cutover period.', { rule_keys: unknown })
  const { rows: superseded } = await tx.query<{ id: string; state: string }>(
    `UPDATE parallel_run n SET state = 'superseded' FROM parallel_run o
     WHERE n.id = o.id AND n.migration_id = $1 AND n.state <> 'superseded' RETURNING n.id, o.state`, [migration.id])
  for (const run of superseded) {
    await recordAudit(tx, { action: 'PARALLEL_RUN.SUPERSEDED', objectType: 'parallel_run', objectId: run.id, before: { state: run.state }, after: { state: 'superseded' } })
  }
  const simulationId = await requestParallelRunSimulation(tx, { planVersionId: versionId, periodId: migration.cutover_period_id })
  const { rows } = await tx.query<{ id: string }>(
    'INSERT INTO parallel_run (tenant_id, migration_id, simulation_id, bonus_map) VALUES (app_tenant_id(), $1, $2, $3) RETURNING id',
    [migration.id, simulationId, bonusMap],
  )
  const id = rows[0]!.id
  await recordAudit(tx, { action: 'PARALLEL_RUN.REQUESTED', objectType: 'parallel_run', objectId: id, after: { migration_id: migration.id, simulation_id: simulationId, bonus_map: bonusMap } })
  return { id, state: 'calculating', simulation_id: simulationId }
}

/** Everyone who ever classified the differences matched by `where` (a re-classification overwrites classified_by). */
const CLASSIFIERS = (where: string) => `ARRAY(SELECT DISTINCT a.actor_id FROM audit.audit_event a
  WHERE a.object_type = 'parallel_run_difference' AND a.action = 'PARALLEL_DIFFERENCE.CLASSIFIED' AND a.actor_id IS NOT NULL AND ${where})`

/**
 * The current (not superseded) compared run of the migration that a difference belongs to; 409 otherwise. The run is
 * share-locked so a concurrent supersede waits (or is seen) instead of failing the difference guard.
 */
async function currentDifference(tx: Tx, request: FastifyRequest, migration: MigrationRow) {
  const { runId, diffId } = parse(differenceParams, request.params)
  const { rows } = await tx.query<{
    id: string; delta_minor: string; class: string | null; classified_by: string | null; classifiers: string[]; accepted_at: Date | null; run_state: string
  }>(
    `SELECT d.id, d.delta_minor::text AS delta_minor, d.class, d.classified_by, ${CLASSIFIERS('a.object_id = d.id')} AS classifiers,
            d.accepted_at, r.state AS run_state
     FROM parallel_run_difference d JOIN parallel_run r ON r.id = d.parallel_run_id
     WHERE d.id = $1 AND r.id = $2 AND r.migration_id = $3 FOR UPDATE OF d FOR SHARE OF r`,
    [diffId, runId, migration.id],
  )
  const difference = rows[0]
  if (difference === undefined) throw notFound()
  if (difference.run_state !== 'compared') throw new ApiError(409, 'RUN_NOT_CURRENT', 'Only the differences of the current compared parallel run change.', { state: difference.run_state })
  if (difference.accepted_at !== null) throw new ApiError(409, 'DIFFERENCE_ACCEPTED', 'The difference is accepted; acceptance is final.')
  return difference
}

async function differenceView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<Record<string, unknown>>(`${DIFFERENCE_VIEW} WHERE d.id = $1`, [id])
  return rows[0]!
}

async function signOff(tx: Tx, request: FastifyRequest, reason: string) {
  const migration = await loadMigration(tx, request, writeScope(request, 'migration.signoff'), true)
  assertState(migration, 'opening_posted')
  const { rows } = await tx.query<{ id: string; state: string; unexplained: number; classifiers: string[] }>(
    `SELECT r.id, r.state,
            (SELECT count(*)::int FROM parallel_run_difference d WHERE d.parallel_run_id = r.id AND d.delta_minor <> 0 AND d.accepted_at IS NULL) AS unexplained,
            ${CLASSIFIERS('a.object_id IN (SELECT d.id FROM parallel_run_difference d WHERE d.parallel_run_id = r.id)')} AS classifiers
     FROM parallel_run r WHERE r.migration_id = $1 AND r.state <> 'superseded' FOR SHARE`,
    [migration.id],
  )
  const run = rows[0]
  if (run?.state !== 'compared') throw new ApiError(422, 'NO_PARALLEL_RUN', 'Sign-off needs a compared parallel run.', { state: run?.state ?? null })
  if (run.unexplained > 0) throw new ApiError(422, 'UNEXPLAINED_DIFFERENCES', 'Every difference must be accepted before sign-off.', { count: run.unexplained })
  const { approvalId } = await approveAcrossMarkets(tx, {
    objectType: 'migration', objectId: migration.id, preparerId: migration.created_by, contributorIds: run.classifiers, excludedIds: [],
    decision: 'approved', reason, factorVerifiedAt: currentAuth(request).stepUpAt, approverPermission: 'migration.signoff', marketIds: [migration.market_id],
  })
  await tx.query("UPDATE migration SET state = 'signed_off', signoff_approval_id = $2, signed_off_at = now() WHERE id = $1", [migration.id, approvalId])
  await recordAudit(tx, { action: 'MIGRATION.SIGNED_OFF', objectType: 'migration', objectId: migration.id, before: { state: 'opening_posted' }, after: { state: 'signed_off', approval_id: approvalId, parallel_run_id: run.id }, reason })
  return { statusCode: 200, body: envelope(await migrationView(tx, migration.id)) }
}

/** mig_compare of one calculating run whose simulation finished (idempotent), audited once. */
export async function compareRun(tx: Tx, runId: string): Promise<void> {
  const { rows } = await tx.query<{ state: string }>('SELECT state FROM parallel_run WHERE id = $1 FOR UPDATE', [runId])
  if (rows[0]?.state !== 'calculating') return
  const { rows: compared } = await tx.query<{ result: { state: string } & Record<string, unknown> }>('SELECT mig_compare($1) AS result', [runId])
  const result = compared[0]!.result
  if (result.state === 'calculating') return
  await recordAudit(tx, { action: result.state === 'compared' ? 'PARALLEL_RUN.COMPARED' : 'PARALLEL_RUN.FAILED', objectType: 'parallel_run', objectId: runId, before: { state: 'calculating' }, after: result })
}

/**
 * System cron (every minute): compares every run whose simulation finished, one tenant transaction each.
 * shortcut: a comparison that fails deterministically stays calculating and is retried every minute (logged, not
 * audited); a new parallel-run request supersedes it. Add a definer path that marks it failed (COMPARISON_FAILED,
 * audited) after repeated failures if such failures are seen in the logs.
 */
export const compareParallelRunsJob = defineSystemJob({
  name: 'mig.parallel-runs.compare',
  cron: '* * * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) => tx.query<{ tenant_id: string; parallel_run_id: string }>('SELECT tenant_id, parallel_run_id FROM mig_due_comparisons($1)', [COMPARE_BATCH]))
    for (const row of rows) {
      try {
        await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null }, (tx) => compareRun(tx, row.parallel_run_id))
      } catch (error) {
        ctx.log.error({ err: error, parallelRunId: row.parallel_run_id }, 'parallel run comparison failed; retried next minute')
      }
    }
  },
})

function registerRunRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requireAnyPermission(...READERS)] }

  app.post('/v1/migrations/:id/parallel-runs', { preHandler: [requireRealm('tenant'), requirePermission('migration.manage')] }, async (request, reply) => {
    const body = parse(requestBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'), true)
      return { statusCode: 202, body: envelope(await requestRun(tx, migration, body.bonus_map)) }
    }))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/migrations/:id/parallel-runs', read, async (request) =>
    envelope(await inTenant(request, async (tx) => {
      const migration = await loadMigration(tx, request, readScope(request))
      return (await tx.query(`${RUN_VIEW} WHERE r.migration_id = $1 ORDER BY r.requested_at DESC, r.id DESC`, [migration.id])).rows
    })))

  app.get('/v1/migrations/:id/parallel-runs/:runId', read, async (request) =>
    envelope(await inTenant(request, async (tx) => {
      const migration = await loadMigration(tx, request, readScope(request))
      const { rows } = await tx.query(`${RUN_VIEW} WHERE r.id = $1 AND r.migration_id = $2`, [parse(runParams, request.params).runId, migration.id])
      if (rows[0] === undefined) throw notFound()
      return rows[0]
    })))

  app.get('/v1/migrations/:id/parallel-runs/:runId/differences', read, async (request) => {
    const query = parse(differencesQuery, request.query)
    const after = decodeCursor(query.cursor, z.tuple([z.string(), z.uuid()]))
    const rows = await inTenant(request, async (tx) => {
      const migration = await loadMigration(tx, request, readScope(request))
      const runId = parse(runParams, request.params).runId
      const { rows: runs } = await tx.query('SELECT 1 FROM parallel_run WHERE id = $1 AND migration_id = $2', [runId, migration.id])
      if (runs.length === 0) throw notFound()
      return (await tx.query<{ id: string; payee_ref: string }>(
        `${DIFFERENCE_VIEW} WHERE d.parallel_run_id = $1 AND ${FILTERS[query.filter]}
           AND ($2::text IS NULL OR (d.payee_ref, d.id) > ($2::text, $3::uuid))
         ORDER BY d.payee_ref, d.id LIMIT $4`,
        [runId, after?.[0] ?? null, after?.[1] ?? null, query.limit + 1],
      )).rows
    })
    return toPage(rows, query.limit, (row) => [row.payee_ref, row.id])
  })
}

function registerDecisionRoutes(app: FastifyInstance): void {
  const base = '/v1/migrations/:id/parallel-runs/:runId/differences/:diffId'

  // Classification explains nothing by itself: a difference is explained once a signoff holder accepts it.
  app.post(`${base}/classify`, { preHandler: [requireRealm('tenant'), requirePermission('migration.manage')] }, async (request) => {
    const body = parse(classifyBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'))
      const difference = await currentDifference(tx, request, migration)
      if (difference.delta_minor === '0') throw new ApiError(422, 'DIFFERENCE_ZERO', 'A difference of zero needs no classification.')
      await tx.query('UPDATE parallel_run_difference SET class = $2, class_note = $3, classified_by = app_user_id(), classified_at = now() WHERE id = $1',
        [difference.id, body.class, body.note])
      await recordAudit(tx, { action: 'PARALLEL_DIFFERENCE.CLASSIFIED', objectType: 'parallel_run_difference', objectId: difference.id, before: { class: difference.class }, after: { class: body.class }, reason: body.note })
      return differenceView(tx, difference.id)
    }))
  })

  // SoD vs the classifier; a refusal commits APPROVAL.REFUSED and answers 422 SOD_SELF_APPROVAL (no Idempotency-Key here).
  app.post(`${base}/accept`, { preHandler: [requireRealm('tenant'), requirePermission('migration.signoff'), requireStepUp()] }, async (request) => {
    const body = parse(reasonBody, request.body)
    type Outcome = { accepted: Record<string, unknown>; refused?: never } | { refused: readonly EligibleApprover[]; accepted?: never }
    const outcome = await inTenant(request, async (tx): Promise<Outcome> => {
      const migration = await loadMigration(tx, request, writeScope(request, 'migration.signoff'))
      const difference = await currentDifference(tx, request, migration)
      if (difference.classified_by === null) throw new ApiError(422, 'NOT_CLASSIFIED', 'Classify the difference before accepting it.')
      const approval = await recordApproval(tx, {
        objectType: 'parallel_run_difference', objectId: difference.id, preparerId: difference.classified_by, contributorIds: difference.classifiers, excludedIds: [],
        decision: 'approved', reason: body.reason, factorVerifiedAt: currentAuth(request).stepUpAt, approverPermission: 'migration.signoff', marketId: migration.market_id,
      })
      if (!approval.ok) {
        await recordAudit(tx, { action: 'APPROVAL.REFUSED', objectType: 'parallel_run_difference', objectId: difference.id, after: { object_type: 'parallel_run_difference', object_id: difference.id, reason_code: 'SOD-01' } })
        return { refused: approval.eligibleApprovers }
      }
      await tx.query('UPDATE parallel_run_difference SET acceptance_approval_id = $2, accepted_at = now() WHERE id = $1', [difference.id, approval.approvalId])
      await recordAudit(tx, { action: 'PARALLEL_DIFFERENCE.ACCEPTED', objectType: 'parallel_run_difference', objectId: difference.id, after: { approval_id: approval.approvalId }, reason: body.reason })
      return { accepted: await differenceView(tx, difference.id) }
    })
    if (outcome.refused !== undefined) {
      throw new ApiError(422, 'SOD_SELF_APPROVAL', 'You classified this difference, so someone else must accept it.', {
        reason_code: 'SOD-01', eligible_approvers: outcome.refused, no_eligible_approver: outcome.refused.length === 0,
      })
    }
    return envelope(outcome.accepted)
  })

  app.post('/v1/migrations/:id/sign-off', { preHandler: [requireRealm('tenant'), requirePermission('migration.signoff'), requireStepUp()] }, async (request, reply) => {
    const body = parse(reasonBody, request.body)
    return sendIdempotent(reply, await decideAcrossMarkets(request, (tx) => signOff(tx, request, body.reason)))
  })
}

export function registerParallelRunRoutes(app: FastifyInstance): void {
  registerRunRoutes(app)
  registerDecisionRoutes(app)
}
