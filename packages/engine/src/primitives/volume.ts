// Volume primitives: pass 1 (per order line), pass 2 (per position) and the points factor (BR-MNY-05).
// ENGINE_GENEALOGY §4 (order inputs) and §6.6 (passes 1-2). Rounding: the only rounding here is the
// pro-rata reversal of a line, rounded once per (line, measure) through money.roundRaw under
// settings.roundingMode. Iteration: orders by order id, lines by line id, events by (atUs, eventId),
// positions by index; input object keys are never iterated.
import { EngineError } from '../errors.js'
import { derivedValues } from '../expression.js'
import { assertInt64, largestRemainder, parseDecimal, RATE_SCALE, roundRaw, toRaw } from '../money.js'
import type { CreditedLine, PassFn, PositionVolumes, RunContext } from '../pipeline.js'
import { compareId, rollUp, type Tree } from '../tree.js'
import type { ItemRules, LineSource, MeasureRule, Order, OrderEvent, OrderLine, OrderPurpose, PlanVersion, PointsFactor, QualificationStateRow, RunSettings } from '../types.js'

type PersonalMeasure = Extract<MeasureRule, { readonly kind: 'volume.personal' }>
/** Exact fraction of a line's quantity reversed by this period's events (num / den, 0 <= value <= 1). */
interface Fraction { readonly num: bigint; readonly den: bigint }
/** Customer roll-up (BR-ATT-04): which measure indexes split, over which servicing-chain levels, by what weights. */
interface Split { readonly splits: readonly boolean[]; readonly levels: readonly number[]; readonly weights: readonly bigint[] }

const invalid = (message: string, details: Readonly<Record<string, string>> = {}): EngineError => new EngineError('INVALID_INPUT', message, details)
const lineKey = (orderId: string, lineId: string): string => JSON.stringify([orderId, lineId])
const isPersonal = (m: MeasureRule): m is PersonalMeasure => m.kind === 'volume.personal'

// ---------------------------------------- pass 1 ----------------------------------------

export const lineVolumePass: PassFn<'lineVolumes'> = (ctx) => {
  const { plan, settings, snapshot } = ctx.input
  const measures = plan.measures.filter(isPersonal)
  const measureKeys = measures.map((m) => m.key)
  const split = customerSplit(plan, measureKeys)
  const events = eventsByLine(snapshot.orderEvents)
  const lines: CreditedLine[] = []
  for (const order of sortedUnique(snapshot.orders, (o) => o.orderId, 'order id')) {
    const type = ctx.participantTypes.get(order.buyerTypeCode)
    if (!type) throw invalid('order names an unknown buyer type', { orderId: order.orderId, typeCode: order.buyerTypeCode })
    const customer = type.countsAsEndCustomer
    const credit = creditIndex(ctx.trees.sponsor, order)
    const rollUpTo = customer && split ? { split, chain: servicingChain(ctx.trees.sponsor, credit, split.levels) } : null
    for (const line of sortedUnique(order.lines, (l) => l.lineId, 'line id')) {
      validateLine(order, line)
      const key = lineKey(order.orderId, line.lineId)
      const reversed = reversedFraction(line, events.get(key) ?? [], settings)
      events.delete(key)
      const values = measures.map((m) => creditedValue(m, line, customer, reversed, settings))
      lines.push(...creditRows(order, line.lineId, customer, credit, values, rollUpTo))
    }
  }
  const orphan = [...events.values()][0]?.[0]
  if (orphan) throw invalid('order event names an order line not in this period', { eventId: orphan.eventId, orderId: orphan.orderId, lineId: orphan.lineId })
  return { measureKeys, lines, warnings: [] }
}

function sortedUnique<T>(items: readonly T[], id: (t: T) => string, what: string): T[] {
  const sorted = [...items].sort((a, b) => compareId(id(a), id(b)))
  sorted.forEach((t, i) => {
    if (i > 0 && id(t) === id(sorted[i - 1]!)) throw invalid(`duplicate ${what}`, { id: id(t) })
  })
  return sorted
}

function creditIndex(sponsor: Tree, order: Order): number {
  if (order.creditPositionId === null) return -1
  const k = sponsor.index.get(order.creditPositionId)
  if (k === undefined) throw invalid('order credits an unknown position', { orderId: order.orderId, positionId: order.creditPositionId })
  return k
}

function validateLine(order: Order, line: OrderLine): void {
  const bad = !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.amountMinor < 0n || line.taxMinor < 0n || line.volumes.some((v) => v.perUnitMinor < 0n)
  if (bad) throw invalid('order line needs a positive integer quantity and non-negative amounts', { orderId: order.orderId, lineId: line.lineId })
  sortedUnique(line.volumes, (v) => v.name, `volume name on order ${order.orderId} line ${line.lineId}`)
}

function eventsByLine(events: readonly OrderEvent[]): Map<string, OrderEvent[]> {
  const byLine = new Map<string, OrderEvent[]>()
  const ordered = sortedUnique(events, (e) => e.eventId, 'order event id').sort((a, b) => (a.atUs < b.atUs ? -1 : a.atUs > b.atUs ? 1 : compareId(a.eventId, b.eventId)))
  for (const e of ordered) {
    const key = lineKey(e.orderId, e.lineId)
    byLine.set(key, [...(byLine.get(key) ?? []), e])
  }
  return byLine
}

/**
 * BR-RET-01/02/03, BR-VOL-03, BR-REV-06: refund, return, chargeback and cancelled reverse q / quantity of
 * the line; exchange reverses nothing; chargeback_reversed credits q back. With restockingFeeAffectsVolume
 * the reversal keeps the fee's share credited: q / quantity x refund / (refund + fee).
 */
function reversedFraction(line: OrderLine, events: readonly OrderEvent[], settings: RunSettings): Fraction {
  const quantity = BigInt(line.quantity)
  let num = 0n
  let den = 1n
  let returned = 0
  let chargedBack = 0
  for (const e of events) {
    const fail = (message: string): EngineError => invalid(message, { eventId: e.eventId })
    if (!Number.isSafeInteger(e.quantity) || e.quantity <= 0 || e.refundMinor < 0n || e.restockingFeeMinor < 0n) throw fail('order event needs a positive integer quantity and non-negative amounts')
    if (e.type === 'exchange') continue
    if (e.restockingFeeMinor > 0n && (e.type === 'chargeback' || e.type === 'chargeback_reversed')) throw fail('a chargeback carries no restocking fee')
    if (e.type === 'chargeback_reversed') {
      if (e.quantity > chargedBack) throw fail('chargeback reversed exceeds the quantity charged back')
      chargedBack -= e.quantity
      returned -= e.quantity
    } else {
      if (returned + e.quantity > line.quantity) throw fail('reversed quantity exceeds purchased minus already reversed')
      if (e.type === 'chargeback') chargedBack += e.quantity
      returned += e.quantity
    }
    const feeShare = settings.restockingFeeAffectsVolume && e.restockingFeeMinor > 0n
    const keep = feeShare ? e.refundMinor : 1n
    const whole = feeShare ? e.refundMinor + e.restockingFeeMinor : 1n
    const sign = e.type === 'chargeback_reversed' ? -1n : 1n
    const eventDen = quantity * whole
    num = num * eventDen + sign * BigInt(e.quantity) * keep * den
    den *= eventDen
  }
  return { num, den }
}

function sourceValue(line: OrderLine, source: LineSource): bigint {
  switch (source.from) {
    case 'volume':
      return (line.volumes.find((v) => v.name === source.name)?.perUnitMinor ?? 0n) * BigInt(line.quantity)
    case 'amount':
      return line.amountMinor
    case 'amount_ex_tax':
      return line.amountMinor - line.taxMinor
  }
}

const itemCredited = (items: ItemRules, line: OrderLine): boolean =>
  !items.excludeItemClasses.includes(line.itemClass) && (items.categories === null || items.categories.includes(line.category))

function creditedValue(m: PersonalMeasure, line: OrderLine, customer: boolean, reversed: Fraction, settings: RunSettings): bigint {
  const counted = m.orders === 'all' || (m.orders === 'customer') === customer
  if (!counted || !itemCredited(m.items, line)) return 0n
  const value = sourceValue(line, m.source)
  return value - roundRaw((toRaw(value) * reversed.num) / reversed.den, settings.roundingMode)
}

/** BR-ATT-04 split of one value over the chain: largest remainder with ties by payee id ascending (MONEY I-11; company last). */
function rollUpParts(value: bigint, weights: readonly bigint[], chain: readonly number[]): bigint[] {
  const rank = (k: number): number => (k < 0 ? Number.MAX_SAFE_INTEGER : k)
  const order = chain.map((_, j) => j).sort((a, b) => rank(chain[a]!) - rank(chain[b]!) || a - b)
  const parts = largestRemainder(value, order.map((j) => weights[j]!))
  const out = new Array<bigint>(chain.length)
  order.forEach((j, i) => (out[j] = parts[i]!))
  return out
}

function customerSplit(plan: PlanVersion, measureKeys: readonly string[]): Split | null {
  const r = plan.customerRollUp
  if (r === null) return null
  for (const key of r.measures) if (!measureKeys.includes(key)) throw invalid('customer roll-up names a measure that is not volume.personal', { measure: key })
  const shares = [...r.shares].sort((a, b) => a.level - b.level)
  const weights = shares.map((s) => parseDecimal(s.share))
  const levels = shares.map((s) => s.level)
  const badLevel = levels.some((l, i) => !Number.isSafeInteger(l) || l < 0 || (i > 0 && l === levels[i - 1]))
  if (badLevel || weights.reduce((a, w) => a + w, 0n) !== RATE_SCALE) throw invalid('customer roll-up needs distinct levels >= 0 and shares summing to 1')
  return { splits: measureKeys.map((k) => r.measures.includes(k)), levels, weights }
}

/** Position credited at each roll-up level: level 0 = servicing position, 1 = its sponsor, ...; -1 = company. */
function servicingChain(sponsor: Tree, credit: number, levels: readonly number[]): number[] {
  return levels.map((level) => {
    let k = credit
    for (let l = 0; l < level && k >= 0; l++) k = sponsor.parent[k]!
    return k
  })
}

function creditRows(order: Order, lineId: string, customer: boolean, credit: number, values: readonly bigint[], rollUpTo: { split: Split; chain: readonly number[] } | null): CreditedLine[] {
  const rows = new Map<number, bigint[]>()
  const add = (k: number, i: number, v: bigint): void => {
    if (v === 0n) return
    const row = rows.get(k) ?? values.map(() => 0n)
    row[i] = row[i]! + v
    rows.set(k, row)
  }
  values.forEach((v, i) => {
    if (rollUpTo?.split.splits[i]) rollUpParts(v, rollUpTo.split.weights, rollUpTo.chain).forEach((part, j) => add(rollUpTo.chain[j]!, i, part))
    else add(credit, i, v)
  })
  return [...rows.keys()]
    .sort((a, b) => a - b)
    .map((k) => ({ orderId: order.orderId, lineId, positionIndex: k, creditIndex: credit, customer, purpose: order.purpose, buyerParticipantId: order.buyerParticipantId, values: rows.get(k)! }))
}

// ---------------------------------------- pass 2 ----------------------------------------

export const positionVolumePass: PassFn<'volumes'> = (ctx, done) => {
  const { measureKeys, lines } = done.lineVolumes
  const purposes = [...new Set(ctx.input.plan.constraints.flatMap((c) => (c.kind === 'limit.max_share_from_purpose' ? [c.purpose] : [])))]
  const prior = done.transition.prior
  const byPurpose = new Map(purposes.map((p: OrderPurpose) => [p, measuresOver(ctx, measureKeys, lines.filter((l) => l.purpose === p), prior)]))
  return { ...measuresOver(ctx, measureKeys, lines, prior), byPurpose }
}

/** Every plan measure (plan order) and the personal market totals over the given credited lines. */
function measuresOver(ctx: RunContext, measureKeys: readonly string[], lines: readonly CreditedLine[], prior: readonly (QualificationStateRow | null)[]): Omit<PositionVolumes, 'byPurpose'> {
  const { perPosition, market } = personalSums(lines, measureKeys.length, ctx.positions.length)
  const byMeasure = new Map<string, BigInt64Array>()
  for (const m of ctx.input.plan.measures) {
    if (byMeasure.has(m.key)) throw invalid('duplicate measure key', { measure: m.key })
    byMeasure.set(m.key, measureValues(m, ctx, { measureKeys, lines, perPosition, byMeasure, prior }))
  }
  return { byMeasure, marketTotal: new Map(measureKeys.map((key, i) => [key, assertInt64(market[i]!, `market total ${key}`)])) }
}

interface Pass2State {
  readonly measureKeys: readonly string[]
  readonly lines: readonly CreditedLine[]
  readonly perPosition: readonly BigInt64Array[] // by personal measure index
  readonly byMeasure: ReadonlyMap<string, BigInt64Array> // measures already computed (plan order)
  readonly prior: readonly (QualificationStateRow | null)[] // prior state after transitions (expression state leaves)
}

function personalSums(lines: readonly CreditedLine[], measureCount: number, n: number): { perPosition: BigInt64Array[]; market: bigint[] } {
  const sums = Array.from({ length: measureCount }, () => new Array<bigint>(n).fill(0n))
  const market = new Array<bigint>(measureCount).fill(0n)
  for (const line of lines) {
    line.values.forEach((v, i) => {
      market[i] = market[i]! + v
      if (line.positionIndex >= 0) sums[i]![line.positionIndex] = sums[i]![line.positionIndex]! + v
    })
  }
  return { perPosition: sums.map((s) => BigInt64Array.from(s, (v) => assertInt64(v, 'personal volume'))), market }
}

function measureValues(m: MeasureRule, ctx: RunContext, s: Pass2State): BigInt64Array {
  switch (m.kind) {
    case 'volume.personal':
      return s.perPosition[s.measureKeys.indexOf(m.key)]!
    case 'volume.group': {
      const own = earlier(s, m.of, m.key)
      const group = rollUp(ctx.trees[m.tree], own)
      return m.includeSelf ? group : group.map((v, k) => v - own[k]!)
    }
    case 'volume.enrolled_group':
      return overChildren(ctx.trees.sponsor, earlier(s, m.of, m.key), m.includeSelf, (v) => v)
    case 'count.customers':
      return countCustomers(s, m.measure, m.minPerCustomerMinor, ctx.positions.length)
    case 'count.enrolled':
      return overChildren(ctx.trees.sponsor, earlier(s, m.measure, m.key), false, (v) => (v >= m.atLeastMinor ? 1n : 0n))
    case 'measure.derived':
      return derivedValues(m.expr, { ctx, rule: m.key, measure: (key) => earlier(s, key, m.key), prior: s.prior })
  }
}

function earlier(s: Pass2State, of: string, key: string): BigInt64Array {
  const values = s.byMeasure.get(of)
  if (!values) throw invalid('measure depends on a measure not defined before it', { measure: key, of })
  return values
}

/** out[k] = (self ? own[k] : 0) + sum over personally sponsored children c of f(own[c]). */
function overChildren(sponsor: Tree, own: BigInt64Array, self: boolean, f: (v: bigint) => bigint): BigInt64Array {
  return BigInt64Array.from(own, (v, k) => {
    let sum = self ? v : 0n
    for (let c = sponsor.childStart[k]!; c < sponsor.childStart[k + 1]!; c++) sum += f(own[sponsor.childList[c]!]!)
    return assertInt64(sum, 'enrolled measure')
  })
}

/**
 * Distinct end customers serviced by the position (the orders' credit position) whose orders reach the minimum
 * in `measure`, on the unsplit value: the customer roll-up shares credited upline (BR-ATT-04) do not count.
 */
function countCustomers(s: Pass2State, measure: string, minPerCustomer: bigint, n: number): BigInt64Array {
  const i = s.measureKeys.indexOf(measure)
  if (i < 0) throw invalid('count.customers needs a volume.personal measure', { measure })
  const perCustomer = new Map<string, { k: number; sum: bigint }>()
  for (const line of s.lines) {
    if (!line.customer || line.creditIndex < 0) continue
    const key = JSON.stringify([line.creditIndex, line.buyerParticipantId])
    const prior = perCustomer.get(key)?.sum ?? 0n
    perCustomer.set(key, { k: line.creditIndex, sum: prior + line.values[i]! })
  }
  const out = new BigInt64Array(n)
  for (const { k, sum } of perCustomer.values()) if (sum >= minPerCustomer) out[k] = out[k]! + 1n
  return out
}

// ---------------------------------------- points (BR-MNY-05, TS-23) ----------------------------------------

/** Factor (parts per RATE_SCALE) of the market's latest entry effective at atUs. No default (DEC-14). */
export function pointsFactor(plan: PlanVersion, marketId: string, atUs: bigint): bigint {
  let best: PointsFactor | null = null
  for (const f of plan.pointsToCurrency) {
    if (f.marketId !== marketId || f.effectiveFromUs > atUs) continue
    if (best !== null && f.effectiveFromUs === best.effectiveFromUs) throw invalid('two points factors share an effective date', { marketId })
    if (best === null || f.effectiveFromUs > best.effectiveFromUs) best = f
  }
  if (best === null) throw invalid('no points-to-currency factor is effective for the market', { marketId, atUs: atUs.toString() })
  return parseDecimal(best.factor)
}
