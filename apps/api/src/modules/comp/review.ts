import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import type { AuthContext } from '../../lib/auth.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { loadPeriod, previousPeriod, runSettings } from './period.js'
import { marketSync, type MarketSync } from './preflight.js'
import { runInScope, type RunView } from './views.js'

// D-B3-11 run review (API-19): comparison, variance, movers, exceptions (stable ids, blocking or info) and what
// changed. The same exceptions gate the commit (D-B3-12).

export const REVIEW_TOP_MOVERS = 20
const REVIEWABLE = ['calculated', 'committed', 'discarded']

export interface RunException {
  readonly id: string
  readonly kind: string
  readonly blocking: boolean
  readonly message: string
  readonly ref: string | null
}

const info = (id: string, kind: string, message: string, ref: string | null = null): RunException => ({ id, kind, blocking: false, message, ref })

/**
 * Exceptions of a run: sync health read as of now (a source that turned stale since the run blocks); the large-line
 * threshold of the settings version the run was calculated under, so review and commit see the same lines.
 */
export async function runExceptions(tx: Tx, run: RunView, sync: MarketSync): Promise<RunException[]> {
  const out: RunException[] = []
  if (sync.blocking.length > 0) {
    out.push({
      id: 'sync_stale', kind: 'sync_stale', blocking: true, ref: null,
      message: `Order sync is ${sync.blocking.map((s) => `${s.state} for ${s.name}`).join(', ')}: orders may be missing from this run.`,
    })
  }
  if (!sync.thresholds_set) out.push(info('sync_thresholds_unset', 'sync_thresholds_unset', 'Sync thresholds are not configured: only failing sources are detected.'))
  const { largeLineMinor } = await runSettings(tx, run.settings_version_id)
  if (largeLineMinor === null) {
    out.push(info('large_line_check_unset', 'large_line_check_unset', 'The large-line check is not configured (runs.exception_thresholds).'))
  } else {
    const { rows } = await tx.query<{ id: string; amount_minor: string }>(
      'SELECT id, amount_minor::text FROM result_line WHERE run_id = $1 AND abs(amount_minor) > $2::bigint ORDER BY id',
      [run.id, largeLineMinor],
    )
    for (const line of rows) {
      out.push({ id: `large_line:${line.id}`, kind: 'large_line', blocking: true, ref: line.id,
        message: `Line amount ${line.amount_minor} (minor units) exceeds the large-line threshold ${largeLineMinor}.` })
    }
  }
  const warnings = (run.outputs?.warnings ?? []) as { code: string; message: string }[]
  for (const code of [...new Set(warnings.map((w) => w.code))].sort()) {
    const ofCode = warnings.filter((w) => w.code === code)
    out.push(info(`warning:${code}`, 'warning', `${ofCode.length} × ${ofCode[0]!.message}`, code))
  }
  // The snapshot carries no engine event for an event without lines (snapshot.ts engineEvents): a reviewer decides.
  const { rows: unreversed } = await tx.query<{ id: string; type: string; refund_minor: string }>(
    `SELECT e.id, e.type, e.refund_minor::text FROM run_snapshot s JOIN order_event e ON e.id = ANY (s.order_event_ids)
     WHERE s.id = $1 AND jsonb_array_length(e.lines) = 0 AND e.type IN ('refund', 'return', 'chargeback', 'cancelled') ORDER BY e.id`,
    [run.snapshot_id],
  )
  for (const e of unreversed) {
    out.push({ id: `unreversed_event:${e.id}`, kind: 'unreversed_event', blocking: true, ref: e.id,
      message: `A ${e.type} of ${e.refund_minor} (minor units) names no order lines: this run does not reverse it, so the order is credited in full.` })
  }
  for (const lateId of (run.outputs?.origin_skipped ?? []) as string[]) {
    out.push(info(`origin_skipped:${lateId}`, 'origin_skipped', 'A late item is handled by restatement: no adjustment line.', lateId))
  }
  const { rows: guardrails } = await tx.query<{ id: string; rule_id: string }>(
    `SELECT id, rule_id FROM guardrail_decision WHERE plan_version_id = $1 AND kind = 'evaluation' AND outcome = 'warned' ORDER BY decided_at, id`,
    [run.plan_version_id],
  )
  for (const g of guardrails) out.push(info(`guardrail:${g.id}`, 'guardrail', `Guardrail ${g.rule_id} warned on this plan version.`, g.id))
  const { rows: restated } = await tx.query<{ id: string }>(
    `SELECT DISTINCT o.restatement_id AS id FROM result_line l JOIN adjustment_origin o ON o.id = l.origin_id
     WHERE l.run_id = $1 AND o.restatement_id IS NOT NULL ORDER BY 1`,
    [run.id],
  )
  for (const r of restated) {
    out.push(info(`restatement_state:${r.id}`, 'restatement_state', 'Qualification state of the restated period is not corrected (money only).', r.id))
  }
  return out
}

/** D-B3-11: the first review by a tenant user outside a support session marks the review opened. */
async function markReviewOpened(tx: Tx, auth: AuthContext, run: RunView): Promise<void> {
  if (auth.realm !== 'tenant' || auth.supportSessionId !== null || run.state !== 'calculated' || run.review_opened_at !== null) return
  const { rowCount } = await tx.query(
    `UPDATE run SET review_opened_at = now(), review_opened_by = app_user_id()
     WHERE id = $1 AND review_opened_at IS NULL AND state = 'calculated'`,
    [run.id],
  )
  if (rowCount === 1) await recordAudit(tx, { action: 'RUN.REVIEW_OPENED', objectType: 'run', objectId: run.id })
}

async function comparisonRun(tx: Tx, run: RunView, compareRunId: string | undefined, scope: readonly string[] | null): Promise<RunView | null> {
  if (compareRunId !== undefined) return runInScope(tx, compareRunId, scope)
  const previous = await previousPeriod(tx, await loadPeriod(tx, run.period_id))
  return previous?.committed_run_id == null ? null : runInScope(tx, previous.committed_run_id, null)
}

const amounts = (rows: { previous_minor: string; current_minor: string }[]) =>
  rows.map((row) => ({ ...row, delta_minor: (BigInt(row.current_minor) - BigInt(row.previous_minor)).toString() }))

async function sideBySide(tx: Tx, run: RunView, comparison: RunView | null) {
  const params = [run.id, comparison?.id ?? null]
  const sums = `coalesce(sum(amount_minor) FILTER (WHERE run_id = $2), 0)::text AS previous_minor,
                coalesce(sum(amount_minor) FILTER (WHERE run_id = $1), 0)::text AS current_minor`
  const { rows: variance } = await tx.query<{ rule_key: string; kind: string; pass: number; previous_minor: string; current_minor: string }>(
    `SELECT rule_key, min(bonus_type) AS kind, min(pass)::int AS pass, ${sums}
     FROM result_line WHERE run_id = $1 OR run_id = $2 GROUP BY rule_key ORDER BY rule_key`,
    params,
  )
  const { rows: movers } = await tx.query<{ participant: unknown; previous_minor: string; current_minor: string }>(
    `SELECT jsonb_build_object('id', pa.id, 'external_ref', pa.external_ref, 'display_name', pa.display_name) AS participant, t.previous_minor, t.current_minor
     FROM (SELECT payee_participant_id, ${sums}, abs(coalesce(sum(amount_minor) FILTER (WHERE run_id = $1), 0)
                    - coalesce(sum(amount_minor) FILTER (WHERE run_id = $2), 0)) AS moved
           FROM result_line WHERE run_id = $1 OR run_id = $2 GROUP BY payee_participant_id) t
     JOIN participant pa ON pa.id = t.payee_participant_id
     ORDER BY t.moved DESC, pa.id LIMIT ${REVIEW_TOP_MOVERS}`,
    params,
  )
  const { rows: adjustments } = await tx.query(
    `SELECT origin_type, count(*)::int AS count, sum(amount_minor)::text AS amount_minor FROM result_line
     WHERE run_id = $1 AND origin_type IS NOT NULL GROUP BY origin_type ORDER BY origin_type`,
    [run.id],
  )
  return { variance: amounts(variance), movers: amounts(movers), adjustments }
}

async function rowCountsOf(tx: Tx, run: RunView | null): Promise<unknown> {
  if (run?.snapshot_id == null) return null
  const { rows } = await tx.query<{ counts: unknown }>(`SELECT row_counts - 'late_item_ids' AS counts FROM run_snapshot WHERE id = $1`, [run.snapshot_id])
  return rows[0]!.counts
}

/** GET /v1/runs/:id/review. */
export async function reviewRun(tx: Tx, auth: AuthContext, id: string, compareRunId: string | undefined, scope: readonly string[] | null) {
  const run = await runInScope(tx, id, scope)
  if (!REVIEWABLE.includes(run.state)) throw new ApiError(409, 'RUN_NOT_CALCULATED', 'The run has no results to review.', { state: run.state })
  if (compareRunId === id) throw notFound()
  await markReviewOpened(tx, auth, run)
  const comparison = await comparisonRun(tx, run, compareRunId, scope)
  const sync = await marketSync(tx, run.market_id)
  const { variance, movers, adjustments } = await sideBySide(tx, run, comparison)
  const report = (run.outputs?.transition_report ?? []) as unknown[]
  return {
    run: await tx.query('SELECT id, period_id, state, prepared_by, review_opened_at, review_opened_by, commit_requested_at, commit_requested_by FROM run WHERE id = $1', [id]).then((r) => r.rows[0]),
    comparison: comparison === null ? null : { run_id: comparison.id, period: await loadPeriod(tx, comparison.period_id).then((p) => ({ id: p.id, starts_at: p.starts_at, ends_at: p.ends_at })) },
    totals: { current: run.totals, previous: comparison?.totals ?? null },
    variance,
    movers,
    exceptions: await runExceptions(tx, run, sync),
    changes: {
      plan_version_changed: comparison !== null && comparison.plan_version_id !== run.plan_version_id,
      previous_plan_version: comparison?.plan_version_id ?? null,
      settings_version_changed: comparison !== null && comparison.settings_version_id !== run.settings_version_id,
      inputs: { current: await rowCountsOf(tx, run), previous: await rowCountsOf(tx, comparison) },
      transition_changes: report.length,
      cap_applications: run.outputs?.cap_applications ?? [],
    },
    adjustments,
    sync: { state: sync.state, last_sync_at: sync.last_sync_at, sources: sync.sources },
  }
}

interface TransitionChange { positionId: string; stateItem: string; before: string; after: string }

/** GET /v1/runs/:id/transitions: the pass-0 report grouped by position, paged by position id. */
export async function runTransitions(tx: Tx, id: string, scope: readonly string[] | null, after: string | undefined, limit: number) {
  const run = await runInScope(tx, id, scope)
  if (!REVIEWABLE.includes(run.state)) throw new ApiError(409, 'RUN_NOT_CALCULATED', 'The run has no results to review.', { state: run.state })
  const report = (run.outputs?.transition_report ?? []) as TransitionChange[]
  const positions = [...new Set(report.map((c) => c.positionId))].sort().filter((p) => after === undefined || p > after)
  const page = positions.slice(0, limit + 1)
  const { rows } = await tx.query<{ position_id: string; participant: unknown }>(
    `SELECT p.id AS position_id, jsonb_build_object('id', pa.id, 'external_ref', pa.external_ref, 'display_name', pa.display_name) AS participant
     FROM position p JOIN participant pa ON pa.id = gen_owner_at(p.id, now()) WHERE p.id = ANY ($1::uuid[])`,
    [page],
  )
  const owners = new Map(rows.map((row) => [row.position_id, row.participant]))
  return page.map((positionId) => ({
    position_id: positionId,
    participant: owners.get(positionId) ?? null,
    changed: report.filter((c) => c.positionId === positionId).map((c) => ({ state_item: c.stateItem, before: c.before, after: c.after })),
  }))
}
