import type { Tx } from '@nmp/db'
import { formatUnits, renderExpression, type Requirement } from '@nmp/engine'
import { notFound } from '../../lib/errors.js'
import { planFor } from './snapshot.js'
import type { LadderRank } from './statements.js'

// FR-DIST-003 (D-B5-09): factual rank status of an own position from qualification_state of committed runs (periods
// earned under a previous owner are never shown), one "not final" row from a calculated run of the open period, the
// requirements of the current paid-as rank and a scheduled plan change. Never money, targets, next ranks or streaks.

export interface RankCursor { readonly starts_at: string; readonly period_id: string }

interface StateRow {
  readonly period_id: string
  readonly starts_at: Date
  readonly ends_at: Date
  readonly run_id: string
  readonly plan_version_id: string
  readonly calendar_id: string
  readonly paid_as: LadderRank[]
  readonly titles: LadderRank[]
  readonly grace_used: { ladder: string; periods: number }[]
  readonly measures: { measure: string; valueMinor: string }[]
}

const STATE_COLUMNS = `p.id AS period_id, p.starts_at, p.ends_at, r.id AS run_id, r.plan_version_id, p.calendar_id, q.paid_as_rank AS paid_as,
  q.highest_titles AS titles, q.grace_used, q.measures`
// The participant owned the position at the period's last instant (gen_owner_at, as adjustments read it).
const OWNED_AT_END = `gen_owner_at(q.position_id, p.ends_at - interval '1 microsecond') = $2`

async function committedRows(tx: Tx, positionId: string, participantId: string, after: RankCursor | undefined, limit: number): Promise<StateRow[]> {
  const { rows } = await tx.query<StateRow>(
    `SELECT ${STATE_COLUMNS}
     FROM qualification_state q JOIN run r ON r.id = q.run_id AND r.state = 'committed' JOIN period p ON p.id = r.period_id
     WHERE q.position_id = $1 AND ${OWNED_AT_END} AND ($3::timestamptz IS NULL OR (p.starts_at, p.id) < ($3, $4::uuid))
     ORDER BY p.starts_at DESC, p.id DESC LIMIT $5`,
    [positionId, participantId, after?.starts_at ?? null, after?.period_id ?? null, limit],
  )
  return rows
}

/** The calculated, uncommitted run of the position's open period (volumes and ranks only), if any. */
async function notFinalRow(tx: Tx, positionId: string, participantId: string): Promise<StateRow | undefined> {
  const { rows } = await tx.query<StateRow>(
    `SELECT ${STATE_COLUMNS}
     FROM qualification_state q JOIN run r ON r.id = q.run_id AND r.state = 'calculated' JOIN period p ON p.id = r.period_id
     WHERE q.position_id = $1 AND p.state IN ('open', 'calculating', 'calculated')
       AND gen_owner_at(q.position_id, least(now(), p.ends_at - interval '1 microsecond')) = $2
     ORDER BY p.starts_at DESC, r.created_at DESC LIMIT 1`,
    [positionId, participantId],
  )
  return rows[0]
}

const periodRow = (row: StateRow, final: boolean) => ({
  period: { id: row.period_id, starts_at: row.starts_at, ends_at: row.ends_at },
  run_id: final ? row.run_id : null, final, paid_as: row.paid_as, titles: row.titles, grace_used: final ? row.grace_used : null,
  measures: row.measures.map((m) => ({ measure: m.measure, value: m.valueMinor })),
})

const rankText = (r: { ladder: string; rank: string }) => `${r.ladder} ${r.rank} or higher`

/** One requirement: measured and met only for a per-period measure without a leg rule (leg counts are not stored, C-B5-16). */
export function requirementItem(q: Requirement, measures: StateRow['measures'], digits: number) {
  if (q.kind === 'measure') {
    const window = q.window.type === 'rolling' ? ` over ${q.window.periods} periods` : q.window.type === 'per_order' ? ' in one order' : ''
    const measured = measures.find((m) => m.measure === q.measure)?.valueMinor ?? null
    // Rolling, per-order and leg-limited requirements are not measured by the stored period value.
    const comparable = q.window.type === 'period' && q.maxPerLegShare === null && measured !== null
    return {
      kind: q.kind, text: `${q.measure} at least ${formatUnits(q.atLeastMinor, digits)}${window}${q.maxPerLegShare === null ? '' : ', measured before the leg rule'}`,
      measure: q.measure, required: q.atLeastMinor.toString(), measured, met: comparable ? BigInt(measured) >= q.atLeastMinor : null,
    }
  }
  if (q.kind === 'legs') return { kind: q.kind, text: `${q.count} ${q.tree} legs at ${rankText(q.rank)}`, required: String(q.count), met: null }
  if (q.kind === 'profile') return { kind: q.kind, text: `${q.fact} is ${q.equals}`, met: null }
  if (q.kind === 'rank') return { kind: q.kind, text: `Holds ${rankText(q.rank)}`, met: null }
  return { kind: q.kind, text: renderExpression(q.expr), met: null }
}

/** Requirements of each paid-as rank of the newest committed row, from its run's compiled plan. */
async function requirementsOf(tx: Tx, row: StateRow | undefined, digits: number) {
  if (row === undefined) return []
  const plan = await planFor(tx, row.plan_version_id, row.calendar_id, '0')
  return row.paid_as.flatMap(({ ladder, rank }) => {
    const definition = plan.ladders.find((l) => l.key === ladder)?.ranks.find((r) => r.key === rank)
    if (rank === null || definition === undefined) return []
    const used = row.grace_used.find((g) => g.ladder === ladder)?.periods ?? 0
    return [{
      ladder, rank, status: used > 0 ? 'held_by_grace' : 'held',
      ...(used > 0 ? { grace: { used, of: definition.maintenance?.gracePeriods ?? used } } : {}),
      items: definition.requires.map((q) => requirementItem(q, row.measures, digits)),
    }]
  })
}

/** GET /v1/me/rank: one own position (the given one, else the first currently owned), 404 for any other. */
export async function rankStatus(tx: Tx, participantId: string, positionId: string | undefined, after: RankCursor | undefined, limit: number) {
  const { rows: positions } = await tx.query<{ id: string; position_ref: string; market_id: string; minor_unit: number }>(
    `SELECT x.id, x.position_ref, x.market_id, m.minor_unit FROM position x JOIN market m ON m.id = x.market_id
     WHERE EXISTS (SELECT 1 FROM position_ownership o WHERE o.position_id = x.id AND o.participant_id = $1) AND ($2::uuid IS NULL OR x.id = $2)
     ORDER BY gen_owner_at(x.id, now()) IS NOT DISTINCT FROM $1 DESC, x.position_ref, x.id LIMIT 1`,
    [participantId, positionId ?? null],
  )
  const position = positions[0]
  if (position === undefined) throw notFound()
  const rows = await committedRows(tx, position.id, participantId, after, limit + 1)
  const newest = after === undefined ? rows[0] : (await committedRows(tx, position.id, participantId, undefined, 1))[0]
  const open = after === undefined ? await notFinalRow(tx, position.id, participantId) : undefined
  const { rows: notice } = await tx.query<{ effective_from: Date | null }>(
    `SELECT min(v.effective_from) AS effective_from FROM plan_version v JOIN plan_market pm ON pm.plan_id = v.plan_id
     WHERE pm.market_id = $1 AND v.state = 'scheduled' AND v.effective_from > now()`,
    [position.market_id],
  )
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    data: {
      position: { id: position.id, position_ref: position.position_ref },
      periods: [...(open === undefined ? [] : [periodRow(open, false)]), ...page.map((row) => periodRow(row, true))],
      requirements: await requirementsOf(tx, newest, position.minor_unit),
      transition_notice: notice[0]?.effective_from == null ? null : { effective_from: notice[0].effective_from },
    },
    next: rows.length > limit && last !== undefined ? { starts_at: last.starts_at.toISOString(), period_id: last.period_id } : null,
  }
}
