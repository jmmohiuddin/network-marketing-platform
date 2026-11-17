// pay.percent_by_level (TS-01, TS-02) plus the line builder shared by the payout primitives of this owner
// (unilevel, generations, differential, override, matching, fast-start, one-time, pools).
import { EngineError } from '../errors.js'
import { expressionRefs } from '../expression.js'
import { largestRemainder, mulRate, parseDecimal, toRaw } from '../money.js'
import { ENGINE_VERSION, holdsRank, TRACE_SOURCE_LIMIT, type CreditedLine, type LineVolumes, type PayoutFn, type PositionVolumes, type QualificationOutput, type RunContext } from '../pipeline.js'
import { nearestAncestor } from '../tree.js'
import type { BonusRule, Decimal, LadderRank, MeasureRule, OrderPurpose, PassNumber, PlanVersion, PositionId, RankRef, RawLine, TraceOrder, TraceSource, TreeKind } from '../types.js'

// ---------------------------------------- shared by the payout primitives ----------------------------------------

/** One source of a payout line. Only the sources a trace keeps are turned into TraceSource objects. */
export interface Contribution {
  readonly k: number // source position index; -1 = market/company
  readonly level: number | null
  readonly measure: string | null
  readonly ruleKey: string | null
  readonly base: bigint
  readonly baseScale: 'minor' | 'raw'
  readonly rate: Decimal | null
  readonly share?: { readonly num: bigint; readonly den: bigint }
  readonly capMinor?: bigint
  readonly raw: bigint
  readonly orders?: readonly TraceOrder[]
}
/** purposeRaw: the part of a contribution's raw paid on orders of `purpose`; every primitive states it (0 when no order). */
export interface LineSpec {
  readonly pass: PassNumber
  readonly unit: 'currency' | 'points'
  readonly tree: TreeKind | null
  readonly ladders: readonly string[]
  readonly purposeRaw: (c: Contribution, purpose: OrderPurpose) => bigint
}
/** Credited lines reaching source position k through `targets` (k values whose measure includes a line credited at j). */
export interface OrderAttribution {
  readonly lines: readonly CreditedLine[]
  readonly mi: number // personal measure index in the credited lines
  readonly compact: boolean // false: aggregate measure, attributed in full traces only (unbounded order lists)
  readonly targets: (j: number, visit: (k: number) => void) => void
}
export interface SourceDetail {
  readonly orders?: OrderAttribution
  readonly compressedOver?: (c: Contribution, payee: number) => readonly PositionId[]
}
export interface LineBuilder {
  add(payee: number, c: Contribution): void
  lines(detail?: SourceDetail): RawLine[]
}
interface Entry { readonly c: Contribution; readonly seq: number }
interface Acc { raw: bigint; readonly purpose: bigint[]; readonly kept: Entry[]; omittedCount: number; omittedRaw: bigint; readonly full: boolean }

/** Trace source order: level asc (null first), position index (= position id) asc, then insertion order. */
function before(a: Entry, b: Entry): boolean {
  const la = a.c.level ?? -1
  const lb = b.c.level ?? -1
  if (la !== lb) return la < lb
  return a.c.k !== b.c.k ? a.c.k < b.c.k : a.seq < b.seq
}

/** Purposes whose split this rule's lines must carry: named by a max_share limit on it or on a matching rule over it. */
export function limitedPurposes(plan: PlanVersion, ruleKey: string): OrderPurpose[] {
  const named = (key: string): OrderPurpose[] => plan.constraints.flatMap((c) => (c.kind === 'limit.max_share_from_purpose' && c.scope.includes(key) ? [c.purpose] : []))
  const viaMatching = plan.bonuses.flatMap((b) => (b.kind === 'pay.matching' && b.of.includes(ruleKey) ? named(b.key) : []))
  return [...new Set([...named(ruleKey), ...viaMatching])]
}

/** Orders credited to each needed source position, with their value in the measure (lines arrive sorted by order id). */
function creditedOrders(a: OrderAttribution, need: ReadonlySet<number>): Map<number, { orderId: string; value: bigint }[]> {
  const out = new Map<number, { orderId: string; value: bigint }[]>()
  for (const line of a.lines) {
    const v = line.values[a.mi]!
    if (line.positionIndex < 0 || v === 0n) continue
    a.targets(line.positionIndex, (k) => {
      if (!need.has(k)) return
      const list = out.get(k) ?? []
      if (list.length === 0) out.set(k, list)
      const last = list[list.length - 1]
      if (last?.orderId === line.orderId) last.value += v
      else list.push({ orderId: line.orderId, value: v })
    })
  }
  return out
}

/** Source raw split over its orders by their value (largest remainder, ties order id asc): parts sum to raw. */
function splitOrders(raw: bigint, parts: readonly { orderId: string; value: bigint }[]): TraceOrder[] {
  if (parts.length === 0) return []
  const magnitude = raw < 0n ? -raw : raw
  const split = largestRemainder(magnitude, parts.map((p) => p.value))
  return parts.map((p, i) => ({ orderId: p.orderId, raw: raw < 0n ? -split[i]! : split[i]! }))
}

/**
 * Accumulates contributions per payee and emits at most one RawLine per (payee, rule), payees by position index.
 * The trace keeps the first TRACE_SOURCE_LIMIT sources in trace order (all of them for options.fullTraceFor);
 * the rest are summed into `omitted`, so sum(sources.raw) + omitted.raw = raw. The purpose split is summed over
 * every contribution, kept or omitted.
 */
export function payoutLines(ctx: RunContext, rule: BonusRule, q: Pick<QualificationOutput, 'paidAs'>, spec: LineSpec): LineBuilder {
  const ids = ctx.trees.sponsor.ids
  const full = new Set(ctx.options.fullTraceFor.filter((l) => l.ruleKey === rule.key).map((l) => l.payeePositionId))
  const purposes = limitedPurposes(ctx.input.plan, rule.key)
  const accs: (Acc | undefined)[] = new Array<Acc | undefined>(ids.length)
  let seq = 0
  const omit = (acc: Acc, e: Entry): void => {
    acc.omittedCount++
    acc.omittedRaw += e.c.raw
  }
  const rankEvaluated = (k: number): LadderRank[] =>
    spec.ladders.map((ladder) => {
      const r = q.paidAs.get(ladder)?.[k] ?? -1
      return { ladder, rank: r >= 0 ? (ctx.input.plan.ladders.find((l) => l.key === ladder)?.ranks[r]?.key ?? null) : null }
    })

  return {
    add(payee: number, c: Contribution): void {
      if (c.raw === 0n) return
      const acc = (accs[payee] ??= { raw: 0n, purpose: purposes.map(() => 0n), kept: [], omittedCount: 0, omittedRaw: 0n, full: full.has(ids[payee]!) })
      acc.raw += c.raw
      purposes.forEach((p, i) => (acc.purpose[i]! += spec.purposeRaw(c, p)))
      const e = { c, seq: seq++ }
      if (acc.full) {
        acc.kept.push(e)
        return
      }
      if (acc.kept.length === TRACE_SOURCE_LIMIT) {
        const last = acc.kept[TRACE_SOURCE_LIMIT - 1]!
        if (!before(e, last)) return omit(acc, e)
        acc.kept.pop()
        omit(acc, last)
      }
      let i = acc.kept.length
      while (i > 0 && before(e, acc.kept[i - 1]!)) i--
      acc.kept.splice(i, 0, e)
    },

    lines(detail: SourceDetail = {}): RawLine[] {
      const attribution = detail.orders
      const cites = (acc: Acc, c: Contribution): boolean => attribution !== undefined && c.orders === undefined && c.k >= 0 && (attribution.compact || acc.full)
      const need = new Set<number>()
      for (const acc of accs) if (acc !== undefined) for (const { c } of acc.kept) if (cites(acc, c)) need.add(c.k)
      const orders = attribution !== undefined && need.size > 0 ? creditedOrders(attribution, need) : new Map<number, { orderId: string; value: bigint }[]>()
      const out: RawLine[] = []
      for (let k = 0; k < ids.length; k++) {
        const acc = accs[k]
        if (acc === undefined || acc.raw === 0n) continue
        const kept = acc.full ? [...acc.kept].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0)) : acc.kept
        const sources: TraceSource[] = kept.map(({ c }) => ({
          positionId: c.k >= 0 ? ids[c.k]! : null,
          level: c.level,
          measure: c.measure,
          ruleKey: c.ruleKey,
          base: c.base,
          baseScale: c.baseScale,
          rate: c.rate,
          share: c.share ?? null,
          capMinor: c.capMinor ?? null,
          raw: c.raw,
          orders: c.orders ?? (cites(acc, c) ? splitOrders(c.raw, orders.get(c.k) ?? []) : []),
          compressedOver: detail.compressedOver?.(c, k) ?? [],
        }))
        out.push({
          payeePositionId: ids[k]!,
          ruleKey: rule.key,
          kind: rule.kind,
          sourceKind: rule.sourceKind,
          pass: spec.pass,
          unit: spec.unit,
          reversalPolicy: rule.reversalPolicy,
          origin: null,
          raw: acc.raw,
          allocatedMinor: null,
          purposeRaw: purposes.map((purpose, i) => ({ purpose, raw: acc.purpose[i]! })),
          trace: {
            rule: rule.key,
            kind: rule.kind,
            pass: spec.pass,
            planVersionId: ctx.input.plan.planVersionId,
            engineVersion: ENGINE_VERSION,
            payeePositionId: ids[k]!,
            rankEvaluated: rankEvaluated(k),
            tree: spec.tree === null ? null : { kind: spec.tree, knownAtUs: ctx.evaluation.knownAtUs },
            sources,
            omitted: { count: acc.omittedCount, raw: acc.omittedRaw },
            raw: acc.raw,
            steps: [],
          },
        })
      }
      return out
    },
  }
}

/** Payee predicate: an earner (TR-ENG-16) that holds the rule's eligibleIf rank. */
export function payeeOf(ctx: RunContext, q: Pick<QualificationOutput, 'paidAs'>, ref: RankRef | null): (k: number) => boolean {
  const holds = holdsRank(ctx, q, ref)
  return (k) => ctx.earner[k] === 1 && holds(k)
}

/** Distinct ladder keys of the rank references a rule evaluates, for Trace.rankEvaluated. */
export function laddersOf(...keys: readonly (string | null | undefined)[]): string[] {
  return keys.filter((key, i): key is string => typeof key === 'string' && keys.indexOf(key) === i)
}

export function measureValues(volumes: PositionVolumes, key: string): BigInt64Array {
  const values = volumes.byMeasure.get(key)
  if (values === undefined) throw new EngineError('INVALID_INPUT', 'bonus references an unknown measure', { measure: key })
  return values
}

function measureRule(plan: Pick<PlanVersion, 'measures'>, key: string): MeasureRule {
  const m = plan.measures.find((x) => x.key === key)
  if (m === undefined) throw new EngineError('INVALID_INPUT', 'bonus references an unknown measure', { measure: key })
  return m
}

/**
 * Unit of a payable measure: a personal measure's unit, followed through group roll-ups and derived measures. A
 * derived measure has the one unit of the volume measures it reads (counts are plain factors); none = not payable.
 */
export function measureUnit(plan: Pick<PlanVersion, 'measures'>, key: string): 'currency' | 'points' {
  const unit = unitOf(plan, key, [])
  if (unit === null) throw new EngineError('INVALID_INPUT', 'a count is not a payable measure', { measure: key })
  return unit
}

function unitOf(plan: Pick<PlanVersion, 'measures'>, key: string, path: readonly string[]): 'currency' | 'points' | null {
  if (path.includes(key)) throw new EngineError('INVALID_INPUT', 'measure roll-up is cyclic', { measure: key })
  const m = measureRule(plan, key)
  switch (m.kind) {
    case 'volume.personal':
      return m.unit
    case 'volume.group':
    case 'volume.enrolled_group':
      return unitOf(plan, m.of, [...path, key])
    case 'measure.derived': {
      const units = new Set(expressionRefs(m.expr).measures.map((k) => unitOf(plan, k, [...path, key])).filter((u) => u !== null))
      if (units.size > 1) throw new EngineError('INVALID_INPUT', 'a derived measure mixes currency and points', { measure: key })
      return [...units][0] ?? null
    }
    default:
      return null
  }
}

/**
 * Unit of a measure a primitive walks up the tree itself (percent_by_level, override, differential, generations):
 * it must be volume.personal, since a group measure already holds the downline and the walk would count it again.
 */
export function walkedMeasureUnit(plan: PlanVersion, rule: BonusRule, key: string): 'currency' | 'points' {
  const m = measureRule(plan, key)
  if (m.kind !== 'volume.personal') throw new EngineError('INVALID_INPUT', 'this bonus walks the tree itself: its measure must be volume.personal', { rule: rule.key, measure: key })
  return m.unit
}

/** The measure over one order purpose's lines (pass 2 computes it for every purpose a constraint names). */
export function purposeValues(volumes: PositionVolumes, purpose: OrderPurpose, measure: string): BigInt64Array {
  const values = volumes.byPurpose.get(purpose)?.byMeasure.get(measure)
  if (values === undefined) throw new EngineError('INVARIANT', 'no purpose split for a limited bonus measure', { purpose, measure })
  return values
}

/** Purpose part of a contribution whose base is `measure` at its source position: raw x purpose value / base. */
export function measurePurpose(volumes: PositionVolumes, measure: string): LineSpec['purposeRaw'] {
  return (c, purpose) => (c.base === 0n ? 0n : (c.raw * purposeValues(volumes, purpose, measure)[c.k]!) / c.base)
}

/** For bonuses paid on no order (flat, one-time). */
export const noOrderPurpose: LineSpec['purposeRaw'] = () => 0n

/**
 * Orders cited by an order_line rule (BR-REV-07, AC-20.1), or undefined for restatement rules. A source on a
 * personal measure cites the orders credited to it; on volume.group / volume.enrolled_group it cites the orders
 * credited to the positions its value includes (full traces only). `targets` overrides the walk (generations).
 */
export function orderAttribution(ctx: RunContext, rule: BonusRule, lineVolumes: LineVolumes, measure: string, targets?: OrderAttribution['targets']): OrderAttribution | undefined {
  if (rule.reversalPolicy !== 'order_line') return undefined
  const m = measureRule(ctx.input.plan, measure)
  const personal = m.kind === 'volume.personal' ? m : m.kind === 'volume.group' || m.kind === 'volume.enrolled_group' ? measureRule(ctx.input.plan, m.of) : null
  const mi = personal?.kind === 'volume.personal' ? lineVolumes.measureKeys.indexOf(personal.key) : -1
  if (mi < 0) throw new EngineError('INVALID_INPUT', 'an order_line bonus needs a measure on order lines or one roll-up of it', { rule: rule.key, measure })
  const lines = lineVolumes.lines
  if (targets !== undefined) return { lines, mi, compact: false, targets }
  if (m.kind === 'volume.personal') return { lines, mi, compact: true, targets: (j, visit) => visit(j) }
  const self = (m.kind === 'volume.group' || m.kind === 'volume.enrolled_group') && m.includeSelf
  const tree = ctx.trees[m.kind === 'volume.group' ? m.tree : 'sponsor']
  const all = m.kind === 'volume.group'
  return {
    lines, mi, compact: false,
    targets: (j, visit) => {
      if (self) visit(j)
      for (let a = tree.parent[j]!; a >= 0; a = all ? tree.parent[a]! : -1) visit(a)
    },
  }
}

/** Parses an integer plan parameter (levels, shares, n). */
export function count(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new EngineError('INVALID_INPUT', `${what} must be a non-negative integer`, { value: String(value) })
  return value
}

// ---------------------------------------- pay.percent_by_level ----------------------------------------

/**
 * Payee earns levels[l-1] x measure of each position l levels below it (TS-01). A source failing eligibleIf is
 * inactive: its own volume is never paid. Without compression every position consumes its level; with dynamic
 * compression a position that is not a payee (not an earner, TR-ENG-16, or failing eligibleIf) is skipped and
 * consumes none (TS-02, BR-GEN-07; relationship rows are untouched).
 */
export const percentByLevel: PayoutFn<'pay.percent_by_level'> = (rule, ctx, done) => {
  const q = done.qualification
  const tree = ctx.trees[rule.tree]
  const holds = holdsRank(ctx, q, rule.eligibleIf)
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rates = rule.levels.map(parseDecimal)
  const measure = measureValues(done.volumes, rule.measure)
  const dynamic = rule.compression === 'dynamic'
  const up = dynamic ? nearestAncestor(tree, payee) : tree.parent
  const unit = walkedMeasureUnit(ctx.input.plan, rule, rule.measure)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit, tree: rule.tree, ladders: laddersOf(rule.eligibleIf?.ladder), purposeRaw: measurePurpose(done.volumes, rule.measure) })

  for (let k = 0; k < tree.ids.length; k++) {
    const m = measure[k]!
    if (m === 0n || !holds(k)) continue
    let a = up[k]!
    for (let level = 1; level <= rates.length && a >= 0; level++, a = up[a]!) {
      if (!payee(a)) continue
      out.add(a, { k, level, measure: rule.measure, ruleKey: null, base: m, baseScale: 'minor', rate: rule.levels[level - 1]!, raw: mulRate(toRaw(m), rates[level - 1]!) })
    }
  }

  const compressedOver = (c: Contribution, payeeIndex: number): PositionId[] => {
    const skipped: PositionId[] = []
    for (let p = tree.parent[c.k]!; p >= 0 && p !== payeeIndex; p = tree.parent[p]!) if (!payee(p)) skipped.push(tree.ids[p]!)
    return skipped
  }
  return out.lines({ orders: orderAttribution(ctx, rule, done.lineVolumes, rule.measure), compressedOver: dynamic ? compressedOver : undefined })
}
