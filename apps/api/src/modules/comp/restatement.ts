import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'
import { engineSettings } from './inputs.js'
import { loadPeriod, lockMarketPeriods } from './period.js'
import { calculateSimulation } from './simulations.js'
import { buildSnapshot, planFor, readSnapshot, rowCounts, storeSnapshot } from './snapshot.js'

// D-B3-14: restatement = case type 'restatement' on a committed period. Submit runs the sandbox synchronously and
// stores the diff net of applied origins; approval turns the diff into adjustment origins the next run of the
// calendar pays. Committed P never changes. Money only: P's qualification state stays as committed.

export const RESTATEMENT_REASON_CODES = ['ENGINE_DEFECT', 'INPUT_CORRECTION', 'GENEALOGY_CORRECTION', 'LATE_TRANSACTION', 'DISPUTE_UPHELD'] as const
const payload = z.strictObject({ note: z.string().trim().min(1).max(2000) })
type Payload = z.infer<typeof payload>

interface DiffLine {
  readonly payee_position_id: string
  readonly payee_participant_id: string
  readonly rule_key: string
  readonly source_kind: string
  readonly committed_minor: string
  readonly applied_adjustments_minor: string
  readonly restated_minor: string
  readonly diff_minor: string
}

interface Diff {
  readonly lines: readonly DiffLine[]
  readonly total_minor: string
}

async function lockPeriodRestatements(tx: Tx, periodId: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('restatement:' || $1, 0))`, [periodId])
}

const COMMITTED = ['committed', 'paid', 'closed']

/** 409 PERIOD_NOT_COMMITTED, or 409 RESTATEMENT_OPEN while another case of P is open/submitted or approved and not applied. */
async function assertRestatable(tx: Tx, periodId: string, caseId: string | null): Promise<void> {
  await lockPeriodRestatements(tx, periodId)
  const period = await loadPeriod(tx, periodId)
  if (period.provisional_for_calendar_id !== null) {
    throw new ApiError(422, 'PROVISIONAL_RUN', 'A provisional run is trued up by its final period, never restated (D-V1A-02).')
  }
  if (!COMMITTED.includes(period.state)) throw new ApiError(409, 'PERIOD_NOT_COMMITTED', 'Only a committed period can be restated.')
  const { rows } = await tx.query<{ id: string }>(
    `SELECT c.id FROM case_file c LEFT JOIN restatement s ON s.case_id = c.id
     WHERE c.type = 'restatement' AND c.subject_type = 'period' AND c.subject_id = $1 AND c.id IS DISTINCT FROM $2
       AND (c.state IN ('open', 'submitted') OR s.state = 'approved')
     LIMIT 1`,
    [periodId, caseId],
  )
  if (rows[0] !== undefined) throw new ApiError(409, 'RESTATEMENT_OPEN', 'This period already has a restatement in progress.', { case_id: rows[0].id })
}

/**
 * sandbox lines − (committed regular lines + consumed origins of P), per (payee position, rule). Manual origins are left
 * out (D-B4-09): the sandbox never recomputes them, so they are never a difference.
 */
async function diffOf(tx: Tx, simulationId: string, runId: string, periodId: string): Promise<Diff> {
  const { rows } = await tx.query<DiffLine>(
    `WITH s AS (SELECT payee_position_id AS pos, rule_key, max(payee_participant_id::text) AS payee, max(source_kind) AS kind, sum(amount_minor) AS a
                FROM sim_result_line WHERE simulation_id = $1 GROUP BY 1, 2),
          c AS (SELECT payee_position_id AS pos, rule_key, max(payee_participant_id::text) AS payee, max(source_kind) AS kind, sum(amount_minor) AS a
                FROM result_line WHERE run_id = $2 AND origin_type IS NULL GROUP BY 1, 2),
          o AS (SELECT o.payee_position_id AS pos, o.rule_key, max(o.source_kind) AS kind, sum(o.amount_minor) AS a
                FROM adjustment_origin o WHERE o.original_period_id = $3 AND o.consumed_run_id IS NOT NULL AND o.origin_type <> 'manual' GROUP BY 1, 2),
          k AS (SELECT pos, rule_key FROM s UNION SELECT pos, rule_key FROM c UNION SELECT pos, rule_key FROM o)
     SELECT k.pos AS payee_position_id,
            coalesce(s.payee, c.payee, (SELECT gen_owner_at(k.pos, p.ends_at - interval '1 microsecond')::text)) AS payee_participant_id,
            k.rule_key, coalesce(s.kind, c.kind, o.kind) AS source_kind, coalesce(c.a, 0)::text AS committed_minor,
            coalesce(o.a, 0)::text AS applied_adjustments_minor, coalesce(s.a, 0)::text AS restated_minor,
            (coalesce(s.a, 0) - coalesce(c.a, 0) - coalesce(o.a, 0))::text AS diff_minor
     FROM k JOIN period p ON p.id = $3 LEFT JOIN s USING (pos, rule_key) LEFT JOIN c USING (pos, rule_key) LEFT JOIN o USING (pos, rule_key)
     ORDER BY k.pos, k.rule_key`,
    [simulationId, runId, periodId],
  )
  return { lines: rows, total_minor: rows.reduce((sum, line) => sum + BigInt(line.diff_minor), 0n).toString() }
}

/** Submit (effect preview): P's sandbox as known now, under P's committed plan and settings versions and prior state. */
async function sandbox(tx: Tx, c: CaseRecord<Payload>) {
  await lockPeriodRestatements(tx, c.subject_id)
  const period = await loadPeriod(tx, c.subject_id)
  // ORD records late items holding this lock shared: none of P appears between the check below and the snapshot.
  await lockMarketPeriods(tx, period.market_id)
  // The sandbox counts every late order and event of P. An adjust item not yet consumed would be counted again by
  // its clawback, and a pending item can still turn into one (its handling changes while pending): both refuse.
  const { rows: pending } = await tx.query<{ id: string }>(
    `SELECT id FROM late_transaction WHERE original_period_id = $1 AND (state = 'pending' OR (handling = 'adjust' AND state = 'decided'))
     ORDER BY id`,
    [c.subject_id],
  )
  if (pending.length > 0) {
    throw new ApiError(409, 'LATE_ITEMS_PENDING',
      'Late items of this period are undecided or waiting for a run: decide them, and commit the run that adjusts them, first.', {
        late_ids: pending.map((p) => p.id),
      })
  }
  if (period.committed_run_id === null) throw new ApiError(409, 'PERIOD_NOT_COMMITTED', 'Only a period committed by a run can be restated.')
  const { rows: runs } = await tx.query<{ plan_version_id: string; settings_version_id: string; snapshot_id: string }>(
    'SELECT plan_version_id, settings_version_id, snapshot_id FROM run WHERE id = $1',
    [period.committed_run_id],
  )
  const committed = runs[0]!
  const { rows: sim } = await tx.query<{ id: string }>(
    `INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, content_hash, requested_by)
     SELECT app_tenant_id(), v.id, $2, 'restatement_sandbox', digest(v.compiled::text, 'sha256'), app_user_id() FROM plan_version v WHERE v.id = $1
     RETURNING id`,
    [committed.plan_version_id, period.id],
  )
  const simulationId = sim[0]!.id
  await recordAudit(tx, {
    action: 'SIMULATION.REQUESTED', objectType: 'simulation', objectId: simulationId,
    after: { kind: 'restatement_sandbox', case_id: c.id, plan_version_id: committed.plan_version_id, period_id: period.id },
  })
  await calculateSimulation(tx, simulationId, async (own) => {
    const stored = await readSnapshot(own, committed.snapshot_id)
    const chain = { priorState: stored.priorState, priorRunId: null, history: stored.history }
    const loaded = await buildSnapshot(own, period, { snapshotId: randomUUID(), chain, adjustments: [] })
    const { rows } = await own.query<{ prior: string | null }>('SELECT prior_state_run_id AS prior FROM run_snapshot WHERE id = $1', [committed.snapshot_id])
    await storeSnapshot(own, loaded, { periodId: period.id, priorRunId: rows[0]!.prior, rowCounts: rowCounts(loaded, []) })
    return {
      input: {
        plan: await planFor(own, committed.plan_version_id, period.calendar_id, period.starts_us),
        settings: await engineSettings(own, committed.settings_version_id), snapshot: loaded.snapshot,
      },
      snapshotId: loaded.snapshot.snapshotId, baselineRunId: period.committed_run_id,
    }
  })
  const { rows: outcome } = await tx.query<{ state: string; error: { code: string } | null }>('SELECT state, error FROM simulation WHERE id = $1', [simulationId])
  if (outcome[0]!.state !== 'completed') {
    throw new ApiError(422, 'SANDBOX_FAILED', 'The restatement sandbox could not calculate the period.', { code: outcome[0]!.error?.code ?? 'INTERNAL' })
  }
  const diff = await diffOf(tx, simulationId, period.committed_run_id, period.id)
  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO restatement (tenant_id, period_id, case_id, simulation_id, state, diff) VALUES (app_tenant_id(), $1, $2, $3, 'calculated', $4) RETURNING id`,
    [period.id, c.id, simulationId, diff],
  )
  await recordAudit(tx, {
    action: 'RESTATEMENT.CALCULATED', objectType: 'restatement', objectId: created[0]!.id,
    after: { case_id: c.id, period_id: period.id, simulation_id: simulationId, diff_total_minor: diff.total_minor },
  })
  const changed = diff.lines.filter((line) => line.diff_minor !== '0')
  const byRule = [...new Set(changed.map((line) => line.rule_key))].sort().map((rule) => ({
    rule_key: rule, diff_minor: changed.filter((l) => l.rule_key === rule).reduce((sum, l) => sum + BigInt(l.diff_minor), 0n).toString(),
  }))
  return {
    restatement_id: created[0]!.id, period: { id: period.id, starts_at: period.starts_at, ends_at: period.ends_at },
    diff_total_minor: diff.total_minor, by_rule: byRule, payees: new Set(changed.map((l) => l.payee_participant_id)).size, empty: changed.length === 0,
  }
}

/** Approval: one restatement origin per non-zero diff line (approved), or applied at once when there is none. */
async function decided(tx: Tx, c: CaseRecord<Payload>, decision: 'approved' | 'rejected'): Promise<void> {
  const { rows } = await tx.query<{ id: string; diff: Diff }>(`SELECT id, diff FROM restatement WHERE case_id = $1 FOR UPDATE`, [c.id])
  const restatement = rows[0]!
  let state: string = 'rejected'
  if (decision === 'approved') {
    const changed = restatement.diff.lines.filter((line) => line.diff_minor !== '0')
    for (const line of changed) {
      await tx.query(
        `INSERT INTO adjustment_origin (tenant_id, origin_type, restatement_id, payee_position_id, rule_key, source_kind, amount_minor,
           original_period_id, reason_code)
         VALUES (app_tenant_id(), 'restatement', $1, $2, $3, $4, $5, $6, $7)`,
        [restatement.id, line.payee_position_id, line.rule_key, line.source_kind, line.diff_minor, c.subject_id, c.reason_code],
      )
    }
    state = changed.length === 0 ? 'applied' : 'approved'
  }
  await tx.query('UPDATE restatement SET state = $2 WHERE id = $1', [restatement.id, state])
  await recordAudit(tx, { action: 'RESTATEMENT.DECIDED', objectType: 'restatement', objectId: restatement.id, after: { case_id: c.id, state } })
}

export const RESTATEMENT_CASE_TYPE: CaseTypeDefinition<Payload> = {
  type: 'restatement',
  subjectTypes: ['period'],
  reasonCodes: RESTATEMENT_REASON_CODES,
  evidenceRequired: true,
  permissions: { read: 'case.restatement.read', create: 'restatement.request', decide: 'restatement.approve' },
  payload,
  async resolveSubject(tx, _type, id) {
    const { rows } = await tx.query<{ market_id: string }>('SELECT c.market_id FROM period p JOIN calendar c ON c.id = p.calendar_id WHERE p.id = $1', [id])
    return rows[0] === undefined ? null : { marketId: rows[0].market_id }
  },
  validateCreate: (tx, subject, _payload, _scope, stored) => assertRestatable(tx, subject.id, stored?.id ?? null),
  effectPreview: sandbox,
  onDecision: decided,
}

const RESTATEMENT_FROM = `FROM restatement s JOIN case_file c ON c.id = s.case_id JOIN period p ON p.id = s.period_id
  JOIN calendar cal ON cal.id = p.calendar_id`

async function restatementInScope(tx: Tx, id: string, scope: readonly string[] | null) {
  const { rows } = await tx.query<{ market_id: string } & Record<string, unknown>>(
    `SELECT s.id, s.case_id, c.state AS case_state,
            jsonb_build_object('id', p.id, 'calendar_id', p.calendar_id, 'starts_at', p.starts_at, 'ends_at', p.ends_at) AS period,
            CASE WHEN c.state = 'withdrawn' THEN 'withdrawn' ELSE s.state END AS state, s.simulation_id,
            s.diff ->> 'total_minor' AS diff_total_minor, s.applied_in_run_id, cal.market_id
     ${RESTATEMENT_FROM} WHERE s.id = $1`,
    [id],
  )
  const row = rows[0]
  if (row === undefined || (scope !== null && !scope.includes(row.market_id))) throw notFound()
  return row
}

/** GET /v1/restatements/:id. */
export async function restatementDetail(tx: Tx, id: string, scope: readonly string[] | null) {
  const { market_id: _market, ...view } = await restatementInScope(tx, id, scope)
  return view
}

/** GET /v1/restatements/:id/lines: the stored diff, paged by position in it. */
export async function restatementLines(tx: Tx, id: string, scope: readonly string[] | null, offset: number, limit: number) {
  await restatementInScope(tx, id, scope)
  const { rows } = await tx.query<{ line: DiffLine }>(
    `SELECT x.line FROM restatement s, jsonb_array_elements(s.diff -> 'lines') WITH ORDINALITY AS x(line, n)
     WHERE s.id = $1 ORDER BY x.n OFFSET $2 LIMIT $3`,
    [id, offset, limit + 1],
  )
  return rows.map(({ line: { source_kind: _kind, ...line } }) => line)
}
