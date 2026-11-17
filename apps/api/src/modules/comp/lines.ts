import type { Tx } from '@nmp/db'
import { ENGINE_VERSION, explain, replay, run as calculate, type ResultLine, type Snapshot } from '@nmp/engine'
import type { FastifyBaseLogger } from 'fastify'
import { recordAudit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { recordExport } from '../../lib/exports.js'
import { storedInput } from './inputs.js'
import { loadPeriod } from './period.js'
import { jsonText, linesHash } from './results.js'
import { readSnapshot, SnapshotCorrupt } from './snapshot.js'
import { runInScope, type RunView } from './views.js'

// FR-COMP-005/007/008: result lines (list, CSV), a line's trace with expansion by replay, and replay of a run.

export const LINES_CSV_CAP = 50_000
const CALCULATED = ['calculated', 'committed', 'discarded']

export interface LineFilter {
  readonly payee_participant_id?: string | undefined
  readonly payee_position_id?: string | undefined
  readonly rule_key?: string | undefined
  readonly origin_type?: string | undefined
}

const LINE_COLUMNS = `id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass, amount_minor::text AS amount_minor,
  currency, origin_type, origin_id, original_period_id`
const FILTER = `run_id = $1 AND ($2::uuid IS NULL OR payee_participant_id = $2) AND ($3::uuid IS NULL OR payee_position_id = $3)
  AND ($4::text IS NULL OR rule_key = $4) AND ($5::text IS NULL OR origin_type = $5)`
const filterParams = (runId: string, f: LineFilter) => [runId, f.payee_participant_id ?? null, f.payee_position_id ?? null, f.rule_key ?? null, f.origin_type ?? null]

/** One page of a run's lines by id. */
export async function listLines(tx: Tx, runId: string, scope: readonly string[] | null, filter: LineFilter, after: string | undefined, limit: number) {
  await runInScope(tx, runId, scope)
  const { rows } = await tx.query<{ id: string }>(
    `SELECT ${LINE_COLUMNS} FROM result_line WHERE ${FILTER} AND ($6::uuid IS NULL OR id > $6) ORDER BY id LIMIT $7`,
    [...filterParams(runId, filter), after ?? null, limit + 1],
  )
  return rows
}

export type LinesCsv = { readonly refused: { rowCount: number; rowCap: number }; readonly csv?: never } | { readonly csv: string; readonly refused?: never }

/** The CSV of every matching line, recorded as an export (refused above LINES_CSV_CAP, the refusal is audited too). */
export async function linesCsv(tx: Tx, runId: string, scope: readonly string[] | null, filter: LineFilter): Promise<LinesCsv> {
  await runInScope(tx, runId, scope)
  const { rows: counted } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM result_line WHERE ${FILTER}`, filterParams(runId, filter))
  const decision = await recordExport(tx, { kind: 'run_lines', filters: { run_id: runId, ...filter }, rowCount: counted[0]!.n, rowCap: LINES_CSV_CAP })
  if (decision.refused) return { refused: { rowCount: decision.rowCount, rowCap: decision.rowCap } }
  const { rows } = await tx.query<Record<string, unknown>>(`SELECT ${LINE_COLUMNS} FROM result_line WHERE ${FILTER} ORDER BY id`, filterParams(runId, filter))
  const header = ['id', 'payee_position_id', 'payee_participant_id', 'rule_key', 'bonus_type', 'source_kind', 'pass', 'amount_minor', 'currency',
    'origin_type', 'origin_id', 'original_period_id']
  return { csv: toCsv(header, rows.map((row) => header.map((key) => row[key]))) }
}

function assertReplayable(run: RunView): void {
  if (!CALCULATED.includes(run.state)) throw new ApiError(409, 'RUN_NOT_CALCULATED', 'The run has no results to replay.', { state: run.state })
  if (run.engine_version !== ENGINE_VERSION) {
    throw new ApiError(422, 'ENGINE_VERSION_UNAVAILABLE', 'The engine version of this run is not loaded.', {
      engine_version: run.engine_version, loaded: ENGINE_VERSION,
    })
  }
}

/** Expression rules (tier 2) the line's rule depends on, verbatim (FR-PLN-003: expressions travel with their traces). */
async function expressions(tx: Tx, versionId: string, ruleKey: string) {
  const { rows } = await tx.query<{ rule_key: string; expr: unknown }>(
    `WITH RECURSIVE closure(rule_key) AS (
       SELECT $2::text UNION
       SELECT d FROM closure c JOIN plan_rule r ON r.plan_version_id = $1 AND r.rule_key = c.rule_key CROSS JOIN unnest(r.depends_on) AS d)
     SELECT r.rule_key, r.params AS expr FROM plan_rule r JOIN closure c ON c.rule_key = r.rule_key
     WHERE r.plan_version_id = $1
       AND (r.kind = 'measure.derived' OR jsonb_path_exists(r.params, 'strict $.**.kind ? (@ == "expression")'))
     ORDER BY r.rule_key`,
    [versionId, ruleKey],
  )
  return rows
}

const sameLine = (stored: { payee_position_id: string; rule_key: string; origin_type: string | null; origin_id: string | null }) => (l: ResultLine) =>
  l.payeePositionId === stored.payee_position_id && l.ruleKey === stored.rule_key
  && (l.origin?.originType ?? null) === stored.origin_type && (l.origin?.originId ?? null) === stored.origin_id

/**
 * The run's stored snapshot, sha256-checked; null when corrupt, after auditing RUN.REPLAY_FAILED (committed: the route
 * answers 500 SNAPSHOT_CORRUPT outside the transaction, AC-COMP8-1).
 */
async function verifiedSnapshot(tx: Tx, run: RunView, context: Record<string, unknown> = {}): Promise<Snapshot | null> {
  try {
    return await readSnapshot(tx, run.snapshot_id!)
  } catch (error) {
    if (!(error instanceof SnapshotCorrupt)) throw error
    await recordAudit(tx, {
      action: 'RUN.REPLAY_FAILED', objectType: 'run', objectId: run.id, after: { reason: 'SNAPSHOT_CORRUPT', snapshot_id: run.snapshot_id, ...context },
    })
    return null
  }
}

/** GET /v1/result-lines/:id/trace: the stored compact trace; with expand, the full trace and explanation from a replay. */
export async function lineTrace(tx: Tx, id: string, scope: readonly string[] | null, expand: boolean, log: FastifyBaseLogger) {
  const { rows } = await tx.query<{ run_id: string; payee_position_id: string; rule_key: string; origin_type: string | null; origin_id: string | null; amount_minor: string; trace: unknown }>(
    `SELECT run_id, ${LINE_COLUMNS}, trace FROM result_line WHERE id = $1`,
    [id],
  )
  const stored = rows[0]
  if (stored === undefined) throw notFound()
  const run = await runInScope(tx, stored.run_id, scope)
  const { trace, run_id: _run, ...line } = stored
  const found = { line, trace, explanation: null as unknown, expressions: await expressions(tx, run.plan_version_id, stored.rule_key), expanded: null as unknown }
  if (!expand) return found
  assertReplayable(run)
  const snapshot = await verifiedSnapshot(tx, run, { line_id: id })
  if (snapshot === null) return { corrupt: true } as const
  const input = await storedInput(tx, run, snapshot)
  const full = calculate(input, { fullTraceFor: [{ payeePositionId: stored.payee_position_id, ruleKey: stored.rule_key }] }).lines.find(sameLine(stored))
  if (full === undefined || full.amountMinor.toString() !== stored.amount_minor) {
    log.error({ lineId: id, runId: run.id, replayed: full?.amountMinor.toString() ?? null }, 'trace expansion does not match the stored line')
    throw new ApiError(500, 'TRACE_MISMATCH', 'The replayed trace does not match the stored line.')
  }
  const period = await loadPeriod(tx, run.period_id)
  return { ...found, explanation: explain(full, period.minor_unit), expanded: JSON.parse(jsonText(full.trace)) as unknown }
}

export type ReplayOutcome =
  | { readonly corrupt: true; readonly body?: never }
  | { readonly corrupt?: never; readonly body: { status: string; inputs_hash: string; result_hash: string | null; lines_hash: string | null; engine_version: string } }

/**
 * POST /v1/runs/:id/replay (D-B3-21): the stored snapshot, sha256-checked, through the loaded engine. A corrupt snapshot
 * is audited (RUN.REPLAY_FAILED, committed) and answered 500 SNAPSHOT_CORRUPT by the route.
 */
export async function replayRun(tx: Tx, id: string, scope: readonly string[] | null): Promise<ReplayOutcome> {
  const run = await runInScope(tx, id, scope)
  assertReplayable(run)
  const snapshot = await verifiedSnapshot(tx, run)
  if (snapshot === null) return { corrupt: true }
  const result = replay(await storedInput(tx, run, snapshot), { inputsHash: run.inputs_hash!, resultHash: String(run.outputs!.result_hash) })
  const body = {
    status: result.status, inputs_hash: result.inputsHash, result_hash: result.resultHash,
    lines_hash: result.output === null ? null : linesHash(result.output.lines), engine_version: ENGINE_VERSION,
  }
  await recordAudit(tx, { action: 'RUN.REPLAYED', objectType: 'run', objectId: id, after: { status: body.status, lines_hash: body.lines_hash } })
  return { body }
}
