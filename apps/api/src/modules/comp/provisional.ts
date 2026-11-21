import type { Tx } from '@nmp/db'
import type { AdjustmentOrigin } from '@nmp/engine'
import { ApiError } from '../../lib/errors.js'
import type { PeriodRow } from './period.js'
import type { Blocker } from './preflight.js'
import { runInScope } from './views.js'

// D-V1A-02 (FR-COMP-011): a provisional calendar's periods run like any period; the final period containing them trues
// them up through one adjustment origin of type 'provisional' per (committed provisional run, payee position, rule key),
// amount = -Σ that run's lines for the pair, which the engine pays in pass 9 like a late origin. SQL contracts:
// provisional_final_period, provisional_periods_of (0801).

const finalCommitted = (finalPeriodId: string | null) =>
  new ApiError(409, 'FINAL_PERIOD_COMMITTED', 'The final period containing this provisional period is already committed.', { final_period_id: finalPeriodId })

/**
 * Run preflight additions (POST runs and the period blockers), first in the list: a provisional period whose final
 * period is committed, whose calendar is in another plan than its final calendar or whose rules pay in credits; a final
 * period while a nested provisional period has a run not yet committed.
 */
export async function provisionalBlockers(tx: Tx, period: PeriodRow): Promise<Blocker[]> {
  if (period.provisional_for_calendar_id === null) {
    const { rows } = await tx.query<{ period_id: string }>(
      `SELECT period_id FROM provisional_periods_of($1) WHERE run_state IN ('queued', 'running', 'calculated') ORDER BY starts_at`, [period.id])
    return rows.length === 0 ? [] : [{
      status: 409, code: 'PROVISIONAL_RUN_OPEN', message: 'Commit or discard the runs of the provisional periods inside this period first.',
      details: { period_ids: rows.map((r) => r.period_id) },
    }]
  }
  const { rows } = await tx.query<{ final_period_id: string | null; committed: boolean; same_plan: boolean; credit_rules: string[] }>(
    `SELECT f.id AS final_period_id,
            EXISTS (SELECT 1 FROM run r WHERE r.period_id = f.id AND r.state = 'committed') AS committed,
            (SELECT plan_id FROM plan_calendar WHERE calendar_id = $2) IS NOT DISTINCT FROM (SELECT plan_id FROM plan_calendar WHERE calendar_id = $3) AS same_plan,
            ARRAY(SELECT b ->> 'key' FROM plan_version v CROSS JOIN jsonb_array_elements(v.compiled -> $2::text -> 'bonuses') b
                  WHERE v.id = plan_version_for_period($1) AND b ? 'award' ORDER BY 1) AS credit_rules
     FROM (SELECT provisional_final_period($1) AS id) f`,
    [period.id, period.calendar_id, period.provisional_for_calendar_id],
  )
  const row = rows[0]!
  const blockers: Blocker[] = []
  if (row.committed) {
    const e = finalCommitted(row.final_period_id)
    blockers.push({ status: 409, code: e.code, message: e.message, details: { final_period_id: row.final_period_id } })
  }
  if (!row.same_plan) {
    blockers.push({ status: 422, code: 'PROVISIONAL_PLAN_MISMATCH', message: 'A provisional calendar and its final calendar must belong to one plan.', details: {} })
  }
  if (row.credit_rules.length > 0) {
    blockers.push({
      status: 422, code: 'PROVISIONAL_CREDIT_RULE', message: 'Rules of a provisional calendar cannot pay in credits: credits are not trued up.',
      details: { rule_keys: row.credit_rules },
    })
  }
  return blockers
}

const OFFSETS = `
  SELECT pp.run_id, pp.period_id, l.payee_position_id, l.rule_key, min(l.source_kind) AS source_kind, -sum(l.amount_minor) AS amount_minor
  FROM provisional_periods_of($1) pp JOIN result_line l ON l.run_id = pp.run_id
  WHERE pp.run_state = 'committed'
  GROUP BY pp.run_id, pp.period_id, l.payee_position_id, l.rule_key HAVING sum(l.amount_minor) <> 0`

/** tx A of a run of a final period: its provisional origins (none for any other period), inserted and returned for the snapshot. */
export async function provisionalOrigins(tx: Tx, runId: string, period: PeriodRow): Promise<AdjustmentOrigin[]> {
  const { rows } = await tx.query<{
    id: string; payee_position_id: string; rule_key: string; source_kind: AdjustmentOrigin['sourceKind']; amount_minor: string; original_period_id: string
  }>(
    `INSERT INTO adjustment_origin (tenant_id, origin_type, provisional_run_id, run_id, payee_position_id, rule_key, source_kind, amount_minor,
       original_period_id)
     SELECT app_tenant_id(), 'provisional', o.run_id, $2, o.payee_position_id, o.rule_key, o.source_kind, o.amount_minor, o.period_id
     FROM (${OFFSETS}) o ORDER BY o.run_id, o.payee_position_id, o.rule_key
     RETURNING id, payee_position_id, rule_key, source_kind, amount_minor::text, original_period_id`,
    [period.id, runId],
  )
  return rows.map((row) => ({
    originType: 'provisional', originId: row.id, payeePositionId: row.payee_position_id, ruleKey: row.rule_key, sourceKind: row.source_kind,
    amountMinor: BigInt(row.amount_minor), originalPeriodId: row.original_period_id, reasonCode: null,
  }))
}

/**
 * Commit, under the market's periods lock: a provisional run whose final period got committed is refused; a final run
 * commits only with exactly the offsets of the committed provisional runs now (one committed since its snapshot =
 * 409 RUN_SUPERSEDED provisional_changed). The SQL run guard (0807) is the backstop of both.
 */
export async function provisionalGate(tx: Tx, period: PeriodRow, runId: string): Promise<void> {
  if (period.provisional_for_calendar_id !== null) {
    const committed = (await provisionalBlockers(tx, period)).find((b) => b.code === 'FINAL_PERIOD_COMMITTED')
    if (committed !== undefined) throw finalCommitted(committed.details.final_period_id as string)
    return
  }
  const { rows } = await tx.query<{ changed: boolean }>(
    `WITH expected AS (SELECT run_id, payee_position_id, rule_key, amount_minor FROM (${OFFSETS}) o),
          carried AS (SELECT provisional_run_id AS run_id, payee_position_id, rule_key, amount_minor FROM adjustment_origin
                      WHERE run_id = $2 AND provisional_run_id IS NOT NULL)
     SELECT EXISTS (SELECT * FROM expected EXCEPT SELECT * FROM carried) OR EXISTS (SELECT * FROM carried EXCEPT SELECT * FROM expected) AS changed`,
    [period.id, runId],
  )
  if (rows[0]!.changed) {
    throw new ApiError(409, 'RUN_SUPERSEDED', 'A newer calculation or input applies to this period: run it again.', { reason: 'provisional_changed' })
  }
}

/** 0801/0807 refusals raised by SQL (check_violation DETAIL), as the API codes of D-V1A-02; null for any other error. */
export function provisionalRefusal(error: unknown): ApiError | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== '23514' || !('detail' in error)) return null
  if (error.detail === 'final_period_committed') return finalCommitted(null)
  if (error.detail === 'provisional_changed') {
    return new ApiError(409, 'RUN_SUPERSEDED', 'A newer calculation or input applies to this period: run it again.', { reason: 'provisional_changed' })
  }
  return null
}

interface TrueUpPayee {
  readonly participant_id: string
  readonly external_ref: string
  readonly final_minor: string
  readonly provisional_minor: string
  readonly true_up_minor: string
}

/**
 * GET /v1/runs/:id/true-up (AC-COMP11-7): per payee the final amount (every line but the advance offsets), the advances
 * paid (minus the offsets) and the true-up (Σ the payee's lines); totals over all payees (Σ true-up = run gross).
 * 422 NOT_A_FINAL_RUN without provisional origins.
 */
export async function trueUp(tx: Tx, runId: string, scope: readonly string[] | null, after: string | undefined, limit: number) {
  const run = await runInScope(tx, runId, scope)
  const { rows: runs } = await tx.query<{ run_id: string; period_id: string; starts_at: Date; ends_at: Date; committed_at: Date; gross_minor: string }>(
    `SELECT r.id AS run_id, p.id AS period_id, p.starts_at, p.ends_at, r.committed_at,
            (SELECT coalesce(sum(l.amount_minor), 0) FROM result_line l WHERE l.run_id = r.id)::text AS gross_minor
     FROM run r JOIN period p ON p.id = r.period_id
     WHERE r.id IN (SELECT provisional_run_id FROM adjustment_origin WHERE run_id = $1 AND provisional_run_id IS NOT NULL)
     ORDER BY p.starts_at, r.id`,
    [runId],
  )
  if (runs.length === 0) throw new ApiError(422, 'NOT_A_FINAL_RUN', 'This run trues up no provisional runs.')
  const perPayee = `
    SELECT l.payee_participant_id AS participant_id, pa.external_ref,
           coalesce(sum(l.amount_minor) FILTER (WHERE l.origin_type IS DISTINCT FROM 'provisional'), 0) AS final_minor,
           -coalesce(sum(l.amount_minor) FILTER (WHERE l.origin_type = 'provisional'), 0) AS provisional_minor,
           sum(l.amount_minor) AS true_up_minor
    FROM result_line l JOIN participant pa ON pa.id = l.payee_participant_id WHERE l.run_id = $1
    GROUP BY l.payee_participant_id, pa.external_ref`
  const { rows: payees } = await tx.query<TrueUpPayee>(
    `SELECT participant_id, external_ref, final_minor::text, provisional_minor::text, true_up_minor::text FROM (${perPayee}) x
     WHERE $2::uuid IS NULL OR participant_id > $2 ORDER BY participant_id LIMIT $3`,
    [runId, after ?? null, limit + 1],
  )
  const { rows: totals } = await tx.query<{ final_minor: string; provisional_minor: string; true_up_minor: string }>(
    `SELECT coalesce(sum(final_minor), 0)::text AS final_minor, coalesce(sum(provisional_minor), 0)::text AS provisional_minor,
            coalesce(sum(true_up_minor), 0)::text AS true_up_minor FROM (${perPayee}) x`,
    [runId],
  )
  const { rows: final } = await tx.query<{ id: string; starts_at: Date; ends_at: Date }>('SELECT id, starts_at, ends_at FROM period WHERE id = $1', [run.period_id])
  return {
    final_period: final[0]!,
    provisional_runs: runs,
    payees: payees.map(({ participant_id: id, external_ref, ...amounts }) => ({ participant: { id, external_ref }, ...amounts })),
    totals: totals[0]!,
  }
}
