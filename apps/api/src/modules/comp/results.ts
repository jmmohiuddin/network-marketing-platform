import { createHash } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { MeasureValue, PayeeSettlement, QualificationStateRow, ResultLine, RunChunk, RunOutput, RunSummary } from '@nmp/engine'

// Writes engine output rows with multi-row INSERT ... SELECT unnest(...) in batches inside the caller's transaction
// (§S-2: one transaction for write + flip, measured in bench/write-path.ts).

const BATCH = 5000

/**
 * jsonb text of engine output: bigint as decimal strings. Key order is irrelevant here (jsonb stores keys normalised),
 * so the canonical codec's sorting (stringifyEngineJson) is not needed; arrays (lines hash) keep their order.
 */
export const jsonText = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))

/** result_line (runs) or sim_result_line (simulations): same columns, a different owner. */
export type LineTable = { readonly table: 'result_line'; readonly owner: 'run_id' } | { readonly table: 'sim_result_line'; readonly owner: 'simulation_id' }

export const RUN_LINES: LineTable = { table: 'result_line', owner: 'run_id' }
export const SIM_LINES: LineTable = { table: 'sim_result_line', owner: 'simulation_id' }

export async function insertLines(tx: Tx, target: LineTable, ownerId: string, lines: readonly ResultLine[]): Promise<void> {
  for (let start = 0; start < lines.length; start += BATCH) {
    const batch = lines.slice(start, start + BATCH)
    await tx.query(
      `INSERT INTO ${target.table} (tenant_id, ${target.owner}, payee_position_id, payee_participant_id, rule_key, bonus_type,
         source_kind, pass, amount_minor, currency, reversal_policy, origin_type, origin_id, original_period_id, trace)
       SELECT app_tenant_id(), $1, * FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::smallint[],
         $8::bigint[], $9::text[], $10::text[], $11::text[], $12::uuid[], $13::uuid[], $14::jsonb[])`,
      [
        ownerId, batch.map((l) => l.payeePositionId), batch.map((l) => l.payeeParticipantId), batch.map((l) => l.ruleKey),
        batch.map((l) => l.kind), batch.map((l) => l.sourceKind), batch.map((l) => l.pass), batch.map((l) => l.amountMinor.toString()),
        batch.map((l) => l.currency), batch.map((l) => l.reversalPolicy), batch.map((l) => l.origin?.originType ?? null),
        batch.map((l) => l.origin?.originId ?? null), batch.map((l) => l.origin?.originalPeriodId ?? null),
        batch.map((l) => jsonText(l.trace)),
      ],
    )
  }
}

/**
 * qualification_state per state row of a position of `marketId` (the calendar's market), with the position's volume
 * summary measures (D-B3-19; none known = []). The snapshot keeps other markets' positions for cross-market sponsor
 * chains (D-B2-21); their state belongs to their own market's runs.
 */
export async function insertState(tx: Tx, runId: string, rows: readonly QualificationStateRow[], measures: ReadonlyMap<string, readonly MeasureValue[]>, marketId: string): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH)
    const json = (pick: (row: (typeof batch)[number]) => unknown) => batch.map((row) => jsonText(pick(row)))
    await tx.query(
      `INSERT INTO qualification_state (tenant_id, run_id, position_id, paid_as_rank, highest_titles, grace_used, counters, carry,
         one_time_flags, banked, measures)
       SELECT app_tenant_id(), $1, s.position_id, s.paid_as, s.titles, s.grace, s.counters, s.carry,
              ARRAY(SELECT jsonb_array_elements_text(s.flags)), s.banked, s.measures
       FROM unnest($2::uuid[], $3::jsonb[], $4::jsonb[], $5::jsonb[], $6::jsonb[], $7::jsonb[], $8::jsonb[], $9::jsonb[], $10::jsonb[])
         AS s(position_id, paid_as, titles, grace, counters, carry, flags, banked, measures)
       JOIN position p ON p.id = s.position_id WHERE p.market_id = $11`,
      [
        runId, batch.map((row) => row.positionId), json((r) => r.paidAs), json((r) => r.titles), json((r) => r.graceUsed),
        json((r) => r.counters), json((r) => r.carry), json((r) => r.oneTimeFlags), json((r) => r.banked),
        json((r) => measures.get(r.positionId) ?? []), marketId,
      ],
    )
  }
}

/** run_settlement: the engine's pass-11 result per payee, what the commit posts (D-B4-02). */
export async function insertSettlement(tx: Tx, runId: string, payees: readonly PayeeSettlement[]): Promise<void> {
  for (let start = 0; start < payees.length; start += BATCH) {
    const batch = payees.slice(start, start + BATCH)
    const minor = (pick: (p: PayeeSettlement) => bigint) => batch.map((p) => pick(p).toString())
    await tx.query(
      `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor, withheld_minor,
         net_payable_minor)
       SELECT app_tenant_id(), $1, * FROM unnest($2::uuid[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])`,
      [runId, batch.map((p) => p.participantId), minor((p) => p.grossMinor), minor((p) => p.receivableBeforeMinor), minor((p) => p.nettedMinor),
        minor((p) => p.withheldMinor), minor((p) => p.netPayableMinor)],
    )
  }
}

/**
 * sha256 over the JSON array of (payee, pass, rule, origin, amount) of every line in engine order: equal lines, equal
 * hash (G-B3-REPLAY). Fed line by line, so a streamed run hashes its chunks as they pass (D-B6-12).
 */
export function linesHasher(): { readonly add: (line: ResultLine) => void; readonly digest: () => string } {
  const h = createHash('sha256').update('[')
  let first = true
  return {
    add(l) {
      const material = [l.payeePositionId, l.pass, l.ruleKey, l.origin?.originType ?? null, l.origin?.originId ?? null, l.amountMinor]
      h.update(first ? jsonText(material) : `,${jsonText(material)}`)
      first = false
    },
    digest: () => h.update(']').digest('hex'),
  }
}

export function linesHash(lines: readonly ResultLine[]): string {
  const h = linesHasher()
  for (const l of lines) h.add(l)
  return h.digest()
}

/** What tx B keeps of a streamed run once its rows are written. */
export interface WrittenRun { readonly summary: RunSummary; readonly linesHash: string; readonly lineCount: number }

/**
 * Writes a streamed run (D-B6-12) chunk by chunk: lines, then each volume-summary chunk's state rows with their measures
 * (state rows arrive first and are held: the engine holds them too until the summaries are out), then the settlement.
 * Both state rows and summaries come in position id order.
 */
export async function writeRunOutput(tx: Tx, runId: string, marketId: string, stream: Generator<RunChunk, RunSummary, undefined>): Promise<WrittenRun> {
  const hash = linesHasher()
  let lineCount = 0
  const state: QualificationStateRow[] = []
  let written = 0
  for (let next = stream.next(); ; next = stream.next()) {
    if (next.done === true) {
      await insertState(tx, runId, state.slice(written), new Map(), marketId) // rows of positions without a summary (none expected)
      return { summary: next.value, linesHash: hash.digest(), lineCount }
    }
    const chunk = next.value
    if (chunk.kind === 'lines') {
      await insertLines(tx, RUN_LINES, runId, chunk.lines)
      for (const l of chunk.lines) hash.add(l)
      lineCount += chunk.lines.length
    } else if (chunk.kind === 'qualification') {
      state.push(...chunk.rows)
    } else if (chunk.kind === 'summaries') {
      const last = chunk.rows.at(-1)!.positionId
      let end = written
      while (end < state.length && state[end]!.positionId <= last) end += 1
      await insertState(tx, runId, state.slice(written, end), new Map(chunk.rows.map((s) => [s.positionId, s.measures])), marketId)
      written = end
    } else {
      await insertSettlement(tx, runId, chunk.rows)
    }
  }
}

/** run.totals / simulation.totals: control totals with every amount a decimal string (gross_minor = Σ lines). */
export function totalsOf(output: Pick<RunOutput, 'controlTotals'>): Record<string, unknown> {
  const t = output.controlTotals
  return JSON.parse(jsonText({
    gross_minor: t.grossMinor, line_count: t.lineCount, payee_count: t.payeeCount, breakage_minor: t.breakageMinor,
    residue_minor: t.residueMinor, by_rule: t.byRule, by_source_kind: t.bySourceKind, adjustments_by_origin: t.adjustmentsByOrigin,
  })) as Record<string, unknown>
}

/** run.outputs: what review, replay and the transition report read (bigints as decimal strings, display/SQL only). */
export function outputsOf(output: RunSummary, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return JSON.parse(jsonText({
    result_hash: output.resultHash, warnings: output.warnings, cap_applications: output.capApplications,
    constraint_applications: output.constraintApplications, transition_report: output.transitionReport, ...extra,
  })) as Record<string, unknown>
}
