import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { roundRaw, run as calculate, type EngineWarning, type RunInput, type RunOutput } from '@nmp/engine'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { recordExport } from '../../lib/exports.js'
import { defineTenantJob } from '../../lib/jobs.js'
import { engineSettings } from './inputs.js'
import { loadPeriod, settingsVersionAt, type PeriodRow } from './period.js'
import { insertLines, SIM_LINES } from './results.js'
import { enqueueLong } from './runs.js'
import { buildSnapshot, chainInputs, planFor, readSnapshot, rowCounts, storeSnapshot, type ChainInputs } from './snapshot.js'

// D-B3-15 (API-17): a staff-only comparison of a plan version against a full ended period. Lines go to
// sim_result_line, the comparison is computed in SQL; nothing writes state, ledger, outbox or period state.
// The restatement sandbox (D-B3-14) is the same calculation with kind restatement_sandbox.

export const PAYEES_CSV_CAP = 50_000
const BUCKETS = ['<-10%', '-10..-1%', '-1..+1%', '+1..+10%', '>+10%', 'new', 'gone'] as const

/** Per payee and rule: baseline (regular lines of the baseline run) vs simulated, as SQL over ($1 simulation, $2 run). */
const PAYEE_RULES = `
  WITH s AS (SELECT payee_participant_id AS p, rule_key, sum(amount_minor) AS a FROM sim_result_line WHERE simulation_id = $1 GROUP BY 1, 2),
       b AS (SELECT payee_participant_id AS p, rule_key, sum(amount_minor) AS a FROM result_line
             WHERE run_id = $2 AND origin_type IS NULL GROUP BY 1, 2),
       j AS (SELECT coalesce(s.p, b.p) AS p, coalesce(s.rule_key, b.rule_key) AS rule_key, coalesce(b.a, 0) AS baseline,
                    coalesce(s.a, 0) AS simulated FROM s FULL JOIN b ON b.p = s.p AND b.rule_key = s.rule_key),
       payees AS (SELECT p, sum(baseline) AS baseline, sum(simulated) AS simulated, sum(simulated) - sum(baseline) AS delta,
                         jsonb_agg(jsonb_build_object('rule_key', rule_key, 'baseline_minor', baseline::text, 'simulated_minor', simulated::text)
                                   ORDER BY rule_key) AS by_rule
                  FROM j GROUP BY p)`

const BUCKET_SQL = `CASE WHEN baseline = 0 AND simulated <> 0 THEN 'new' WHEN simulated = 0 AND baseline <> 0 THEN 'gone'
  WHEN delta * 10 < -abs(baseline) THEN '<-10%' WHEN delta * 100 < -abs(baseline) THEN '-10..-1%'
  WHEN delta * 100 <= abs(baseline) THEN '-1..+1%' WHEN delta * 10 <= abs(baseline) THEN '+1..+10%' ELSE '>+10%' END`

/** BR-CAP-03: payees affected and amounts removed per cap, raw amounts rounded half-up to minor units for display. */
function capEffects(output: RunOutput) {
  return output.capApplications.map((cap) => ({
    cap_key: cap.capKey, method: cap.method, base_minor: cap.baseMinor.toString(), cap_minor: cap.capMinor.toString(),
    proposed_minor: roundRaw(cap.proposedRaw, 'half_up').toString(), bound: cap.bound,
    affected: cap.affected.map((a) => ({
      payee_position_id: a.payeePositionId, rule_key: a.ruleKey, before_minor: roundRaw(a.beforeRaw, 'half_up').toString(), after_minor: a.afterMinor.toString(),
    })),
  }))
}

/** Writes the lines, computes the comparison in SQL and completes the simulation (running -> completed). */
async function complete(tx: Tx, simulationId: string, baselineRunId: string | null, versionId: string, output: RunOutput, warnings: readonly EngineWarning[]) {
  await insertLines(tx, SIM_LINES, simulationId, output.lines)
  const { rows: totals } = await tx.query<{ simulated: string; baseline: string | null }>(
    `SELECT (SELECT coalesce(sum(amount_minor), 0)::text FROM sim_result_line WHERE simulation_id = $1) AS simulated,
            CASE WHEN $2::uuid IS NULL THEN NULL ELSE
              (SELECT coalesce(sum(amount_minor), 0)::text FROM result_line WHERE run_id = $2 AND origin_type IS NULL) END AS baseline`,
    [simulationId, baselineRunId],
  )
  const { rows: byRule } = await tx.query(
    `${PAYEE_RULES} SELECT rule_key, sum(baseline)::text AS baseline_minor, sum(simulated)::text AS simulated_minor,
       (sum(simulated) - sum(baseline))::text AS delta_minor FROM j GROUP BY rule_key ORDER BY rule_key`,
    [simulationId, baselineRunId],
  )
  const { rows: buckets } = await tx.query<{ bucket: string; payees: number }>(
    `${PAYEE_RULES} SELECT ${BUCKET_SQL} AS bucket, count(*)::int AS payees FROM payees GROUP BY 1`,
    [simulationId, baselineRunId],
  )
  const { rows: changed } = await tx.query<{ n: number }>(`${PAYEE_RULES} SELECT count(*)::int AS n FROM payees WHERE delta <> 0`, [simulationId, baselineRunId])
  const { rows: flags } = await tx.query('SELECT decision_id, rule_id, outcome, reason FROM guardrail_outstanding($1)', [versionId])
  const simulated = totals[0]!.simulated
  const baseline = totals[0]!.baseline
  const comparison = {
    by_rule: byRule,
    distribution: BUCKETS.map((bucket) => ({ bucket, payees: buckets.find((b) => b.bucket === bucket)?.payees ?? 0 })),
    cap_effects: capEffects(output),
    guardrail_flags: flags,
    payees_changed: changed[0]!.n,
    reconciles: simulated === output.controlTotals.grossMinor.toString(),
  }
  const totalsRow = {
    simulated_minor: simulated, baseline_minor: baseline, delta_minor: baseline === null ? null : (BigInt(simulated) - BigInt(baseline)).toString(),
    line_count: output.lines.length,
  }
  await tx.query(
    `UPDATE simulation SET state = 'completed', totals = $2, comparison = $3, outputs = $4, finished_at = now() WHERE id = $1`,
    [simulationId, totalsRow, comparison, { warnings: warnings.map((w) => ({ code: w.code, message: w.message, ref: w.ref })) }],
  )
  await recordAudit(tx, { action: 'SIMULATION.COMPLETED', objectType: 'simulation', objectId: simulationId, after: { totals: totalsRow } })
}

/**
 * The input of a simulation on `period`: a committed period with a run uses that run's stored snapshot (baseline =
 * the run), otherwise a fresh snapshot as of now. Prior state comes only from the committed run of P−1 (an older run
 * would skip the state changes of the periods between); without it the simulation starts from no state and warns
 * PRIOR_STATE_ABSENT. Adjustments are stripped: the comparison is plan-driven.
 */
async function simulationInput(tx: Tx, period: PeriodRow, input: { versionId: string; hashHex: string }) {
  const plan = await planFor(tx, input.versionId, period.calendar_id, period.starts_us, input.hashHex)
  const warnings: EngineWarning[] = []
  const settingsVersionId = await settingsVersionAt(tx, period.id)
  if (settingsVersionId === null) throw new ApiError(422, 'SETTINGS_VERSION_MISSING', 'No tenant settings are in force at the end of the period.')
  if (period.committed_run_id !== null) {
    const { rows } = await tx.query<{ snapshot_id: string }>('SELECT snapshot_id FROM run WHERE id = $1', [period.committed_run_id])
    const snapshot = await readSnapshot(tx, rows[0]!.snapshot_id)
    return {
      input: { plan, settings: await engineSettings(tx, settingsVersionId), snapshot: { ...snapshot, adjustments: [] } },
      snapshotId: rows[0]!.snapshot_id, baselineRunId: period.committed_run_id, warnings,
    }
  }
  let chain: ChainInputs = { priorState: null, priorRunId: null, history: [] }
  try {
    chain = await chainInputs(tx, period, plan)
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'PRIOR_STATE_MISSING') throw error
  }
  if (chain.priorState === null) {
    warnings.push({ code: 'PRIOR_STATE_ABSENT', message: 'No committed prior state: the simulation starts from no state.', ref: null })
  }
  const loaded = await buildSnapshot(tx, period, { snapshotId: randomUUID(), chain, adjustments: [] })
  await storeSnapshot(tx, loaded, { periodId: period.id, priorRunId: chain.priorRunId, rowCounts: rowCounts(loaded, []) })
  return {
    input: { plan, settings: await engineSettings(tx, settingsVersionId), snapshot: loaded.snapshot },
    snapshotId: loaded.snapshot.snapshotId, baselineRunId: null, warnings,
  }
}

interface SimulationRow {
  readonly id: string
  readonly plan_version_id: string
  readonly period_id: string
  readonly state: string
  readonly hash_hex: string
  readonly compiled_matches: boolean
}

/** Calculates a queued simulation in the caller's transaction; a failure (savepoint) leaves it failed with the error. */
export async function calculateSimulation(tx: Tx, simulationId: string, prepared?: (tx: Tx) => Promise<{ input: RunInput; snapshotId: string; baselineRunId: string | null }>) {
  const { rows } = await tx.query<SimulationRow>(
    `SELECT s.id, s.plan_version_id, s.period_id, s.state, encode(s.content_hash, 'hex') AS hash_hex,
            v.compiled IS NOT NULL AND digest(v.compiled::text, 'sha256') = s.content_hash AS compiled_matches
     FROM simulation s JOIN plan_version v ON v.id = s.plan_version_id WHERE s.id = $1 FOR UPDATE OF s`,
    [simulationId],
  )
  const sim = rows[0]
  if (sim === undefined || sim.state !== 'queued') return
  await tx.query('SAVEPOINT simulation')
  try {
    if (!sim.compiled_matches) throw new ApiError(422, 'PLAN_CHANGED', 'The draft changed after the simulation was requested: request it again.')
    const period = await loadPeriod(tx, sim.period_id)
    const source = prepared === undefined
      ? await simulationInput(tx, period, { versionId: sim.plan_version_id, hashHex: sim.hash_hex })
      : { ...(await prepared(tx)), warnings: [] }
    await tx.query(`UPDATE simulation SET state = 'running', snapshot_id = $2, baseline_run_id = $3 WHERE id = $1`, [
      simulationId, source.snapshotId, source.baselineRunId,
    ])
    const output = calculate(source.input)
    await complete(tx, simulationId, source.baselineRunId, sim.plan_version_id, output, [...source.warnings, ...output.warnings])
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^(08|40|53|57|58)/.test(error.code)) throw error
    await tx.query('ROLLBACK TO SAVEPOINT simulation')
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'INTERNAL'
    const message = error instanceof ApiError || (error instanceof Error && error.name === 'EngineError') ? error.message : 'The simulation failed unexpectedly.'
    // As failRun: an ApiError keeps its details (e.g. TAX_RULES_INVALID {code, rule_ids, participant_ids}, AC-TAX2-2).
    const failure = error instanceof ApiError ? { code, message, details: error.details ?? {} } : { code, message }
    await tx.query(`UPDATE simulation SET state = 'failed', error = $2, finished_at = now() WHERE id = $1`, [simulationId, failure])
    await recordAudit(tx, { action: 'SIMULATION.FAILED', objectType: 'simulation', objectId: simulationId, after: { error: { code } } })
  }
}

export const simulationJob = defineTenantJob({
  name: 'comp.simulation.run',
  payload: z.object({ simulationId: z.uuid() }),
  run: (tx, payload) => calculateSimulation(tx, payload.simulationId),
})

/** The market scope of each permission the caller reads through (null = all markets); never merged (D-B3-23). */
export type Scopes = readonly (readonly string[] | null)[]

/** One permission's scope must hold every market of the plan (D-B3-23); 404 otherwise, like an unknown id. */
export async function assertPlanInScope(tx: Tx, versionId: string, scopes: Scopes): Promise<void> {
  const { rows } = await tx.query<{ markets: string[] }>(
    `SELECT ARRAY(SELECT m.market_id FROM plan_market m WHERE m.plan_id = v.plan_id) AS markets FROM plan_version v WHERE v.id = $1`,
    [versionId],
  )
  const markets = rows[0]?.markets
  if (markets === undefined || !scopes.some((scope) => scope === null || markets.every((m) => scope.includes(m)))) throw notFound()
}

/** POST /v1/simulations (D-B3-15); MIG's parallel runs through requestParallelRunSimulation (PLAN B6 section 1.9). */
export async function requestSimulation(
  tx: Tx, body: { plan_version_id: string; period_id: string }, scope: readonly string[] | null,
  kind: 'simulation' | 'parallel_run' = 'simulation',
) {
  await assertPlanInScope(tx, body.plan_version_id, [scope])
  const { rows } = await tx.query<{ in_plan: boolean; ended: boolean; compiled: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM plan_calendar pc WHERE pc.plan_id = v.plan_id AND pc.calendar_id = p.calendar_id) AS in_plan,
            p.ends_at <= now() AS ended, v.compiled -> p.calendar_id::text IS NOT NULL AS compiled
     FROM plan_version v, period p WHERE v.id = $1 AND p.id = $2`,
    [body.plan_version_id, body.period_id],
  )
  const check = rows[0]
  if (check === undefined) throw notFound()
  if (!check.in_plan) throw new ApiError(422, 'CALENDAR_NOT_IN_PLAN', "The period's calendar is not a calendar of the plan.")
  if (!check.ended) throw new ApiError(422, 'PERIOD_NOT_ENDED', 'Simulate on a period that has ended.')
  if (!check.compiled) throw new ApiError(422, 'PLAN_INVALID', 'The plan version does not compile: fix its validation errors first.')
  const { rows: created } = await tx.query(
    `INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, content_hash, requested_by)
     SELECT app_tenant_id(), v.id, $2, $3, digest(v.compiled::text, 'sha256'), app_user_id() FROM plan_version v WHERE v.id = $1
     RETURNING id, plan_version_id, period_id, kind, state, requested_by, requested_at`,
    [body.plan_version_id, body.period_id, kind],
  )
  const simulation = created[0] as { id: string }
  await recordAudit(tx, { action: 'SIMULATION.REQUESTED', objectType: 'simulation', objectId: simulation.id, after: body })
  await enqueueLong(tx, simulationJob, { simulationId: simulation.id })
  return simulation
}

/**
 * D-B6-11: MIG's only way to create a simulation (kind parallel_run, same checks, audit and job); the caller checked the
 * migration's market scope and inserts the parallel_run row in the same transaction.
 */
export async function requestParallelRunSimulation(tx: Tx, input: { planVersionId: string; periodId: string }): Promise<string> {
  const simulation = await requestSimulation(tx, { plan_version_id: input.planVersionId, period_id: input.periodId }, null, 'parallel_run')
  return simulation.id
}

const SIMULATION_COLUMNS = `s.id, s.plan_version_id, s.period_id, s.kind, s.state, s.baseline_run_id, encode(s.content_hash, 'hex') AS content_hash,
  s.error, s.requested_by, s.requested_at, s.finished_at`

/** A simulation of kind 'simulation' in scope (restatement sandboxes are read through restatements only, AC-SIM-3). */
async function simulationInScope(tx: Tx, id: string, scopes: Scopes) {
  const { rows } = await tx.query<Record<string, unknown> & { plan_version_id: string; baseline_run_id: string | null; totals: Record<string, unknown> | null; comparison: Record<string, unknown> | null; outputs: { warnings?: unknown[] } | null }>(
    `SELECT ${SIMULATION_COLUMNS}, s.totals, s.comparison, s.outputs FROM simulation s WHERE s.id = $1 AND s.kind = 'simulation'`,
    [id],
  )
  if (rows[0] === undefined) throw notFound()
  await assertPlanInScope(tx, rows[0].plan_version_id, scopes)
  return rows[0]
}

export async function listSimulations(tx: Tx, scopes: Scopes, versionId: string | undefined, after: string | undefined, limit: number) {
  const { rows } = await tx.query(
    `SELECT ${SIMULATION_COLUMNS}, s.totals FROM simulation s JOIN plan_version v ON v.id = s.plan_version_id
     WHERE s.kind = 'simulation' AND ($1::uuid IS NULL OR s.plan_version_id = $1) AND ($2::uuid IS NULL OR s.id < $2)
       AND EXISTS (SELECT 1 FROM jsonb_array_elements($3::jsonb) sc WHERE jsonb_typeof(sc) = 'null'
                   OR NOT EXISTS (SELECT 1 FROM plan_market m WHERE m.plan_id = v.plan_id AND NOT sc ? m.market_id::text))
     ORDER BY s.id DESC LIMIT $4`,
    [versionId ?? null, after ?? null, JSON.stringify(scopes), limit + 1],
  )
  return rows as { id: string }[]
}

export async function simulationDetail(tx: Tx, id: string, scopes: Scopes) {
  const { totals, comparison, outputs, ...simulation } = await simulationInScope(tx, id, scopes)
  return {
    simulation,
    totals: totals === null ? null : { simulated_minor: totals.simulated_minor, baseline_minor: totals.baseline_minor, delta_minor: totals.delta_minor },
    comparison,
    warnings: outputs?.warnings ?? [],
  }
}

/** GET /v1/simulations/:id/payees: per-payee comparison, sorted by |delta| (or participant), offset-paged; or the CSV. */
export async function simulationPayees(tx: Tx, id: string, scope: readonly string[] | null, sort: 'delta' | 'participant', offset: number, limit: number | null) {
  const sim = await simulationInScope(tx, id, [scope])
  const { rows } = await tx.query(
    `${PAYEE_RULES}
     SELECT jsonb_build_object('id', pa.id, 'external_ref', pa.external_ref, 'display_name', pa.display_name) AS participant,
            baseline::text AS baseline_minor, simulated::text AS simulated_minor, delta::text AS delta_minor, by_rule
     FROM payees JOIN participant pa ON pa.id = payees.p
     ORDER BY ${sort === 'delta' ? 'abs(delta) DESC, pa.id' : 'pa.external_ref, pa.id'} OFFSET $3 LIMIT $4`,
    [id, sim.baseline_run_id, offset, limit],
  )
  return rows
}

export async function simulationPayeesCsv(tx: Tx, id: string, scope: readonly string[] | null) {
  const sim = await simulationInScope(tx, id, [scope])
  const { rows: counted } = await tx.query<{ n: number }>(`${PAYEE_RULES} SELECT count(*)::int AS n FROM payees`, [id, sim.baseline_run_id])
  const decision = await recordExport(tx, { kind: 'simulation_payees', filters: { simulation_id: id }, rowCount: counted[0]!.n, rowCap: PAYEES_CSV_CAP })
  if (decision.refused) return { refused: { rowCount: decision.rowCount, rowCap: decision.rowCap } }
  const rows = (await simulationPayees(tx, id, scope, 'delta', 0, null)) as { participant: { id: string; external_ref: string }; baseline_minor: string; simulated_minor: string; delta_minor: string }[]
  return {
    csv: toCsv(['participant_id', 'external_ref', 'baseline_minor', 'simulated_minor', 'delta_minor'],
      rows.map((r) => [r.participant.id, r.participant.external_ref, r.baseline_minor, r.simulated_minor, r.delta_minor])),
  }
}
