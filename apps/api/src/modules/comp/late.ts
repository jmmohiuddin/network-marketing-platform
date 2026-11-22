import type { Tx } from '@nmp/db'
import {
  buildTree, evaluationInstant, positionOrder, run, type AdjustmentOrigin, type LineKey, type LineSource, type Order,
  type PlanVersion, type ResultLine, type RunInput,
} from '@nmp/engine'
import { committedInput } from './inputs.js'
import { loadPeriod, type PeriodRow } from './period.js'
import { addFractions, roundFraction, ZERO, type Fraction, type RoundingMode } from './rounding.js'
import { lateOrders } from './snapshot.js'

// D-B3-13 / E-ADR-43: late items of committed periods of the run's calendar become adjustment origins of the run.
// Every amount comes from a full-trace replay of the original period's stored, hash-verified input (with the late
// order added when it is not in it); nothing is computed from stored traces.

interface LateEvent {
  readonly id: string
  readonly order_id: string
  readonly type: string
  readonly refund_minor: string
  readonly equal_value: boolean
  readonly volume_effect: { total?: Record<string, string> }
  readonly reverses_event_id: string | null
}

const EVENT_JSON = `jsonb_build_object('id', e.id, 'order_id', e.order_id, 'type', e.type, 'refund_minor', e.refund_minor::text,
  'equal_value', e.equal_value, 'volume_effect', e.volume_effect, 'reverses_event_id', e.reverses_event_id)`

interface LateItem {
  readonly id: string
  readonly order_id: string | null
  readonly original_period_id: string
  readonly committed_run_id: string
  readonly event: LateEvent | null
}

export interface LateConsumption {
  readonly origins: readonly AdjustmentOrigin[]
  /** Every late item this run consumes, also those whose lines rounded to nothing. */
  readonly itemIds: readonly string[]
}

/** Late items of committed (also paid or closed, D-B4-24) periods of the calendar ending at or before `period` starts, in a given handling. */
export const LATE_ITEMS_OF_CALENDAR = `
  FROM late_transaction lt JOIN period op ON op.id = lt.original_period_id
  WHERE op.calendar_id = $1 AND op.state IN ('committed', 'paid', 'closed') AND op.ends_at <= (SELECT starts_at FROM period WHERE id = $2)
    AND lt.handling = $3 AND lt.state IN ('pending', 'decided')`

async function consumable(tx: Tx, period: PeriodRow): Promise<LateItem[]> {
  const { rows } = await tx.query<LateItem>(
    `SELECT lt.id, lt.order_id, lt.original_period_id, op.committed_run_id,
            (SELECT ${EVENT_JSON} FROM order_event e WHERE e.id = lt.order_event_id) AS event
     ${LATE_ITEMS_OF_CALENDAR}
     ORDER BY op.starts_at, lt.id`,
    [period.calendar_id, period.id, 'adjust'],
  )
  return rows
}

/**
 * The stored order events P's input applied (engine event ids are `<order_event id>:<line>`; exchanges reverse nothing
 * in the engine): the replay's order parts are already net of them.
 */
async function appliedEvents(tx: Tx, input: RunInput): Promise<LateEvent[]> {
  const ids = [...new Set(input.snapshot.orderEvents.map((e) => e.eventId.split(':')[0]!))]
  const { rows } = await tx.query<{ event: LateEvent }>(
    `SELECT ${EVENT_JSON} AS event FROM order_event e WHERE e.id = ANY ($1::uuid[]) AND e.type <> 'exchange' ORDER BY e.id`, [ids])
  return rows.map((row) => row.event)
}

/** The personal measure's line source behind a measure key; null for counts and kinds without one (no reversal share). */
function sourceOf(plan: PlanVersion, key: string | null): LineSource | null {
  const measure = plan.measures.find((m) => m.key === key)
  if (measure === undefined) return null
  if (measure.kind === 'volume.personal') return measure.source
  if (measure.kind === 'volume.group' || measure.kind === 'volume.enrolled_group') return sourceOf(plan, measure.of)
  return null
}

/**
 * f: the reversed share of what the replay still credits of the order in a source (D-B3-13). Volume sources:
 * |effect total[name]|, amount sources: refund; over the order's line volumes[name] / amount net of the events P's input
 * applied (`applied`; a chargeback_reversed credits back), at most 1; an equal-value exchange reverses nothing.
 */
function reversedShare(source: LineSource | null, order: Order, event: LateEvent, applied: readonly LateEvent[]): Fraction {
  if (source === null || event.equal_value) return ZERO
  const value = (e: LateEvent): bigint => {
    if (source.from !== 'volume') return BigInt(e.refund_minor)
    const effect = BigInt(e.volume_effect.total?.[source.name] ?? '0')
    return effect < 0n ? -effect : effect
  }
  const gross = order.lines.reduce((sum, line) => sum + (source.from === 'volume'
    ? (line.volumes.find((v) => v.name === source.name)?.perUnitMinor ?? 0n) * BigInt(line.quantity)
    : line.amountMinor), 0n)
  const den = applied.reduce((sum, e) => sum + (e.type === 'chargeback_reversed' ? value(e) : -value(e)), gross)
  const num = value(event)
  return den <= 0n ? ZERO : { num: num < den ? num : den, den }
}

/** Order-line bonus lines of the order's credit position and every ancestor in either tree (fullTraceFor). */
function tracedKeys(input: RunInput, orders: readonly Order[]): LineKey[] {
  const rules = input.plan.bonuses.filter((b) => b.reversalPolicy === 'order_line').map((b) => b.key)
  const s = input.snapshot
  const ids = positionOrder(s.positions.map((p) => p.positionId))
  const at = { validAtUs: evaluationInstant(s.period), knownAtUs: s.knownAtUs }
  const trees = (['sponsor', 'placement'] as const).map((kind) => buildTree(ids, s.relationships, kind, at))
  const payees = new Set<string>()
  for (const order of orders) {
    if (order.creditPositionId === null) continue
    for (const tree of trees) {
      for (let k = tree.index.get(order.creditPositionId) ?? -1; k >= 0; k = tree.parent[k]!) payees.add(tree.ids[k]!)
    }
  }
  return [...payees].sort().flatMap((payeePositionId) => rules.map((ruleKey) => ({ payeePositionId, ruleKey })))
}

/** Σ over the line's sources of (the order's raw part x share of the source), as a fraction of minor units. */
function partOf(line: ResultLine, orderId: string, share: (measure: string | null) => Fraction): Fraction {
  let total = ZERO
  for (const source of line.trace.sources) {
    const part = source.orders.filter((o) => o.orderId === orderId).reduce((sum, o) => sum + o.raw, 0n)
    if (part === 0n) continue
    const f = share(source.measure)
    total = addFractions(total, { num: part * f.num * line.amountMinor, den: f.den * line.trace.raw })
  }
  return total
}

interface NewOrigin {
  readonly item: LateItem
  readonly line: ResultLine
  readonly amount: bigint
}

function originsFor(
  item: LateItem, input: RunInput, lines: readonly ResultLine[], applied: readonly LateEvent[], rounding: RoundingMode,
): NewOrigin[] {
  const orderId = item.order_id ?? item.event!.order_id
  const order = input.snapshot.orders.find((o) => o.orderId === orderId)!
  const event = item.event
  const ofOrder = applied.filter((e) => e.order_id === orderId)
  const share = (measure: string | null): Fraction =>
    event === null ? { num: 1n, den: 1n } : reversedShare(sourceOf(input.plan, measure), order, event, ofOrder)
  const sign = event === null || event.type === 'chargeback_reversed' ? 1n : -1n
  // shortcut: credit awards are never adjusted after award (the engine's lines are cash only, so award rules get no late,
  // clawback or restatement origin), upgrade when a plan document defines credit reversal (PLAN V1-A section 8).
  return lines.flatMap((line) => {
    if (line.origin !== null || line.reversalPolicy !== 'order_line' || line.trace.raw === 0n) return []
    const part = partOf(line, orderId, share)
    if (part.num === 0n) return []
    const amount = sign * roundFraction(part.num, part.den, rounding)
    return amount === 0n ? [] : [{ item, line, amount }]
  })
}

async function insertOrigin(tx: Tx, runId: string, o: NewOrigin): Promise<AdjustmentOrigin> {
  const clawback = o.item.event !== null
  const originType = clawback ? 'clawback' : 'late_transaction'
  const sourceKind = clawback ? 'clawback' : o.line.sourceKind
  const reasonCode = o.item.event?.type ?? null
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO adjustment_origin (tenant_id, origin_type, late_transaction_id, run_id, payee_position_id, rule_key, source_kind,
       amount_minor, original_period_id, reason_code)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [originType, o.item.id, runId, o.line.payeePositionId, o.line.ruleKey, sourceKind, o.amount.toString(), o.item.original_period_id, reasonCode],
  )
  return {
    originType, originId: rows[0]!.id, payeePositionId: o.line.payeePositionId, ruleKey: o.line.ruleKey, sourceKind,
    amountMinor: o.amount, originalPeriodId: o.item.original_period_id, reasonCode,
  }
}

/**
 * Replays one original period with full traces: its committed input, plus `extra` (a late order) when given, less the
 * events of `removed` (an applied chargeback a late chargeback_reversed gives back: its lines are what the
 * chargeback took from the committed lines).
 */
async function replayWith(tx: Tx, original: PeriodRow, base: RunInput, extra: string | null, removed: string | null, items: readonly LateItem[]) {
  let input = base
  if (extra !== null) {
    const added = await lateOrders(tx, original, [extra], base.snapshot)
    input = { ...base, snapshot: { ...base.snapshot, orders: [...base.snapshot.orders, ...added.orders], participants: [...base.snapshot.participants, ...added.participants] } }
  }
  if (removed !== null) {
    input = { ...input, snapshot: { ...input.snapshot, orderEvents: input.snapshot.orderEvents.filter((e) => !e.eventId.startsWith(`${removed}:`)) } }
  }
  const orders = items.map((item) => input.snapshot.orders.find((o) => o.orderId === (item.order_id ?? item.event!.order_id))!)
  return { input, lines: run(input, { fullTraceFor: tracedKeys(input, orders) }).lines }
}

/** Runs in the run's first transaction (tx A): inserts the run's late origins and returns them for its snapshot. */
export async function consumeLate(tx: Tx, runId: string, period: PeriodRow, rounding: RoundingMode): Promise<LateConsumption> {
  const items = await consumable(tx, period)
  const origins: AdjustmentOrigin[] = []
  for (const originalId of [...new Set(items.map((item) => item.original_period_id))]) {
    const ofPeriod = items.filter((item) => item.original_period_id === originalId)
    const base = await committedInput(tx, ofPeriod[0]!.committed_run_id)
    const original = await loadPeriod(tx, originalId)
    const applied = await appliedEvents(tx, base)
    const inBase = new Set(base.snapshot.orders.map((o) => o.orderId))
    const replayOf = (item: LateItem): { extra: string | null; removed: string | null } => {
      const orderId = item.order_id ?? item.event!.order_id
      const reverses = item.event?.reverses_event_id ?? null
      return { extra: inBase.has(orderId) ? null : orderId, removed: applied.some((e) => e.id === reverses) ? reverses : null }
    }
    for (const key of [...new Set(ofPeriod.map((item) => JSON.stringify(replayOf(item))))]) {
      const { extra, removed } = JSON.parse(key) as ReturnType<typeof replayOf>
      const group = ofPeriod.filter((item) => JSON.stringify(replayOf(item)) === key)
      const { input, lines } = await replayWith(tx, original, base, extra, removed, group)
      const still = applied.filter((e) => e.id !== removed)
      for (const item of group) {
        for (const origin of originsFor(item, input, lines, still, rounding)) origins.push(await insertOrigin(tx, runId, origin))
      }
    }
  }
  return { origins, itemIds: items.map((item) => item.id) }
}

/** Approved restatement origins of the calendar not yet consumed (D-B3-14), for the run's snapshot. */
export async function restatementOrigins(tx: Tx, period: PeriodRow): Promise<AdjustmentOrigin[]> {
  const { rows } = await tx.query<{
    id: string; payee_position_id: string; rule_key: string; source_kind: AdjustmentOrigin['sourceKind']; amount_minor: string
    original_period_id: string; reason_code: string | null
  }>(
    `SELECT o.id, o.payee_position_id, o.rule_key, o.source_kind, o.amount_minor::text, o.original_period_id, o.reason_code
     FROM adjustment_origin o JOIN restatement s ON s.id = o.restatement_id JOIN period op ON op.id = o.original_period_id
     WHERE s.state = 'approved' AND o.consumed_run_id IS NULL AND op.calendar_id = $1
       AND op.ends_at <= (SELECT starts_at FROM period WHERE id = $2)
     ORDER BY o.id`,
    [period.calendar_id, period.id],
  )
  return rows.map((row) => ({
    originType: 'restatement', originId: row.id, payeePositionId: row.payee_position_id, ruleKey: row.rule_key, sourceKind: row.source_kind,
    amountMinor: BigInt(row.amount_minor), originalPeriodId: row.original_period_id, reasonCode: row.reason_code,
  }))
}
