// run(): builds the RunContext, registers every pass in SDD-07 §4 order and implements passes 9-12:
// adjustments, rounding, settlement (netting then withholding), invariants + control totals + hashes.
import { createHash } from 'node:crypto'
import { interner } from './compact.js'
import { EngineError } from './errors.js'
import { traceAmountMinor } from './explain.js'
import { assertInt64, formatRate, mulRate, parseDecimal, RATE_SCALE, roundRaw, toRaw } from './money.js'
import { BONUS_PASS, ENGINE_VERSION, PASS_NUMBER, runPipeline, type CapOutput, type Done, type PassesThrough, type PassFn, type PayoutFn, type PayoutPass, type RunContext, type Settlement } from './pipeline.js'
import { capAmountMinor, capPass, constraintPass, lineValue } from './primitives/caps.js'
import { differential } from './primitives/differential.js'
import { fastStart } from './primitives/fast-start.js'
import { generations } from './primitives/generations.js'
import { matching } from './primitives/matching.js'
import { flat, oneTime } from './primitives/one-time.js'
import { override } from './primitives/override.js'
import { percentOfMeasure } from './primitives/percent-of-measure.js'
import { pool, unpaidPoolMinor } from './primitives/pools.js'
import { qualificationPass } from './primitives/rank.js'
import { retailMargin } from './primitives/retail.js'
import { transitionPass } from './primitives/transition.js'
import { percentByLevel } from './primitives/unilevel.js'
import { lineVolumePass, pointsFactor, positionVolumePass } from './primitives/volume.js'
import { buildTree, compareId, evaluationInstant, positionOrder } from './tree.js'
import type {
  AdjustmentOrigin, BonusKind, CreditAward, Expr, ExprOp, ControlTotals, EngineWarning, LadderRank, MeasureValue, Order, OrderEvent, OrderLine, OriginType, Participant, ParticipantId, ParticipantType,
  PayeeSettlement, PeriodSummary, Position, PositionId, PositionSummary, QualificationStateRow, RawLine, Receivable, Relationship, ResultLine, RunInput,
  RunOptions, RunOutput, SourceKind, TaxLine, TraceStep, WithholdingInstruction,
} from './types.js'

// ---------- context ----------

function unique<T>(items: readonly T[], key: (t: T) => string, what: string): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const k = key(item)
    if (map.has(k)) throw new EngineError('INVALID_INPUT', `duplicate ${what}`, { id: k })
    map.set(k, item)
  }
  return map
}

export function buildContext(input: RunInput, options: RunOptions): RunContext {
  const { snapshot } = input
  const ids = positionOrder(snapshot.positions.map((p) => p.positionId))
  const byId = new Map(snapshot.positions.map((p) => [p.positionId, p]))
  const positions = ids.map((id) => byId.get(id)!)
  const evaluation = { validAtUs: evaluationInstant(snapshot.period), knownAtUs: snapshot.knownAtUs }
  const participants = unique(snapshot.participants, (p) => p.participantId, 'participant')
  for (const p of participants.values()) unique(p.facts, (f) => f.key, `fact key of participant ${p.participantId}`)
  const participantTypes = unique(snapshot.participantTypes, (t) => t.code, 'participant type')
  const earner = new Uint8Array(ids.length)
  positions.forEach((p, k) => {
    const owner = participants.get(p.ownerParticipantId)
    const type = owner && participantTypes.get(owner.typeCode)
    if (!type) throw new EngineError('INVALID_INPUT', 'position owner or owner type is unknown', { positionId: p.positionId })
    // TR-ENG-16: no payout to a position terminated before the period.
    earner[k] = type.canEarn && !(p.status === 'terminated' && p.statusFromUs <= snapshot.period.startsAtUs) ? 1 : 0
  })
  return {
    input, options, evaluation, positions, participants, participantTypes, earner,
    trees: { sponsor: buildTree(ids, snapshot.relationships, 'sponsor', evaluation), placement: buildTree(ids, snapshot.relationships, 'placement', evaluation) },
    ownerOf: positions.map((p) => p.ownerParticipantId),
  }
}

// ---------- passes 4-6: plan.bonuses in plan order, routed by BONUS_PASS ----------

type PassOf<K extends BonusKind> = K extends 'pay.matching' ? 'matching' : K extends 'pay.pool' ? 'pools' : 'individual'
const PAYOUT: { readonly [K in BonusKind]: PayoutFn<K, PassOf<K>> } = {
  'pay.retail_margin': retailMargin, 'pay.percent_by_level': percentByLevel, 'pay.generations': generations,
  'pay.percent_of_measure': percentOfMeasure, 'pay.differential': differential, 'pay.override': override,
  'pay.fast_start': fastStart, 'pay.flat': flat, 'pay.one_time': oneTime, 'pay.matching': matching, 'pay.pool': pool,
}

function payoutPass<P extends PayoutPass>(pass: P): PassFn<P> {
  return ((ctx: RunContext, done: Done<P>): readonly RawLine[] =>
    ctx.input.plan.bonuses
      .filter((rule) => BONUS_PASS[rule.kind] === pass)
      // BONUS_PASS and PassOf agree (pipeline.test), so each primitive receives the outputs its type asks for.
      .flatMap((rule) => (PAYOUT[rule.kind] as unknown as PayoutFn<BonusKind, P>)(rule, ctx, done))) as unknown as PassFn<P>
}

// ---------- pass 9 ----------

const adjustmentPass: PassFn<'adjustments'> = (ctx) => {
  const seen = new Set<string>()
  return ctx.input.snapshot.adjustments.map((a): RawLine => {
    const once = JSON.stringify([a.originType, a.originId])
    if (seen.has(once)) throw new EngineError('INVALID_INPUT', 'adjustment origin appears twice (consumed once, FR-COMP-010)', { originType: a.originType, originId: a.originId })
    seen.add(once)
    if (!ctx.trees.sponsor.index.has(a.payeePositionId)) throw new EngineError('INVALID_INPUT', 'adjustment payee is not a snapshot position', { positionId: a.payeePositionId })
    const raw = toRaw(assertInt64(a.amountMinor, 'adjustment amount'))
    return {
      payeePositionId: a.payeePositionId, ruleKey: a.ruleKey, kind: 'adjustment', sourceKind: a.sourceKind, pass: PASS_NUMBER.adjustments,
      unit: 'currency', reversalPolicy: null, origin: { originType: a.originType, originId: a.originId, originalPeriodId: a.originalPeriodId }, raw, allocatedMinor: a.amountMinor, purposeRaw: [],
      trace: {
        rule: a.ruleKey, kind: 'adjustment', pass: PASS_NUMBER.adjustments, planVersionId: ctx.input.plan.planVersionId, engineVersion: ENGINE_VERSION,
        payeePositionId: a.payeePositionId, rankEvaluated: [], tree: null, omitted: { count: 0, raw: 0n }, raw, steps: [],
        sources: [{ positionId: null, level: null, measure: null, ruleKey: a.ruleKey, base: a.amountMinor, baseScale: 'minor', rate: null, share: null, capMinor: null, raw, orders: [], compressedOver: [] }],
      },
    }
  })
}

// ---------- pass 10 ----------

const nullFirst = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? -1 : b === null ? 1 : compareId(a, b))
type LineKeyFields = Pick<RawLine, 'payeePositionId' | 'pass' | 'ruleKey' | 'origin'>
/** RESULT_HASH line order: payee position id, pass, rule key, origin type, origin id. */
function compareLines(a: LineKeyFields, b: LineKeyFields): number {
  return compareId(a.payeePositionId, b.payeePositionId) || a.pass - b.pass || compareId(a.ruleKey, b.ruleKey)
    || nullFirst(a.origin?.originType ?? null, b.origin?.originType ?? null) || nullFirst(a.origin?.originId ?? null, b.origin?.originId ?? null)
}

/**
 * Pass 10: points to currency and the one rounding of each line (allocated amounts stay), zero lines dropped, the rest
 * in RESULT_HASH order. The amounts and the order are settled here (every refusal happens in the pass); the ResultLine
 * objects are made per chunk of OUTPUT_CHUNK_LINES as the caller drains them, and each raw line is released once made.
 */
const roundingPass: PassFn<'rounding'> = (ctx, done) => {
  const { plan, settings, snapshot } = ctx.input
  // The pass's own list: entries are cleared as their chunk is made (the runner drops done.caps.lines after this pass).
  const pending: (RawLine | undefined)[] = [...done.caps.lines, ...done.adjustments]
  let factor: bigint | null = null
  const valued = (l: RawLine): { value: bigint; steps: TraceStep[]; amountMinor: bigint } => {
    let value = lineValue(l)
    const steps: TraceStep[] = [...l.trace.steps]
    if (l.unit === 'points') {
      // Allocations convert before they split (pools.ts); limits refuse points lines.
      if (l.allocatedMinor !== null) throw new EngineError('INVARIANT', 'a points line carries an allocated amount', { positionId: l.payeePositionId, ruleKey: l.ruleKey })
      factor ??= pointsFactor(plan, snapshot.market.marketId, ctx.evaluation.validAtUs)
      const after = mulRate(value, factor)
      steps.push({ step: 'points', factor: formatRate(factor), beforeRaw: value, afterRaw: after })
      value = after
    }
    let amountMinor = l.allocatedMinor
    if (amountMinor === null) {
      amountMinor = roundRaw(value, settings.roundingMode) // the one rounding of this line
      steps.push({ step: 'rounding', mode: settings.roundingMode, raw: value, minor: amountMinor })
    }
    return { value, steps, amountMinor }
  }
  const kept: number[] = []
  pending.forEach((l, i) => {
    const { amountMinor } = valued(l!)
    if (amountMinor === 0n) return
    if (!ctx.trees.sponsor.index.has(l!.payeePositionId)) throw new EngineError('INVALID_INPUT', 'line payee is not a snapshot position', { positionId: l!.payeePositionId })
    assertInt64(amountMinor, 'line amount')
    kept.push(i)
  })
  // The index breaks ties, so the order equals the stable sort of the lines themselves.
  const order = Int32Array.from(kept).sort((a, b) => compareLines(pending[a]!, pending[b]!) || a - b)
  const resultLine = (i: number): ResultLine => {
    const l = pending[i]!
    pending[i] = undefined
    const { steps, amountMinor } = valued(l)
    return {
      payeePositionId: l.payeePositionId, payeeParticipantId: ctx.ownerOf[ctx.trees.sponsor.index.get(l.payeePositionId)!]!, ruleKey: l.ruleKey, kind: l.kind,
      sourceKind: l.sourceKind, pass: l.pass, amountMinor, currency: snapshot.market.currency, reversalPolicy: l.reversalPolicy, origin: l.origin,
      trace: { ...l.trace, steps },
    }
  }
  return {
    count: order.length,
    *chunks() {
      for (let from = 0; from < order.length; from += OUTPUT_CHUNK_LINES) yield Array.from(order.subarray(from, from + OUTPUT_CHUNK_LINES), resultLine)
    },
  }
}

// ---------- passes 11-12, streamed (D-B6-12) ----------
// The final lines leave the engine in chunks (runIncremental), so passes 11 and 12 read them once, line by line in
// output order: the tally keeps only what settlement, invariants, limits, control totals and state need from them.

type Gross = ReadonlyMap<ParticipantId, { readonly amount: bigint; readonly positions: ReadonlySet<PositionId> }>

interface LineTally {
  /** award: a line of a credit-award rule (D-V1A-03): checked and counted against limits, but not cash (no gross, totals). */
  readonly add: (line: ResultLine, award?: boolean) => void
  readonly gross: Gross
  readonly oneTimeKeys: ReadonlyMap<PositionId, readonly string[]> // pay.one_time keys paid now, by payee position
  readonly checkLimits: () => void
  readonly controlTotals: (settlement: Settlement, breakageMinor: bigint) => ControlTotals
}

function invariant(ok: boolean, message: string, details: Record<string, string> = {}): void {
  if (!ok) throw new EngineError('INVARIANT', message, details)
}

const plus = <K>(sums: Map<K, bigint>, key: K, amount: bigint): void => {
  sums.set(key, (sums.get(key) ?? 0n) + amount)
}

/** Sums by key, sorted by key. */
function sorted<K extends string>(sums: ReadonlyMap<K, bigint>): { key: K; amount: bigint }[] {
  return [...sums].sort((a, b) => compareId(a[0], b[0])).map(([k, v]) => ({ key: k, amount: assertInt64(v, `total ${k}`) }))
}

const perPersonOnMeasure = (cap: RunInput['plan']['caps'][number]): boolean => cap.method.type === 'per_person' && cap.base.kind === 'measure'

function lineTally(ctx: RunContext, done: Pick<Done<'settlement'>, 'volumes' | 'caps'>): LineTally {
  const { plan, settings } = ctx.input
  const onceKey = new Map(plan.bonuses.flatMap((b) => (b.kind === 'pay.one_time' ? [[b.key, b.onceKey] as const] : [])))
  const gross = new Map<ParticipantId, { amount: bigint; positions: Set<PositionId> }>()
  const oneTimeKeys = new Map<PositionId, string[]>()
  const byRule = new Map<string, bigint>()
  const bySourceKind = new Map<SourceKind, bigint>()
  const byOrigin = new Map<OriginType, bigint>()
  // Paid (non-origin) lines in each cap's scope: one sum ('') or, for a per-person cap on a measure, one per payee position.
  const capSums = plan.caps.map(() => new Map<string, bigint>())
  const limitSums = plan.constraints.map(() => new Map<ParticipantId, bigint>()) // limit.max_per_period, per participant
  let grossMinor = 0n
  let lineCount = 0
  let prev: ResultLine | undefined
  return {
    gross,
    oneTimeKeys,
    add(l, award = false) {
      // Lines are sorted by (payee, pass, rule, origin) and a rule has one pass, so a duplicate is the line before.
      const ref = { positionId: l.payeePositionId, ruleKey: l.ruleKey }
      const same = prev !== undefined && prev.payeePositionId === l.payeePositionId && prev.ruleKey === l.ruleKey
        && (prev.origin?.originType ?? null) === (l.origin?.originType ?? null) && (prev.origin?.originId ?? null) === (l.origin?.originId ?? null)
      invariant(!same, 'more than one line per (payee position, rule, origin)', ref)
      invariant(l.origin !== null || ctx.earner[ctx.trees.sponsor.index.get(l.payeePositionId)!] === 1, 'payout to a position that may not earn', ref)
      invariant(traceAmountMinor(l.trace) === l.amountMinor, 'line trace does not reconcile to its amount', ref)
      prev = l
      if (award) {
        invariant(l.origin === null && l.amountMinor > 0n, 'a credit award is a positive line of its rule', ref)
      } else {
        lineCount += 1
        grossMinor += l.amountMinor
        const g = gross.get(l.payeeParticipantId) ?? { amount: 0n, positions: new Set<PositionId>() }
        gross.set(l.payeeParticipantId, { amount: g.amount + l.amountMinor, positions: g.positions.add(l.payeePositionId) })
        plus(byRule, l.ruleKey, l.amountMinor)
        plus(bySourceKind, l.sourceKind, l.amountMinor)
        if (l.origin !== null) {
          plus(byOrigin, l.origin.originType, l.amountMinor)
          return
        }
      }
      plan.caps.forEach((cap, i) => {
        if (cap.scope.includes(l.ruleKey)) plus(capSums[i]!, perPersonOnMeasure(cap) ? l.payeePositionId : '', l.amountMinor)
      })
      plan.constraints.forEach((c, i) => {
        if (c.kind === 'limit.max_per_period' && c.scope.includes(l.ruleKey)) plus(limitSums[i]!, l.payeeParticipantId, l.amountMinor)
      })
      const key = onceKey.get(l.ruleKey)
      if (key !== undefined) oneTimeKeys.set(l.payeePositionId, [...(oneTimeKeys.get(l.payeePositionId) ?? []), key])
    },
    // After rounding: every cap (bound or not, per payee for per_person) and every max_per_period holds.
    checkLimits() {
      plan.caps.forEach((cap, i) => {
        if (cap.method.type !== 'per_person' || cap.base.kind !== 'measure') {
          invariant((capSums[i]!.get('') ?? 0n) <= done.caps.applications[i]!.capMinor, 'cap exceeded', { capKey: cap.key })
          return
        }
        const own = done.volumes.byMeasure.get(cap.base.measure)!
        for (const [positionId, amount] of capSums[i]!) {
          const personCap = capAmountMinor(toRaw(own[ctx.trees.sponsor.index.get(positionId)!]!), cap.rate, settings.roundingMode)
          invariant(amount <= personCap, 'per-person cap exceeded', { capKey: cap.key, positionId })
        }
      })
      // max_share is exact in pass 7; rounded lines no longer carry the purpose part
      plan.constraints.forEach((c, i) => {
        if (c.kind !== 'limit.max_per_period') return
        for (const [participantId, amount] of limitSums[i]!) invariant(amount <= c.maxMinor, 'participant limit exceeded', { key: c.key, participantId })
      })
    },
    controlTotals(settlement, breakageMinor) {
      const total = (f: (p: PayeeSettlement) => bigint): bigint => assertInt64(settlement.payees.reduce((a, p) => a + f(p), 0n), 'payee total')
      return {
        grossMinor: assertInt64(grossMinor, 'gross total'),
        byRule: sorted(byRule).map((s) => ({ ruleKey: s.key, amountMinor: s.amount })),
        bySourceKind: sorted(bySourceKind).map((s) => ({ sourceKind: s.key, amountMinor: s.amount })),
        adjustmentsByOrigin: sorted(byOrigin).map((s) => ({ originType: s.key, amountMinor: s.amount })),
        nettedMinor: total((p) => p.nettedMinor),
        withheldMinor: total((p) => p.withheldMinor),
        netPayableMinor: total((p) => p.netPayableMinor),
        breakageMinor: assertInt64(breakageMinor, 'breakage'),
        // Every line is rounded once, every split is exact (largestRemainder) and points pools convert before they
        // split, so no residue arises; removed and unallocated amounts are breakage.
        residueMinor: 0n,
        lineCount,
        payeeCount: settlement.payees.length,
      }
    },
  }
}

/** Pass 11: netting of receivables, then withholding, per payee of the lines (gross from the tally). */
function settle(ctx: RunContext, gross: Gross): Settlement {
  const receivable = unique(ctx.input.snapshot.receivables, (r) => r.participantId, 'receivable')
  const withholding = unique(ctx.input.snapshot.withholding, (w) => w.participantId, 'withholding instruction')
  const payees: PayeeSettlement[] = []
  const taxLines: TaxLine[] = []
  const warnings: EngineWarning[] = []
  for (const participantId of [...gross.keys()].sort(compareId)) {
    const { amount, positions } = gross.get(participantId)!
    const before = receivable.get(participantId)?.amountMinor ?? 0n
    if (before < 0n) throw new EngineError('INVALID_INPUT', 'receivable balance must be >= 0', { participantId })
    // Netting first (BR-REV-09: never a negative payable). A negative gross grows the receivable instead.
    const netted = amount < 0n ? amount : before < amount ? before : amount
    const taxable = amount - netted
    const rule = withholding.get(participantId)
    let withheld = 0n
    if (rule) {
      const rate = parseDecimal(rule.rate)
      if (rate > RATE_SCALE) throw new EngineError('INVALID_INPUT', 'withholding rate above 1', { participantId, ruleId: rule.ruleId })
      if (rule.rounding !== 'half_up' && rule.rounding !== 'half_even') throw new EngineError('INVALID_INPUT', 'unknown withholding rounding', { participantId, ruleId: rule.ruleId })
      // priorMinor may be negative (this year's committed gross can be clawbacks only); prior + gross <= limit still holds.
      if (rule.threshold !== undefined && rule.threshold.limitMinor < 0n) {
        throw new EngineError('INVALID_INPUT', 'withholding threshold limit must be >= 0', { participantId, ruleId: rule.ruleId })
      }
      const below = rule.threshold !== undefined && rule.threshold.priorMinor + amount <= rule.threshold.limitMinor
      withheld = below ? 0n : roundRaw(mulRate(toRaw(taxable), rate), rule.rounding)
      taxLines.push({ participantId, ruleId: rule.ruleId, taxableMinor: taxable, withheldMinor: withheld })
    } else {
      warnings.push({ code: 'NO_WITHHOLDING_RULE', message: 'no withholding instruction for this payee: nothing withheld, review required', ref: participantId })
    }
    payees.push({
      participantId, positions: [...positions].sort(compareId), grossMinor: amount, receivableBeforeMinor: before, nettedMinor: netted,
      taxableMinor: taxable, withheldMinor: withheld, netPayableMinor: taxable - withheld, receivableAfterMinor: before - netted,
    })
  }
  // Settlement gross is the tally's sum of each payee's lines by construction; what remains to check is the split.
  for (const p of payees) {
    const ref = { participantId: p.participantId }
    invariant(p.grossMinor === p.nettedMinor + p.withheldMinor + p.netPayableMinor, 'gross != netted + withheld + net payable', ref)
    invariant(p.netPayableMinor >= 0n && p.withheldMinor >= 0n && p.receivableAfterMinor >= 0n, 'negative payable, withholding or receivable', ref)
  }
  return { payees, taxLines, warnings }
}

/** Every allocation's parts sum to its total (FR-COMP-012). */
function checkAllocations(lines: readonly RawLine[]): void {
  const allocations = new Map<string, { total: bigint; sum: bigint }>()
  for (const l of lines) {
    for (const s of l.trace.steps) {
      if (s.step !== 'allocation') continue
      const a = allocations.get(s.key) ?? { total: s.totalMinor, sum: 0n }
      allocations.set(s.key, { total: a.total, sum: a.sum + s.afterMinor })
    }
  }
  for (const [key, a] of allocations) invariant(a.sum === a.total, 'allocation parts do not sum to its total (FR-COMP-012)', { key })
}

/**
 * Not earned: what the pass 4-6 lines would have paid minus what they pay after passes 7-8, plus pool parts without a
 * holder. A line passes 7-8 changed carries their steps, and the first such step's beforeRaw is the pass 4-6 value
 * (lineValue), so its amount before is roundRaw(beforeRaw); untouched lines remove nothing.
 */
function breakageMinor(ctx: RunContext, done: Done<'caps'>, capped: readonly RawLine[]): bigint {
  const mode = ctx.input.settings.roundingMode
  let removed = unpaidPoolMinor(ctx, done)
  for (const after of capped) {
    const first = after.trace.steps.find((s) => s.step === 'constraint' || s.step === 'cap')
    if (first !== undefined && (first.step === 'constraint' || first.step === 'cap')) removed += roundRaw(first.beforeRaw, mode) - (after.allocatedMinor ?? roundRaw(after.raw, mode))
  }
  return removed
}

/** Pass 8 plus what pass 12 needs from its lines (allocation sums, breakage), so pass 7's lines can go after pass 8 (S-1). */
const capsPass: PassFn<'caps'> = (ctx, done): CapOutput => {
  const out = capPass(ctx, done)
  checkAllocations(out.lines)
  return { ...out, breakageMinor: breakageMinor(ctx, done, out.lines) }
}

/** QualificationStateRow with a fixed field order, arrays sorted and bigint as decimal strings (RESULT_HASH). */
function canonicalState(row: QualificationStateRow): unknown {
  const byKey = <T extends { key: string }>(a: readonly T[]): T[] => [...a].sort((x, y) => compareId(x.key, y.key))
  const byLadder = <T extends { ladder: string }>(a: readonly T[]): T[] => [...a].sort((x, y) => compareId(x.ladder, y.ladder))
  return {
    positionId: row.positionId,
    paidAs: byLadder(row.paidAs).map((r) => ({ ladder: r.ladder, rank: r.rank })),
    titles: byLadder(row.titles).map((r) => ({ ladder: r.ladder, rank: r.rank })),
    graceUsed: byLadder(row.graceUsed).map((g) => ({ ladder: g.ladder, periods: g.periods })),
    counters: byKey(row.counters).map((c) => ({ key: c.key, value: c.value })),
    carry: byKey(row.carry).map((c) => ({ key: c.key, amountMinor: c.amountMinor.toString(), periodsHeld: c.periodsHeld })),
    oneTimeFlags: [...row.oneTimeFlags].sort(compareId),
    banked: byKey(row.banked).map((b) => ({ key: b.key, amountMinor: b.amountMinor.toString() })),
  }
}

function sortedState(rows: readonly QualificationStateRow[]): QualificationStateRow[] {
  return [...rows].sort((a, b) => compareId(a.positionId, b.positionId))
}

const byKeyOf = <T>(items: readonly T[], key: (t: T) => string): T[] => [...items].sort((a, b) => compareId(key(a), key(b)))
const lineRecord = (l: ResultLine): unknown => ['L', l.payeePositionId, l.pass, l.ruleKey, l.origin?.originType ?? null, l.origin?.originId ?? null, l.amountMinor.toString(), l.currency]
const awardRecord = (a: CreditAward): unknown => ['A', a.payeePositionId, a.ruleKey, a.creditType, a.amountMinor.toString(), a.currency]
const taxRecord = (t: TaxLine): unknown => ['T', t.participantId, t.ruleId, t.taxableMinor.toString(), t.withheldMinor.toString()]
const stateRecord = (s: QualificationStateRow): unknown => ['S', s.positionId, canonicalState(s)]
const summaryRecord = (s: PositionSummary): unknown =>
  ['V', s.positionId, byKeyOf(s.measures, (m) => m.measure).map((m) => [m.measure, m.valueMinor.toString()]), byKeyOf(s.paidAs, (p) => p.ladder).map((p) => [p.ladder, p.rank])]

/** RESULT_HASH writer: records are hashed as they are made (no array of every record: S-1 memory). */
function recordHash(): { readonly record: (r: unknown) => void; readonly digest: () => string } {
  const h = createHash('sha256')
  let first = true
  return {
    record(r) {
      h.update(first ? JSON.stringify(r) : `\n${JSON.stringify(r)}`)
      first = false
    },
    digest: () => h.digest('hex'),
  }
}

export function resultHash(lines: readonly ResultLine[], taxLines: readonly TaxLine[], state: readonly QualificationStateRow[], summaries: readonly PositionSummary[]): string {
  const h = recordHash()
  for (const l of lines) h.record(lineRecord(l))
  for (const t of byKeyOf(taxLines, (t) => t.participantId)) h.record(taxRecord(t))
  for (const s of sortedState(state)) h.record(stateRecord(s))
  for (const s of byKeyOf(summaries, (s) => s.positionId)) h.record(summaryRecord(s))
  return h.digest()
}

/** Pass 3 runs before pass 4 pays, so a one-time key paid now is added to the payee's state row here (TS-25). */
function committedState(state: readonly QualificationStateRow[], paid: ReadonlyMap<PositionId, readonly string[]>): QualificationStateRow[] {
  return sortedState(state).map((row) => {
    const keys = paid.get(row.positionId)
    return keys === undefined ? row : { ...row, oneTimeFlags: [...new Set([...row.oneTimeFlags, ...keys])].sort(compareId) }
  })
}

/** Volume summary of the position at index k (one shared paid-as copy per rank combination: S-1 memory). */
function summarizer(ctx: RunContext, done: Pick<Done<'settlement'>, 'volumes' | 'qualification'>): (p: Position, k: number) => PositionSummary {
  const { plan } = ctx.input
  const paidAs = interner<readonly LadderRank[]>()
  return (p, k) => {
    const at = plan.ladders.map((l) => done.qualification.paidAs.get(l.key)![k]!)
    return {
      positionId: p.positionId,
      measures: plan.measures.map((m) => ({ measure: m.key, valueMinor: done.volumes.byMeasure.get(m.key)![k]! })),
      paidAs: paidAs(at.join(), () => plan.ladders.map((l, i) => ({ ladder: l.key, rank: at[i]! < 0 ? null : l.ranks[at[i]!]!.key }))),
    }
  }
}

// ---------- inputs hash ----------

/** Every property name of RunInput, so the canonical form never depends on an input object's key order. */
const INPUT_FIELDS = [
  'adjustments', 'agg', 'allocation', 'amountMinor', 'args', 'atLeastMinor', 'atUs', 'award', 'banked', 'base', 'baseMeasure', 'bonuses', 'buyerEnrolledWithinUs', 'buyerParticipantId',
  'buyerTypeCode', 'byRank', 'calendar', 'calendars', 'canEarn', 'canHoldPositions', 'canSponsor', 'capMinor', 'caps', 'carries', 'carry',
  'categories', 'category', 'childPositionId', 'code', 'compression', 'const', 'constraints', 'contentHash', 'count', 'counters', 'countsAsEndCustomer',
  'creditPositionId', 'creditType', 'creditedAtUs', 'currency', 'customerRollUp', 'den', 'effectiveFromUs', 'eligibleIf', 'endsAtUs', 'enrolledAtUs',
  'equals', 'eventId', 'excludeItemClasses', 'expiresAfterPeriods', 'expr', 'fact', 'facts', 'factor', 'first', 'firstMultiplier', 'from',
  'gracePeriods', 'graceUsed', 'history', 'incrementIf', 'includeSelf', 'itemClass', 'items', 'keepIf', 'key', 'kind', 'knownAtUs',
  'ladder', 'ladders', 'leader', 'leg', 'level', 'levels', 'limitMinor', 'lineId', 'lines', 'maintenance', 'map', 'market', 'marketId', 'maxMinor',
  'maxPerLegShare', 'maxShare', 'measure', 'measures', 'method', 'minPerCustomerMinor', 'minorDigits', 'n', 'name', 'num', 'of',
  'oneTimeFlags', 'onceKey', 'op', 'orderBy', 'orderEvents', 'orderId', 'orders', 'originId', 'originType', 'originalPeriodId',
  'ownerParticipantId', 'paidAs', 'parentPositionId', 'participantId', 'participantTypes', 'participants', 'parts', 'payeePositionId',
  'perOrderCapMinor', 'perUnitMinor', 'period', 'periodId', 'periods', 'periodsHeld', 'plan', 'planVersionId', 'pointsToCurrency',
  'positionId', 'positions', 'priorMinor', 'priorState', 'productId', 'purpose', 'quantity', 'rank', 'ranks', 'rate', 'rates', 'reason', 'reasonCode',
  'receivables', 'recordedAtUs', 'reduce', 'refundMinor', 'relationships', 'requires', 'residue', 'restockingFeeAffectsVolume',
  'restockingFeeMinor', 'reversalPolicy', 'roundingMode', 'rounding', 'rule', 'ruleId', 'ruleKey', 'scope', 'second', 'secondShareAbove',
  'settings', 'settingsVersionId', 'share', 'shares', 'snapshot', 'snapshotId', 'source', 'sourceKind', 'startsAtUs', 'state', 'stateItem',
  'status', 'statusFromUs', 'supersededAtUs', 'taxMinor', 'threshold', 'tiers', 'titles', 'to', 'transitions', 'tree', 'type', 'typeCode', 'unit',
  'validFromUs', 'validToUs', 'value', 'valueMinor', 'version', 'volumes', 'window', 'withholding',
] as const satisfies readonly DeepKeys<RunInput>[]
type DeepKeys<T> = T extends bigint | string | number | boolean | null ? never
  : T extends readonly (infer E)[] ? DeepKeys<E>
  // An operator node's args are expressions again: their keys come from the other Expr members (no infinite type).
  : T extends { readonly op: ExprOp; readonly args: readonly Expr[] } ? 'op' | 'args'
  : { [K in keyof T & string]: K | DeepKeys<T[K]> }[keyof T & string]
// Compile-time: a RunInput property missing from INPUT_FIELDS fails here (it would silently leave the hash).
const exhaustive: [Exclude<DeepKeys<RunInput>, (typeof INPUT_FIELDS)[number]>] extends [never] ? true : never = true
const FIELDS: readonly string[] = exhaustive ? [...INPUT_FIELDS].sort(compareId) : []

const BIGINT_FIELD = /(Minor|Us)$/

/** Trust boundary: a *Minor / *Us field must be bigint (null where the type allows), never a JS number or missing. */
function checked(field: string, value: unknown): unknown {
  if (value === undefined) throw new EngineError('INVALID_INPUT', 'input field is missing', { field })
  if (BIGINT_FIELD.test(field) && typeof value !== 'bigint' && value !== null) throw new EngineError('INVALID_INPUT', 'money, volume and instant fields must be bigint', { field })
  return value
}

function canonical(key: string, value: unknown): unknown {
  if (key !== '') checked(key, value)
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const field of FIELDS) if (Object.hasOwn(value, field)) out[field] = (value as Record<string, unknown>)[field]
  return out
}

// High-volume snapshot rows hash as tuples in a fixed field order (scanning FIELDS per row is ~5x slower).
type Row = readonly (string | readonly [string, Row])[]
type RowKeys<R extends Row> = R[number] extends infer F ? (F extends string ? F : F extends readonly [infer N, Row] ? N : never) : never
/** A row naming exactly the fields of T (compile-time): a field added to types.ts must be added here. */
const rowOf = <T>() => <const R extends readonly ((keyof T & string) | readonly [keyof T & string, Row])[]>(row: R & ([Exclude<keyof T & string, RowKeys<R>>] extends [never] ? unknown : 'row misses a field')): R => row
type Of<T> = T extends readonly (infer E)[] ? E : never
const LADDER_RANK = rowOf<LadderRank>()(['ladder', 'rank'])
const PARTICIPANT_TYPE = rowOf<ParticipantType>()(['canEarn', 'canHoldPositions', 'canSponsor', 'code', 'countsAsEndCustomer'])
const PARTICIPANT = rowOf<Participant>()(['enrolledAtUs', ['facts', rowOf<Of<Participant['facts']>>()(['key', 'value'])], 'participantId', 'typeCode'])
const POSITION = rowOf<Position>()(['ownerParticipantId', 'positionId', 'status', 'statusFromUs'])
const RELATIONSHIP = rowOf<Relationship>()(['childPositionId', 'kind', 'leg', 'parentPositionId', 'recordedAtUs', 'supersededAtUs', 'validFromUs', 'validToUs'])
const LINE = rowOf<OrderLine>()(['amountMinor', 'category', 'itemClass', 'lineId', 'productId', 'quantity', 'taxMinor', ['volumes', rowOf<Of<OrderLine['volumes']>>()(['name', 'perUnitMinor'])]])
const ORDER = rowOf<Order>()(['buyerParticipantId', 'buyerTypeCode', 'creditPositionId', 'creditedAtUs', ['lines', LINE], 'orderId', 'purpose'])
const EVENT = rowOf<OrderEvent>()(['atUs', 'eventId', 'lineId', 'orderId', 'quantity', 'refundMinor', 'restockingFeeMinor', 'type'])
const RECEIVABLE = rowOf<Receivable>()(['amountMinor', 'participantId'])
const WITHHOLDING = rowOf<Omit<WithholdingInstruction, 'threshold'>>()(['participantId', 'rate', 'rounding', 'ruleId'])
const THRESHOLD = rowOf<NonNullable<WithholdingInstruction['threshold']>>()(['limitMinor', 'priorMinor'])
const ADJUSTMENT = rowOf<AdjustmentOrigin>()(['amountMinor', 'originId', 'originType', 'originalPeriodId', 'payeePositionId', 'reasonCode', 'ruleKey', 'sourceKind'])
const SUMMARY = rowOf<PositionSummary>()([['measures', rowOf<MeasureValue>()(['measure', 'valueMinor'])], ['paidAs', LADDER_RANK], 'positionId'])
const PERIOD = rowOf<PeriodSummary>()(['endsAtUs', 'periodId', ['positions', SUMMARY], 'startsAtUs'])
const STATE_ROW = rowOf<QualificationStateRow>()([
  ['banked', rowOf<Of<QualificationStateRow['banked']>>()(['amountMinor', 'key'])], ['carry', rowOf<Of<QualificationStateRow['carry']>>()(['amountMinor', 'key', 'periodsHeld'])],
  ['counters', rowOf<Of<QualificationStateRow['counters']>>()(['key', 'value'])], ['graceUsed', rowOf<Of<QualificationStateRow['graceUsed']>>()(['ladder', 'periods'])],
  'oneTimeFlags', ['paidAs', LADDER_RANK], 'positionId', ['titles', LADDER_RANK],
])

function tuple(item: object, row: Row): unknown[] {
  return row.map((f) => {
    const field = typeof f === 'string' ? f : f[0]
    const v = checked(field, (item as Record<string, unknown>)[field])
    if (typeof f !== 'string') return sortedRows(v as readonly object[], f[1])
    return typeof v === 'bigint' ? v.toString() : v
  })
}

/** The optional threshold is written only when present, so instructions without one hash as before D-BM-05. */
function withholdingTuple(item: WithholdingInstruction): unknown[] {
  const base = tuple(item, WITHHOLDING)
  return item.threshold === undefined ? base : [...base, tuple(item.threshold, THRESHOLD)]
}

/** Row arrays carry no meaning in their order (duplicates are refused where a key is looked up): hash them sorted. */
function sortedRows(items: readonly object[], row: Row): string[] {
  const of = row === WITHHOLDING ? (item: object) => withholdingTuple(item as WithholdingInstruction) : (item: object) => tuple(item, row)
  return items.map((item) => JSON.stringify(of(item))).sort(compareId)
}

/**
 * sha256 of the canonical RunInput: the input without its snapshot row arrays as JSON (properties in code-unit
 * order, bigint as decimal strings; plan arrays keep their order, which is meaningful), then each row array by
 * name: one JSON tuple per row, rows (and nested row arrays) sorted, so the snapshot's row order never matters.
 */
export function inputsHash(input: RunInput): string {
  const s = input.snapshot
  const rows: readonly [string, readonly object[], Row][] = [
    ['participantTypes', s.participantTypes, PARTICIPANT_TYPE], ['participants', s.participants, PARTICIPANT], ['positions', s.positions, POSITION], ['relationships', s.relationships, RELATIONSHIP],
    ['orders', s.orders, ORDER], ['orderEvents', s.orderEvents, EVENT], ['receivables', s.receivables, RECEIVABLE], ['withholding', s.withholding, WITHHOLDING],
    ['adjustments', s.adjustments, ADJUSTMENT], ['history', s.history, PERIOD], ['priorState.positions', s.priorState?.positions ?? [], STATE_ROW],
  ]
  const rest: RunInput = {
    ...input,
    snapshot: { ...s, participantTypes: [], participants: [], positions: [], relationships: [], orders: [], orderEvents: [], receivables: [], withholding: [], adjustments: [], history: [], priorState: s.priorState && { ...s.priorState, positions: [] } },
  }
  const h = createHash('sha256').update(JSON.stringify(rest, canonical))
  for (const [name, items, row] of rows) {
    h.update(`\n${JSON.stringify(name)}`)
    for (const text of sortedRows(items, row)) h.update(`\n${text}`)
  }
  return h.digest('hex')
}

// ---------- run ----------

export const PASSES: PassesThrough<'rounding'> = {
  transition: transitionPass, lineVolumes: lineVolumePass, volumes: positionVolumePass, qualification: qualificationPass,
  individual: payoutPass('individual'), matching: payoutPass('matching'), pools: payoutPass('pools'),
  constraints: constraintPass, caps: capsPass, adjustments: adjustmentPass, rounding: roundingPass,
}

/** Lines per output chunk of runIncremental (D-B6-16); state rows, summaries and payees use the same size. */
export const OUTPUT_CHUNK_LINES = 10_000

/** One piece of the output, in this order: every line chunk (final order), then state rows, volume summaries, payees. */
export type RunChunk =
  | { readonly kind: 'lines'; readonly lines: readonly ResultLine[] }
  | { readonly kind: 'qualification'; readonly rows: readonly QualificationStateRow[] }
  | { readonly kind: 'summaries'; readonly rows: readonly PositionSummary[] }
  | { readonly kind: 'payees'; readonly rows: readonly PayeeSettlement[] }
/** Everything of RunOutput that is not yielded in chunks. */
export type RunSummary = Omit<RunOutput, 'lines' | 'qualification' | 'volumeSummaries' | 'payees'>

function chunksOf<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let from = 0; from < items.length; from += OUTPUT_CHUNK_LINES) out.push(items.slice(from, from + OUTPUT_CHUNK_LINES))
  return out
}

/** Hands out the chunks one by one, dropping each from the queue before the caller sees it (the queue is this generator's own). */
function* drained<T>(chunks: T[][]): Generator<T[], void, undefined> {
  while (chunks.length > 0) yield chunks.shift()!
}

/** Passes 0-10; the final lines come back as chunks made on demand (pass 10), so nothing holds the whole line array. */
function calculated(input: RunInput, options: RunOptions) {
  const hash = inputsHash(input) // first: it also refuses missing fields and number-typed *Minor / *Us values
  const ctx = buildContext(input, options)
  const { rounding, ...done } = runPipeline(ctx, PASSES, 'rounding')
  return { hash, ctx, done, lineChunks: rounding.chunks() }
}

/**
 * The run as a stream (D-B6-12, S-1): yields the final lines in chunks of OUTPUT_CHUNK_LINES, then the state rows,
 * volume summaries and payees, and returns the rest of RunOutput. Passes 11-12 read each line once as it leaves, and
 * the engine keeps no reference to a chunk once yielded, so a caller that writes and drops chunks never holds the
 * whole output. Collecting every chunk gives exactly run()'s output.
 */
export function* runIncremental(input: RunInput, options: RunOptions = { fullTraceFor: [] }): Generator<RunChunk, RunSummary, undefined> {
  const { hash, ctx, done, lineChunks } = calculated(input, options)
  const tally = lineTally(ctx, done)
  const h = recordHash()
  const awardType = new Map(input.plan.bonuses.flatMap((b) => (b.award === undefined ? [] : [[b.key, b.award.creditType] as const])))
  const creditAwards: CreditAward[] = []
  for (const lines of lineChunks) {
    const cash: ResultLine[] = []
    for (const l of lines) {
      const creditType = l.origin === null ? awardType.get(l.ruleKey) : undefined
      tally.add(l, creditType !== undefined)
      if (creditType === undefined) {
        cash.push(l)
        h.record(lineRecord(l))
      } else {
        creditAwards.push({
          payeePositionId: l.payeePositionId, payeeParticipantId: l.payeeParticipantId, ruleKey: l.ruleKey, creditType,
          amountMinor: l.amountMinor, currency: l.currency, trace: l.trace,
        })
      }
    }
    if (cash.length > 0) yield { kind: 'lines', lines: cash }
  }
  const settlement = settle(ctx, tally.gross)
  tally.checkLimits()
  for (const t of settlement.taxLines) h.record(taxRecord(t)) // participant id order (settle)
  for (const rows of drained(chunksOf(committedState(done.qualification.state, tally.oneTimeKeys)))) {
    for (const s of rows) h.record(stateRecord(s))
    yield { kind: 'qualification', rows }
  }
  const summary = summarizer(ctx, done)
  for (let from = 0; from < ctx.positions.length; from += OUTPUT_CHUNK_LINES) {
    // ctx.positions are in position id order (positionOrder), the RESULT_HASH order of summaries.
    const rows = ctx.positions.slice(from, from + OUTPUT_CHUNK_LINES).map((p, i) => summary(p, from + i))
    for (const s of rows) h.record(summaryRecord(s))
    yield { kind: 'summaries', rows }
  }
  for (const rows of drained(chunksOf(settlement.payees))) yield { kind: 'payees', rows }
  // After every other record, and only when there are awards: runs without them hash as before D-V1A-03.
  for (const a of creditAwards) h.record(awardRecord(a))
  return {
    engineVersion: ENGINE_VERSION,
    planVersionId: input.plan.planVersionId,
    settingsVersionId: input.settings.settingsVersionId,
    snapshotId: input.snapshot.snapshotId,
    periodId: input.snapshot.period.periodId,
    inputsHash: hash,
    creditAwards,
    taxLines: settlement.taxLines,
    evaluations: done.qualification.evaluations,
    constraintApplications: done.constraints.applications,
    capApplications: done.caps.applications,
    transitionReport: done.transition.report,
    controlTotals: tally.controlTotals(settlement, done.caps.breakageMinor),
    warnings: [...done.lineVolumes.warnings, ...done.qualification.warnings, ...settlement.warnings],
    resultHash: h.digest(),
  }
}

/** The whole output at once: runIncremental collected. */
export function run(input: RunInput, options: RunOptions = { fullTraceFor: [] }): RunOutput {
  const lines: ResultLine[] = []
  const payees: PayeeSettlement[] = []
  const qualification: QualificationStateRow[] = []
  const volumeSummaries: PositionSummary[] = []
  const stream = runIncremental(input, options)
  for (let next = stream.next(); ; next = stream.next()) {
    if (next.done === true) {
      const s = next.value
      return {
        engineVersion: s.engineVersion, planVersionId: s.planVersionId, settingsVersionId: s.settingsVersionId, snapshotId: s.snapshotId, periodId: s.periodId,
        inputsHash: s.inputsHash, lines, creditAwards: s.creditAwards, payees, taxLines: s.taxLines, qualification, evaluations: s.evaluations, volumeSummaries,
        constraintApplications: s.constraintApplications, capApplications: s.capApplications, transitionReport: s.transitionReport,
        controlTotals: s.controlTotals, warnings: s.warnings, resultHash: s.resultHash,
      }
    }
    const chunk = next.value
    if (chunk.kind === 'lines') lines.push(...chunk.lines)
    else if (chunk.kind === 'qualification') qualification.push(...chunk.rows)
    else if (chunk.kind === 'summaries') volumeSummaries.push(...chunk.rows)
    else payees.push(...chunk.rows)
  }
}
