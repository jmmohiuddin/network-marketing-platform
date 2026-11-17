import { eligibleApprovers, type Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import type { AuthContext } from '../../lib/auth.js'
import { ApiError } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { approveOrRefuse } from '../ten/index.js'
import { loadPeriod, lockMarketPeriods, lockRunKey, settingsVersionAt } from './period.js'
import { marketSync } from './preflight.js'
import { runExceptions } from './review.js'
import { runInScope, type RunView } from './views.js'

// D-B3-12: commit without ledger (B4 posts from committed lines). One transaction: the run lock, then the market's
// periods lock (late detection waits), staleness gates, SoD approval, then run, period, origins, late items,
// restatements, the late catch-up and the outbox event.

const superseded = (reason: string, details: Record<string, unknown> = {}) =>
  new ApiError(409, 'RUN_SUPERSEDED', 'A newer calculation or input applies to this period: run it again.', { reason, ...details })

/** POST /v1/runs/:id/request-commit: recorded once by the preparer's side; returns who may commit. */
export async function requestCommit(tx: Tx, id: string, scope: readonly string[] | null) {
  const run = await runInScope(tx, id, scope, true)
  if (run.state !== 'calculated') throw new ApiError(409, 'RUN_NOT_CALCULATED', 'Only a calculated run can be committed.', { state: run.state })
  const { rows } = await tx.query<{ commit_requested_at: Date; commit_requested_by: string }>(
    `UPDATE run SET commit_requested_at = now(), commit_requested_by = app_user_id()
     WHERE id = $1 AND commit_requested_at IS NULL RETURNING commit_requested_at, commit_requested_by`,
    [id],
  )
  if (rows[0] !== undefined) await recordAudit(tx, { action: 'RUN.COMMIT_REQUESTED', objectType: 'run', objectId: id })
  const { rows: current } = await tx.query<{ commit_requested_at: Date; commit_requested_by: string }>(
    'SELECT commit_requested_at, commit_requested_by FROM run WHERE id = $1', [id],
  )
  const eligible = await eligibleApprovers(tx, {
    permission: 'run.commit', marketId: run.market_id, excludeUserIds: [run.prepared_by, current[0]!.commit_requested_by],
  })
  return { commit_requested_at: current[0]!.commit_requested_at, eligible_approvers: eligible }
}

async function stalenessGates(tx: Tx, run: RunView): Promise<string[]> {
  const { rows: newer } = await tx.query('SELECT 1 FROM run WHERE period_id = $1 AND state IN (\'queued\', \'running\')', [run.period_id])
  if (newer.length > 0) throw superseded('newer_run')
  const { rows: version } = await tx.query<{ id: string | null }>('SELECT plan_version_for_period($1) AS id', [run.period_id])
  if (version[0]!.id !== run.plan_version_id) throw superseded('plan_version_changed')
  if ((await settingsVersionAt(tx, run.period_id)) !== run.settings_version_id) throw superseded('settings_version_changed')
  const { rows: late } = await tx.query<{ id: string; handling: string; state: string }>(
    `SELECT lt.id, lt.handling, lt.state FROM late_transaction lt, run_snapshot s
     WHERE s.id = $1 AND lt.id = ANY (ARRAY(SELECT jsonb_array_elements_text(s.row_counts -> 'late_item_ids'))::uuid[])
     ORDER BY lt.id FOR UPDATE OF lt`,
    [run.snapshot_id],
  )
  const changed = late.filter((item) => item.handling !== 'adjust' || item.state === 'consumed').map((item) => item.id)
  if (changed.length > 0) throw superseded('late_items_changed', { late_ids: changed })
  return late.map((item) => item.id)
}

/** Postgres check violations raised by the commit's guards: an invariant broke, nothing was committed. */
function invariant(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514') {
    throw new ApiError(500, 'INVARIANT_FAILED', 'The commit broke a ledger invariant and was rolled back.')
  }
  throw error
}

/** POST /v1/runs/:id/commit, inside decideWithSod's idempotent transaction. */
export async function commitRun(tx: Tx, auth: AuthContext, id: string, acknowledged: readonly string[], scope: readonly string[] | null) {
  const visible = await runInScope(tx, id, scope)
  const period = await loadPeriod(tx, visible.period_id)
  await lockRunKey(tx, period)
  await lockMarketPeriods(tx, period.market_id)
  const run = await runInScope(tx, id, scope, true)
  if (run.state === 'discarded') throw superseded('discarded')
  if (run.state !== 'calculated') throw new ApiError(409, 'RUN_NOT_CALCULATED', 'Only a calculated run can be committed.', { state: run.state })
  const lateIds = await stalenessGates(tx, run)
  if (run.review_opened_at === null) throw new ApiError(409, 'REVIEW_NOT_OPENED', 'Open the run review before committing.')
  const missing = (await runExceptions(tx, run, await marketSync(tx, period.market_id)))
    .filter((e) => e.blocking && !acknowledged.includes(e.id)).map((e) => e.id)
  if (missing.length > 0) throw new ApiError(409, 'EXCEPTIONS_NOT_ACKNOWLEDGED', 'Acknowledge every blocking exception.', { exception_ids: missing })
  const approval = await approveOrRefuse(tx, {
    objectType: 'run', objectId: id, preparerId: run.prepared_by, contributorIds: run.commit_requested_by === null ? [] : [run.commit_requested_by],
    excludedIds: [], decision: 'approved', reason: null, factorVerifiedAt: auth.stepUpAt, approverPermission: 'run.commit', marketId: period.market_id,
  })
  const effects = await applyCommit(tx, run, approval.approvalId, lateIds).catch(invariant)
  await enqueueOutbox(tx, { type: 'run.committed', payload: { run_id: id, period_id: run.period_id, gross_minor: run.totals!.gross_minor }, key: id })
  await recordAudit(tx, {
    action: 'RUN.COMMITTED', objectType: 'run', objectId: id,
    after: { approval_id: approval.approvalId, period_id: run.period_id, period_state: 'committed', acknowledged_exceptions: acknowledged, ...effects },
  })
  return { run_id: id, state: 'committed', period_id: run.period_id, totals: run.totals }
}

async function applyCommit(tx: Tx, run: RunView, approvalId: string, lateIds: readonly string[]) {
  await tx.query(`UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`, [run.id, approvalId])
  await tx.query(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [run.period_id, run.id])
  await tx.query(
    `UPDATE adjustment_origin SET consumed_run_id = $1
     WHERE id IN (SELECT origin_id FROM result_line WHERE run_id = $1 AND origin_id IS NOT NULL)`,
    [run.id],
  )
  // A never-decided item is first decided by the committing approver (the B2 guard and CHECKs stay as they are).
  await tx.query(
    `UPDATE late_transaction SET state = 'decided', decided_by = app_user_id(), decided_at = now(), decision_reason = $2
     WHERE id = ANY ($1::uuid[]) AND state = 'pending'`,
    [lateIds, `Adjusted by run ${run.id}`],
  )
  await tx.query(`UPDATE late_transaction SET state = 'consumed', consumed_by_run_id = $2 WHERE id = ANY ($1::uuid[])`, [lateIds, run.id])
  const { rows: applied } = await tx.query<{ id: string }>(
    `UPDATE restatement SET state = 'applied', applied_in_run_id = $1
     WHERE state = 'approved' AND id IN (SELECT o.restatement_id FROM adjustment_origin o WHERE o.consumed_run_id = $1)
     RETURNING id`,
    [run.id],
  )
  const { rows: caughtUp } = await tx.query<{ id: string }>('SELECT id FROM comp_late_catch_up($1) AS id', [run.id])
  return { consumed_late_ids: lateIds, applied_restatement_ids: applied.map((r) => r.id), late_catch_up_ids: caughtUp.map((r) => r.id) }
}
