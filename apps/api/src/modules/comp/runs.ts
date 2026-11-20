import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { ENGINE_VERSION, EngineError, runIncremental, type Receivable, type RunChunk, type RunInput, type RunSummary } from '@nmp/engine'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { defineTenantJob, enqueue, type JobContext, type TenantJob } from '../../lib/jobs.js'
import { manualOrigins } from './adjustment.js'
import { engineSettings, storedInput } from './inputs.js'
import { consumeLate, LATE_ITEMS_OF_CALENDAR, restatementOrigins } from './late.js'
import { loadPeriod, lockRunKey, periodInScope, settingsVersionAt } from './period.js'
import { assertRunnable } from './preflight.js'
import { outputsOf, totalsOf, writeRunOutput } from './results.js'
import { buildSnapshot, chainInputs, planFor, rowCounts, SnapshotCorrupt, storeSnapshot } from './snapshot.js'

// D-B3-09: a run request inserts a queued run under the period's run lock; the worker loads and stores the snapshot
// (tx A), calculates, then writes lines, state and the flip in one transaction (tx B, §S-2). Transient database errors
// are rethrown for the queue's retry, which resumes from the stored snapshot, until the last attempt; any other error
// fails the run.

const TRANSIENT_SQLSTATE = /^(08|40|53|57|58)/

/**
 * pg-boss hands an active job to another worker once it expires (queue default 15 minutes). NFR-PERF-05 allows a
 * 60-minute run, so run and simulation jobs expire after the budget plus a margin, never while still calculating.
 */
const LONG_JOB_EXPIRY = '75 minutes'

/** enqueue() sends with the queue's expiry; the job row gets LONG_JOB_EXPIRY in the same transaction. */
export async function enqueueLong<P>(tx: Tx, job: TenantJob<P>, payload: P): Promise<void> {
  const jobId = await enqueue(tx, job, payload)
  await tx.query('UPDATE pgboss.job SET expire_in = $3::interval WHERE name = $1 AND id = $2', [job.name, jobId, LONG_JOB_EXPIRY])
}

/** The terminal error of a run whose job pg-boss gave up on (transient failures or a worker lost on every attempt). */
const retriesExhausted = (): ApiError =>
  new ApiError(503, 'RUN_RETRIES_EXHAUSTED', 'The calculation could not finish on any attempt of its job: request the run again.')

/** Whether the run still has a job pg-boss will run (created, waiting for a retry, or active). */
async function runJobLive(tx: Tx, runId: string): Promise<boolean> {
  const { rows } = await tx.query<{ live: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pgboss.job WHERE name = $1 AND data -> 'payload' ->> 'runId' = $2
                      AND state IN ('created', 'retry', 'active')) AS live`,
    [calculateRunJob.name, runId],
  )
  return rows[0]!.live
}

interface RunRow {
  readonly id: string
  readonly period_id: string
  readonly state: string
  readonly plan_version_id: string
  readonly settings_version_id: string
  readonly snapshot_id: string | null
  readonly inputs_hash: string | null
}

export interface RunRequested {
  readonly run_id: string
  readonly state: string
  readonly replayed: boolean
}

/**
 * POST /v1/periods/:id/runs (API-18): the same run for the same Run-Request-Id or while one is queued or running. A
 * queued or running run without a live job (pg-boss gave up on it) fails here, so the period is never blocked for good.
 */
export async function requestRun(tx: Tx, periodId: string, runRequestId: string, scope: readonly string[] | null): Promise<RunRequested> {
  const visible = await periodInScope(tx, periodId, scope)
  await lockRunKey(tx, visible)
  const { rows: existing } = await tx.query<{ id: string; state: string; same: boolean }>(
    `SELECT id, state, run_request_id = $2 AS same FROM run WHERE period_id = $1 AND (run_request_id = $2 OR state IN ('queued', 'running'))
     ORDER BY run_request_id = $2 DESC LIMIT 1`,
    [periodId, runRequestId],
  )
  const found = existing[0]
  if (found !== undefined && (found.same || (await runJobLive(tx, found.id)))) return { run_id: found.id, state: found.state, replayed: true }
  if (found !== undefined) await failRun(tx, found.id, retriesExhausted())
  const period = await loadPeriod(tx, periodId, true)
  await assertRunnable(tx, period)
  const { rows: version } = await tx.query<{ id: string }>('SELECT plan_version_for_period($1) AS id', [periodId])
  const settingsVersionId = await settingsVersionAt(tx, periodId)
  if (settingsVersionId === null) throw new ApiError(422, 'SETTINGS_VERSION_MISSING', 'No tenant settings are in force at the end of the period.')
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, engine_version, prepared_by)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, app_user_id()) RETURNING id`,
    [periodId, runRequestId, version[0]!.id, settingsVersionId, ENGINE_VERSION],
  )
  const runId = rows[0]!.id
  await tx.query(`UPDATE period SET state = 'calculating' WHERE id = $1`, [periodId])
  await recordAudit(tx, {
    action: 'RUN.REQUESTED', objectType: 'run', objectId: runId,
    after: { period_id: periodId, run_request_id: runRequestId, plan_version_id: version[0]!.id, settings_version_id: settingsVersionId,
      period_state: 'calculating' },
  })
  await enqueueLong(tx, calculateRunJob, { runId })
  return { run_id: runId, state: 'queued', replayed: false }
}

async function lockedRun(tx: Tx, runId: string): Promise<RunRow> {
  const { rows: of } = await tx.query<{ period_id: string; calendar_id: string }>(
    'SELECT r.period_id, p.calendar_id FROM run r JOIN period p ON p.id = r.period_id WHERE r.id = $1',
    [runId],
  )
  await lockRunKey(tx, { id: of[0]!.period_id, calendar_id: of[0]!.calendar_id })
  const { rows } = await tx.query<RunRow>(
    `SELECT id, period_id, state, plan_version_id, settings_version_id, snapshot_id, inputs_hash FROM run WHERE id = $1 FOR UPDATE`,
    [runId],
  )
  return rows[0]!
}

/** D-B4-07: the market's positive clawback receivables now; the engine nets the run's positive gross against them. */
async function receivablesOf(tx: Tx, marketId: string): Promise<Receivable[]> {
  const { rows } = await tx.query<{ participant_id: string; amount_minor: string }>(
    'SELECT participant_id, amount_minor::text FROM led_receivable_balances($1)', [marketId])
  return rows.map((row) => ({ participantId: row.participant_id, amountMinor: BigInt(row.amount_minor) }))
}

/**
 * tx A: the run's input. A queued run gets its snapshot (late, restatement and manual origins, receivables) stored and turns
 * running; a running run (a retried job) resumes from its stored snapshot. null when the run is no longer pending.
 */
export async function prepareRun(tx: Tx, runId: string): Promise<RunInput | null> {
  const row = await lockedRun(tx, runId)
  if (row.state !== 'queued' && row.state !== 'running') return null
  if (row.snapshot_id !== null) return storedInput(tx, row)
  const period = await loadPeriod(tx, row.period_id)
  const plan = await planFor(tx, row.plan_version_id, period.calendar_id, period.starts_us)
  const settings = await engineSettings(tx, row.settings_version_id)
  const chain = await chainInputs(tx, period, plan)
  const late = await consumeLate(tx, runId, period, settings.roundingMode)
  const adjustments = [...late.origins, ...(await restatementOrigins(tx, period)), ...(await manualOrigins(tx, period.id))]
  const receivables = await receivablesOf(tx, period.market_id)
  const loaded = await buildSnapshot(tx, period, { snapshotId: randomUUID(), chain, adjustments, receivables })
  await storeSnapshot(tx, loaded, { periodId: period.id, priorRunId: chain.priorRunId, rowCounts: rowCounts(loaded, late.itemIds) })
  await tx.query(
    `UPDATE run SET state = 'running', snapshot_id = $2, started_at = now(), progress = 'Calculating' WHERE id = $1`,
    [runId, loaded.snapshot.snapshotId],
  )
  await recordAudit(tx, { action: 'RUN.STARTED', objectType: 'run', objectId: runId, after: { snapshot_id: loaded.snapshot.snapshotId } })
  return { plan, settings, snapshot: loaded.snapshot }
}

/** The engine's output stream (D-B6-12): every chunk is written and dropped in tx B. */
export type RunStream = Generator<RunChunk, RunSummary, undefined>

/**
 * Runs the engine's passes up to the final lines now (the first chunk), so tx B only writes; the stream resumes from there.
 */
export function startedRun(input: RunInput): RunStream {
  const stream = runIncremental(input)
  const first = stream.next()
  return (function* resumed(): RunStream {
    if (first.done === true) return first.value
    yield first.value
    return yield* stream
  })()
}

/**
 * tx B: lines, state rows, the per-payee settlement (D-B4-07) chunk by chunk from the stream and the flip (Σ lines =
 * totals.gross_minor, checked by the run guard); older calculated run discarded.
 */
export async function finishRun(tx: Tx, runId: string, stream: RunStream): Promise<void> {
  const row = await lockedRun(tx, runId)
  if (row.state !== 'running') return
  const period = await loadPeriod(tx, row.period_id)
  const { summary, linesHash, lineCount } = await writeRunOutput(tx, runId, period.market_id, stream)
  // Restatement items not yet covered: a restatement submitted after the item's decision counted its order or event
  // (the sandbox refuses undecided items), so once approved or applied the item needs no reviewer attention.
  const { rows: skipped } = await tx.query<{ id: string }>(
    `SELECT lt.id ${LATE_ITEMS_OF_CALENDAR}
       AND NOT EXISTS (SELECT 1 FROM restatement s WHERE s.period_id = lt.original_period_id AND s.state IN ('approved', 'applied')
                         AND s.created_at > lt.decided_at)
     ORDER BY lt.id`,
    [period.calendar_id, period.id, 'restatement'],
  )
  const totals = totalsOf(summary)
  await tx.query(
    `UPDATE run SET state = 'calculated', totals = $2, inputs_hash = $3, lines_hash = $4, outputs = $5, finished_at = now(),
       progress = NULL WHERE id = $1`,
    [runId, totals, summary.inputsHash, linesHash, outputsOf(summary, { origin_skipped: skipped.map((s) => s.id) })],
  )
  const { rows: discarded } = await tx.query<{ id: string }>(
    `UPDATE run SET state = 'discarded' WHERE period_id = $1 AND state = 'calculated' AND id <> $2 RETURNING id`,
    [row.period_id, runId],
  )
  for (const old of discarded) {
    await recordAudit(tx, { action: 'RUN.DISCARDED', objectType: 'run', objectId: old.id, after: { superseded_by: runId } })
  }
  await tx.query(`UPDATE period SET state = 'calculated' WHERE id = $1 AND state = 'calculating'`, [row.period_id])
  await recordAudit(tx, {
    action: 'RUN.CALCULATED', objectType: 'run', objectId: runId,
    after: { gross_minor: totals.gross_minor, line_count: lineCount, period_state: 'calculated' },
  })
}

function errorOf(error: unknown): { code: string; message: string; details: Record<string, unknown> } {
  if (error instanceof EngineError) return { code: error.code, message: error.message, details: { ...error.details } }
  if (error instanceof ApiError) return { code: error.code, message: error.message, details: (error.details ?? {}) as Record<string, unknown> }
  if (error instanceof SnapshotCorrupt) return { code: 'SNAPSHOT_CORRUPT', message: error.message, details: {} }
  return { code: 'INTERNAL', message: 'The calculation failed unexpectedly; the error is in the server log.', details: {} }
}

/** ENGINE C3: failed; the period returns to calculated when a calculated run exists, else to open. */
export async function failRun(tx: Tx, runId: string, error: unknown): Promise<void> {
  const row = await lockedRun(tx, runId)
  if (row.state !== 'queued' && row.state !== 'running') return
  const failure = errorOf(error)
  await tx.query(`UPDATE run SET state = 'failed', error = $2, finished_at = now(), progress = NULL WHERE id = $1`, [runId, failure])
  const { rows } = await tx.query<{ state: string }>(
    `UPDATE period SET state = CASE WHEN EXISTS (SELECT 1 FROM run WHERE period_id = $1 AND state = 'calculated') THEN 'calculated' ELSE 'open' END
     WHERE id = $1 AND state = 'calculating' RETURNING state`,
    [row.period_id],
  )
  await recordAudit(tx, {
    action: 'RUN.FAILED', objectType: 'run', objectId: runId, after: { error: { code: failure.code }, period_state: rows[0]?.state ?? null },
  })
}

const isTransient = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && TRANSIENT_SQLSTATE.test(error.code)

/** Whether pg-boss will not retry the job after this attempt (retry_count reached retry_limit). */
async function lastAttempt(tx: Tx, jobId: string): Promise<boolean> {
  const { rows } = await tx.query<{ last: boolean }>('SELECT retry_count >= retry_limit AS last FROM pgboss.job WHERE name = $1 AND id = $2', [
    calculateRunJob.name, jobId,
  ])
  return rows[0]?.last ?? false
}

/**
 * The job's own transaction only names the tenant: tx A, the progress update, tx B and a failure each commit on their
 * own (D-B3-09). shortcut: the job transaction stays open idle meanwhile (lib/jobs runs a tenant job inside one); give
 * TenantJob a transaction-free variant if worker connections run short.
 */
async function calculateRun(tx: Tx, runId: string, ctx: JobContext): Promise<void> {
  const { rows } = await tx.query<{ tenant_id: string }>('SELECT app_tenant_id() AS tenant_id')
  const inOwnTx = <T>(fn: (own: Tx) => Promise<T>): Promise<T> =>
    runInTenant({ tenantId: rows[0]!.tenant_id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null }, fn)
  try {
    const input = await inOwnTx((own) => prepareRun(own, runId))
    if (input === null) return
    const stream = startedRun(input)
    await inOwnTx((own) => own.query(`UPDATE run SET progress = 'Writing results' WHERE id = $1 AND state = 'running'`, [runId]))
    await inOwnTx((own) => finishRun(own, runId, stream))
  } catch (error) {
    const transient = isTransient(error)
    if (transient && !(await lastAttempt(tx, ctx.jobId))) throw error
    ctx.log.error({ err: error, runId }, 'commission run failed')
    await inOwnTx((own) => failRun(own, runId, transient ? retriesExhausted() : error))
  }
}

export const calculateRunJob = defineTenantJob({
  name: 'comp.run.calculate',
  payload: z.object({ runId: z.uuid() }),
  run: (tx, payload, ctx) => calculateRun(tx, payload.runId, ctx),
})
