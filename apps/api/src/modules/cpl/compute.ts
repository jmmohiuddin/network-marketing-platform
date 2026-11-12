import { ComplianceInputError, type ReportPeriod } from '@nmp/compliance'
import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { defineTenantJob, type JobContext } from '../../lib/jobs.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { reproduce, SnapshotInputError } from './inputs.js'
import { SNAPSHOT_COLUMNS, toSnapshot, type SnapshotRecord } from './snapshot-row.js'

// Only counts are stored; drill-down recomputes the ids (drill.ts), so none are kept here.
const NO_DRILL_IDS = 0

const INTERNAL_FAILURE =
  'The snapshot could not be computed because of an internal error, which has been logged. Create a new snapshot; if it fails again, contact support.'

// SQLSTATE classes the queue retries: connection, transaction rollback (deadlock, serialization), insufficient
// resources, operator intervention, system error. Every other error would repeat on each attempt.
const TRANSIENT_SQLSTATE = /^(08|40|53|57|58)/

function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && TRANSIENT_SQLSTATE.test(code)
}

/** compliance_figure.period: first day of the month, or 1 January for a year (period_kind tells them apart). */
export function periodDate(period: string): string {
  return period.length === 'YYYY'.length ? `${period}-01-01` : `${period}-01`
}

/** One row per figure, then one per omitted indicator (unit NULL, reason in note), in the method's order. */
function figureRecords(period: ReportPeriod) {
  const common = {
    report: period.report, period: periodDate(period.period), period_kind: period.periodKind, partial: period.partial,
    period_notes: period.notes,
  }
  const computed = period.figures.map((figure, position) => ({
    ...common, position, key: figure.key, unit: figure.unit, value: figure.value,
    numerator: figure.numerator?.toString() ?? null, denominator: figure.denominator?.toString() ?? null,
    population_count: figure.populationCount, population: figure.population, method: figure.method,
    method_version: figure.methodVersion, note: figure.note,
  }))
  const omitted = period.omitted.map((indicator, index) => ({
    ...common, position: period.figures.length + index, key: indicator.key, unit: null, value: null, numerator: null,
    denominator: null, population_count: null, population: null, method: null, method_version: null, note: indicator.reason,
  }))
  return [...computed, ...omitted]
}

async function insertFigures(tx: Tx, snapshotId: string, periods: readonly ReportPeriod[]): Promise<number> {
  const records = periods.flatMap(figureRecords)
  // Values travel as JSON strings, so numeric keeps the stated scale and bigints keep every digit.
  await tx.query(
    `INSERT INTO compliance_figure (tenant_id, snapshot_id, report, period, period_kind, position, key, unit, value_num,
       numerator, denominator, population_count, population, method, method_version, note, partial, period_notes)
     SELECT app_tenant_id(), $1, r.report, r.period, r.period_kind, r.position, r.key, r.unit, r.value, r.numerator,
       r.denominator, r.population_count, r.population, r.method, r.method_version, r.note, r.partial,
       ARRAY(SELECT jsonb_array_elements_text(r.period_notes))
     FROM jsonb_to_recordset($2::jsonb) AS r(report text, period date, period_kind text, position int, key text,
       unit text, value numeric, numerator bigint, denominator bigint, population_count int, population text,
       method text, method_version text, note text, partial boolean, period_notes jsonb)`,
    [snapshotId, JSON.stringify(records)],
  )
  return records.length
}

interface Outcome {
  readonly state: 'ready' | 'failed'
  readonly reason: string | null
  readonly figures: number
}

async function finish(tx: Tx, snapshot: Pick<SnapshotRecord, 'id' | 'market_id'>, outcome: Outcome): Promise<void> {
  await tx.query('UPDATE compliance_report_snapshot SET state = $2, failure_reason = $3 WHERE id = $1', [
    snapshot.id, outcome.state, outcome.reason,
  ])
  await recordAudit(tx, {
    action: outcome.state === 'ready' ? 'SNAPSHOT.READY' : 'SNAPSHOT.FAILED', objectType: 'compliance_report_snapshot',
    objectId: snapshot.id, before: { state: 'computing' }, after: { state: outcome.state, figure_count: outcome.figures },
  })
  if (outcome.state === 'ready') {
    await enqueueOutbox(tx, {
      type: 'compliance.snapshot.ready', key: snapshot.id, payload: { snapshot_id: snapshot.id, market_id: snapshot.market_id },
    })
  }
}

/**
 * The snapshot, locked, if it is still computing. Lock order as every other snapshot state change (migration
 * 0031): the market's input lock, then the snapshot row, then (in finish) the tenant audit chain.
 */
async function lockComputing(tx: Tx, snapshotId: string): Promise<SnapshotRecord | null> {
  const { rows: found } = await tx.query<{ market_id: string }>('SELECT market_id FROM compliance_report_snapshot WHERE id = $1', [
    snapshotId,
  ])
  if (found[0] === undefined) return null
  await tx.query('SELECT cpl_lock_inputs(app_tenant_id(), $1)', [found[0].market_id])
  const { rows } = await tx.query<SnapshotRecord>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM compliance_report_snapshot WHERE id = $1 AND state = 'computing' FOR UPDATE`,
    [snapshotId],
  )
  return rows[0] ?? null
}

// Facts or recorded versions that cannot be computed on fail the snapshot with their own reason.
async function computeAndStore(tx: Tx, record: SnapshotRecord): Promise<Outcome> {
  const snapshot = toSnapshot(record)
  try {
    const { periods } = await reproduce(tx, snapshot, NO_DRILL_IDS)
    return { state: 'ready', reason: null, figures: await insertFigures(tx, snapshot.id, periods) }
  } catch (error) {
    if (error instanceof ComplianceInputError || error instanceof SnapshotInputError) return { state: 'failed', reason: error.message, figures: 0 }
    throw error
  }
}

/**
 * computing -> ready (figures stored) | failed (reason stored). A snapshot that is no longer computing (done
 * already, or retired by an input change before it ran) is left alone, so a repeated job changes nothing.
 * Transient database errors are rethrown for the queue to retry; any other error fails the snapshot, which
 * would otherwise stay computing once the retries are spent.
 */
async function computeSnapshot(tx: Tx, snapshotId: string, log: JobContext['log']): Promise<void> {
  const record = await lockComputing(tx, snapshotId)
  if (record === null) return
  await tx.query('SAVEPOINT cpl_compute')
  const outcome = await computeAndStore(tx, record).catch(async (error: unknown): Promise<Outcome> => {
    if (isTransient(error)) throw error
    log.error({ err: error, snapshotId }, 'compliance snapshot computation failed')
    await tx.query('ROLLBACK TO SAVEPOINT cpl_compute')
    return { state: 'failed', reason: INTERNAL_FAILURE, figures: 0 }
  })
  await finish(tx, record, outcome)
}

/** FR-CPL-006: report computation runs as a job (API-04 is asynchronous). */
export const computeSnapshotJob = defineTenantJob({
  name: 'cpl.compute-snapshot',
  payload: z.strictObject({ snapshotId: z.uuid() }),
  async run(tx, { snapshotId }, ctx) {
    await computeSnapshot(tx, snapshotId, ctx.log)
  },
})
