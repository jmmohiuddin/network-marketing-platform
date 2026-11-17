// run(): builds the RunContext, registers every pass in SDD-07 §4 order and implements passes 9-12:
// adjustments, rounding, settlement (netting then withholding), invariants + control totals + hashes.
import { createHash } from 'node:crypto'
import { EngineError } from './errors.js'
import { traceAmountMinor } from './explain.js'
import { assertInt64, formatRate, mulRate, parseDecimal, RATE_SCALE, roundRaw, toRaw } from './money.js'
import { BONUS_PASS, ENGINE_VERSION, PASS_NUMBER, runPipeline, type Done, type PassFn, type PassRegistry, type PayoutFn, type PayoutPass, type RunContext } from './pipeline.js'
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
  AdjustmentOrigin, BonusKind, Expr, ExprOp, ControlTotals, EngineWarning, LadderRank, MeasureValue, Order, OrderEvent, OrderLine, OriginType, Participant, ParticipantType,
  PayeeSettlement, PeriodSummary, Position, PositionSummary, QualificationStateRow, RawLine, Receivable, Relationship, ResultLine, RunInput,
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
/** RESULT_HASH line order: payee position id, pass, rule key, origin type, origin id. */
function compareLines(a: ResultLine, b: ResultLine): number {
  return compareId(a.payeePositionId, b.payeePositionId) || a.pass - b.pass || compareId(a.ruleKey, b.ruleKey)
    || nullFirst(a.origin?.originType ?? null, b.origin?.originType ?? null) || nullFirst(a.origin?.originId ?? null, b.origin?.originId ?? null)
}

const roundingPass: PassFn<'rounding'> = (ctx, done) => {
  const { plan, settings, snapshot } = ctx.input
  let factor: bigint | null = null
  const out: ResultLine[] = []
  for (const l of [...done.caps.lines, ...done.adjustments]) {
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
    if (amountMinor === 0n) continue
    const k = ctx.trees.sponsor.index.get(l.payeePositionId)
    if (k === undefined) throw new EngineError('INVALID_INPUT', 'line payee is not a snapshot position', { positionId: l.payeePositionId })
    out.push({
      payeePositionId: l.payeePositionId, payeeParticipantId: ctx.ownerOf[k]!, ruleKey: l.ruleKey, kind: l.kind, sourceKind: l.sourceKind, pass: l.pass,
      amountMinor: assertInt64(amountMinor, 'line amount'), currency: snapshot.market.currency, reversalPolicy: l.reversalPolicy, origin: l.origin, trace: { ...l.trace, steps },
    })
  }
  return out.sort(compareLines)
}

// ---------- pass 11 ----------

const settlementPass: PassFn<'settlement'> = (ctx, done) => {
  const receivable = unique(ctx.input.snapshot.receivables, (r) => r.participantId, 'receivable')
  const withholding = unique(ctx.input.snapshot.withholding, (w) => w.participantId, 'withholding instruction')
  const gross = new Map<string, { amount: bigint; positions: Set<string> }>()
  for (const l of done.rounding) {
    const g = gross.get(l.payeeParticipantId) ?? { amount: 0n, positions: new Set<string>() }
    gross.set(l.payeeParticipantId, { amount: g.amount + l.amountMinor, positions: g.positions.add(l.payeePositionId) })
  }
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
      withheld = roundRaw(mulRate(toRaw(taxable), rate), rule.rounding)
      taxLines.push({ participantId, ruleId: rule.ruleId, taxableMinor: taxable, withheldMinor: withheld })
    } else {
      warnings.push({ code: 'NO_WITHHOLDING_RULE', message: 'no withholding instruction for this payee: nothing withheld, review required', ref: participantId })
    }
    payees.push({
      participantId, positions: [...positions].sort(compareId), grossMinor: amount, receivableBeforeMinor: before, nettedMinor: netted,
      taxableMinor: taxable, withheldMinor: withheld, netPayableMinor: taxable - withheld, receivableAfterMinor: before - netted,
    })
  }
  return { payees, taxLines, warnings }
}

// ---------- pass 12 ----------

function invariant(ok: boolean, message: string, details: Record<string, string> = {}): void {
  if (!ok) throw new EngineError('INVARIANT', message, details)
}

function checkInvariants(ctx: RunContext, done: Done<'totals'>): void {
  const keys = new Set<string>()
  for (const l of done.rounding) {
    const ref = { positionId: l.payeePositionId, ruleKey: l.ruleKey }
    const key = JSON.stringify([l.payeePositionId, l.ruleKey, l.origin?.originType ?? null, l.origin?.originId ?? null])
    invariant(!keys.has(key), 'more than one line per (payee position, rule, origin)', ref)
    keys.add(key)
    invariant(l.origin !== null || ctx.earner[ctx.trees.sponsor.index.get(l.payeePositionId)!] === 1, 'payout to a position that may not earn', ref)
    invariant(traceAmountMinor(l.trace) === l.amountMinor, 'line trace does not reconcile to its amount', ref)
  }
  checkLimits(ctx, done)
  const byParticipant = new Map<string, bigint>()
  for (const l of done.rounding) byParticipant.set(l.payeeParticipantId, (byParticipant.get(l.payeeParticipantId) ?? 0n) + l.amountMinor)
  invariant(byParticipant.size === done.settlement.payees.length, 'every payee has one settlement')
  for (const p of done.settlement.payees) {
    const ref = { participantId: p.participantId }
    invariant(byParticipant.get(p.participantId) === p.grossMinor, 'settlement gross differs from the payee lines', ref)
    invariant(p.grossMinor === p.nettedMinor + p.withheldMinor + p.netPayableMinor, 'gross != netted + withheld + net payable', ref)
    invariant(p.netPayableMinor >= 0n && p.withheldMinor >= 0n && p.receivableAfterMinor >= 0n, 'negative payable, withholding or receivable', ref)
  }
}

/** Sum of amounts per key. */
function totalsBy<T>(items: readonly T[], key: (t: T) => string, amount: (t: T) => bigint): Map<string, bigint> {
  const sums = new Map<string, bigint>()
  for (const t of items) sums.set(key(t), (sums.get(key(t)) ?? 0n) + amount(t))
  return sums
}

/** After rounding: every cap (bound or not, per payee for per_person), every max_per_period, every allocation sums to its total. */
function checkLimits(ctx: RunContext, done: Done<'totals'>): void {
  const { plan, settings } = ctx.input
  const paid = done.rounding.filter((l) => l.origin === null)
  const inScope = (scope: readonly string[]): ResultLine[] => paid.filter((l) => scope.includes(l.ruleKey))
  plan.caps.forEach((cap, i) => {
    const lines = inScope(cap.scope)
    if (cap.method.type !== 'per_person' || cap.base.kind !== 'measure') {
      invariant(lines.reduce((a, l) => a + l.amountMinor, 0n) <= done.caps.applications[i]!.capMinor, 'cap exceeded', { capKey: cap.key })
      return
    }
    const own = done.volumes.byMeasure.get(cap.base.measure)!
    for (const [positionId, amount] of totalsBy(lines, (l) => l.payeePositionId, (l) => l.amountMinor)) {
      const personCap = capAmountMinor(toRaw(own[ctx.trees.sponsor.index.get(positionId)!]!), cap.rate, settings.roundingMode)
      invariant(amount <= personCap, 'per-person cap exceeded', { capKey: cap.key, positionId })
    }
  })
  for (const c of plan.constraints) {
    if (c.kind !== 'limit.max_per_period') continue // max_share is exact in pass 7; rounded lines no longer carry the purpose part
    for (const [participantId, amount] of totalsBy(inScope(c.scope), (l) => l.payeeParticipantId, (l) => l.amountMinor)) {
      invariant(amount <= c.maxMinor, 'participant limit exceeded', { key: c.key, participantId })
    }
  }
  const allocations = new Map<string, { total: bigint; sum: bigint }>()
  for (const l of done.caps.lines) {
    for (const s of l.trace.steps) {
      if (s.step !== 'allocation') continue
      const a = allocations.get(s.key) ?? { total: s.totalMinor, sum: 0n }
      allocations.set(s.key, { total: a.total, sum: a.sum + s.afterMinor })
    }
  }
  for (const [key, a] of allocations) invariant(a.sum === a.total, 'allocation parts do not sum to its total (FR-COMP-012)', { key })
}

/** Not earned: what the pass 4-6 lines would have paid minus what they pay after passes 7-8, plus pool parts without a holder. */
function breakageMinor(ctx: RunContext, done: Done<'totals'>): bigint {
  const mode = ctx.input.settings.roundingMode
  const before = [...done.individual, ...done.matching, ...done.pools]
  invariant(before.length === done.caps.lines.length, 'passes 7-8 must keep every line in place')
  const amount = (l: RawLine): bigint => l.allocatedMinor ?? roundRaw(l.raw, mode)
  let removed = unpaidPoolMinor(ctx, done)
  done.caps.lines.forEach((after, i) => {
    if (after !== before[i]) removed += amount(before[i]!) - amount(after)
  })
  return removed
}

function sumBy<T, K extends string>(items: readonly T[], key: (t: T) => K | null, amount: (t: T) => bigint): { key: K; amount: bigint }[] {
  const sums = new Map<K, bigint>()
  for (const t of items) {
    const k = key(t)
    if (k !== null) sums.set(k, (sums.get(k) ?? 0n) + amount(t))
  }
  return [...sums].sort((a, b) => compareId(a[0], b[0])).map(([k, v]) => ({ key: k, amount: assertInt64(v, `total ${k}`) }))
}

function controlTotals(ctx: RunContext, done: Done<'totals'>): ControlTotals {
  const { rounding: lines, settlement } = done
  const total = (f: (p: PayeeSettlement) => bigint): bigint => assertInt64(settlement.payees.reduce((a, p) => a + f(p), 0n), 'payee total')
  return {
    grossMinor: assertInt64(lines.reduce((a, l) => a + l.amountMinor, 0n), 'gross total'),
    byRule: sumBy(lines, (l) => l.ruleKey, (l) => l.amountMinor).map((s) => ({ ruleKey: s.key, amountMinor: s.amount })),
    bySourceKind: sumBy(lines, (l): SourceKind => l.sourceKind, (l) => l.amountMinor).map((s) => ({ sourceKind: s.key, amountMinor: s.amount })),
    adjustmentsByOrigin: sumBy(lines, (l): OriginType | null => l.origin?.originType ?? null, (l) => l.amountMinor).map((s) => ({ originType: s.key, amountMinor: s.amount })),
    nettedMinor: total((p) => p.nettedMinor),
    withheldMinor: total((p) => p.withheldMinor),
    netPayableMinor: total((p) => p.netPayableMinor),
    breakageMinor: assertInt64(breakageMinor(ctx, done), 'breakage'),
    // Every line is rounded once, every split is exact (largestRemainder) and points pools convert before they
    // split, so no residue arises; removed and unallocated amounts are breakage.
    residueMinor: 0n,
    lineCount: lines.length,
    payeeCount: settlement.payees.length,
  }
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

export function resultHash(lines: readonly ResultLine[], taxLines: readonly TaxLine[], state: readonly QualificationStateRow[], summaries: readonly PositionSummary[]): string {
  const h = createHash('sha256')
  const byKey = <T>(items: readonly T[], key: (t: T) => string): T[] => [...items].sort((a, b) => compareId(key(a), key(b)))
  const records = [
    ...lines.map((l) => ['L', l.payeePositionId, l.pass, l.ruleKey, l.origin?.originType ?? null, l.origin?.originId ?? null, l.amountMinor.toString(), l.currency]),
    ...[...taxLines].sort((a, b) => compareId(a.participantId, b.participantId)).map((t) => ['T', t.participantId, t.ruleId, t.taxableMinor.toString(), t.withheldMinor.toString()]),
    ...sortedState(state).map((s) => ['S', s.positionId, canonicalState(s)]),
    ...byKey(summaries, (s) => s.positionId).map((s) => [
      'V', s.positionId, byKey(s.measures, (m) => m.measure).map((m) => [m.measure, m.valueMinor.toString()]), byKey(s.paidAs, (p) => p.ladder).map((p) => [p.ladder, p.rank]),
    ]),
  ]
  records.forEach((r, i) => h.update(i === 0 ? JSON.stringify(r) : `\n${JSON.stringify(r)}`))
  return h.digest('hex')
}

/** Pass 3 runs before pass 4 pays, so a one-time key paid now is added to the payee's state row here (TS-25). */
function committedState(ctx: RunContext, done: Done<'totals'>): QualificationStateRow[] {
  const onceKey = new Map(ctx.input.plan.bonuses.flatMap((b) => (b.kind === 'pay.one_time' ? [[b.key, b.onceKey] as const] : [])))
  const paid = new Map<string, string[]>()
  for (const l of done.rounding) {
    const key = l.origin === null ? onceKey.get(l.ruleKey) : undefined
    if (key !== undefined) paid.set(l.payeePositionId, [...(paid.get(l.payeePositionId) ?? []), key])
  }
  return sortedState(done.qualification.state).map((row) => {
    const keys = paid.get(row.positionId)
    return keys === undefined ? row : { ...row, oneTimeFlags: [...new Set([...row.oneTimeFlags, ...keys])].sort(compareId) }
  })
}

function summaries(ctx: RunContext, done: Done<'totals'>): PositionSummary[] {
  const { plan } = ctx.input
  return ctx.positions.map((p, k) => ({
    positionId: p.positionId,
    measures: plan.measures.map((m) => ({ measure: m.key, valueMinor: done.volumes.byMeasure.get(m.key)![k]! })),
    paidAs: plan.ladders.map((l) => {
      const r = done.qualification.paidAs.get(l.key)![k]!
      return { ladder: l.key, rank: r < 0 ? null : l.ranks[r]!.key }
    }),
  }))
}

const totalsPass: PassFn<'totals'> = (ctx, done) => {
  checkInvariants(ctx, done)
  const state = committedState(ctx, done)
  const volumeSummaries = summaries(ctx, done)
  return { controlTotals: controlTotals(ctx, done), resultHash: resultHash(done.rounding, done.settlement.taxLines, state, volumeSummaries), state, volumeSummaries }
}

// ---------- inputs hash ----------

/** Every property name of RunInput, so the canonical form never depends on an input object's key order. */
const INPUT_FIELDS = [
  'adjustments', 'agg', 'allocation', 'amountMinor', 'args', 'atLeastMinor', 'atUs', 'banked', 'base', 'baseMeasure', 'bonuses', 'buyerEnrolledWithinUs', 'buyerParticipantId',
  'buyerTypeCode', 'byRank', 'calendar', 'calendars', 'canEarn', 'canHoldPositions', 'canSponsor', 'capMinor', 'caps', 'carries', 'carry',
  'categories', 'category', 'childPositionId', 'code', 'compression', 'const', 'constraints', 'contentHash', 'count', 'counters', 'countsAsEndCustomer',
  'creditPositionId', 'creditedAtUs', 'currency', 'customerRollUp', 'den', 'effectiveFromUs', 'eligibleIf', 'endsAtUs', 'enrolledAtUs',
  'equals', 'eventId', 'excludeItemClasses', 'expiresAfterPeriods', 'expr', 'fact', 'facts', 'factor', 'first', 'firstMultiplier', 'from',
  'gracePeriods', 'graceUsed', 'history', 'incrementIf', 'includeSelf', 'itemClass', 'items', 'keepIf', 'key', 'kind', 'knownAtUs',
  'ladder', 'ladders', 'leader', 'leg', 'level', 'levels', 'lineId', 'lines', 'maintenance', 'map', 'market', 'marketId', 'maxMinor',
  'maxPerLegShare', 'maxShare', 'measure', 'measures', 'method', 'minPerCustomerMinor', 'minorDigits', 'n', 'name', 'num', 'of',
  'oneTimeFlags', 'onceKey', 'op', 'orderBy', 'orderEvents', 'orderId', 'orders', 'originId', 'originType', 'originalPeriodId',
  'ownerParticipantId', 'paidAs', 'parentPositionId', 'participantId', 'participantTypes', 'participants', 'parts', 'payeePositionId',
  'perOrderCapMinor', 'perUnitMinor', 'period', 'periodId', 'periods', 'periodsHeld', 'plan', 'planVersionId', 'pointsToCurrency',
  'positionId', 'positions', 'priorState', 'productId', 'purpose', 'quantity', 'rank', 'ranks', 'rate', 'rates', 'reason', 'reasonCode',
  'receivables', 'recordedAtUs', 'reduce', 'refundMinor', 'relationships', 'requires', 'residue', 'restockingFeeAffectsVolume',
  'restockingFeeMinor', 'reversalPolicy', 'roundingMode', 'rounding', 'rule', 'ruleId', 'ruleKey', 'scope', 'second', 'secondShareAbove',
  'settings', 'settingsVersionId', 'share', 'shares', 'snapshot', 'snapshotId', 'source', 'sourceKind', 'startsAtUs', 'state', 'stateItem',
  'status', 'statusFromUs', 'supersededAtUs', 'taxMinor', 'tiers', 'titles', 'to', 'transitions', 'tree', 'type', 'typeCode', 'unit',
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
const WITHHOLDING = rowOf<WithholdingInstruction>()(['participantId', 'rate', 'rounding', 'ruleId'])
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

/** Row arrays carry no meaning in their order (duplicates are refused where a key is looked up): hash them sorted. */
function sortedRows(items: readonly object[], row: Row): string[] {
  return items.map((item) => JSON.stringify(tuple(item, row))).sort(compareId)
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

export const PASSES: PassRegistry = {
  transition: transitionPass, lineVolumes: lineVolumePass, volumes: positionVolumePass, qualification: qualificationPass,
  individual: payoutPass('individual'), matching: payoutPass('matching'), pools: payoutPass('pools'),
  constraints: constraintPass, caps: capPass, adjustments: adjustmentPass, rounding: roundingPass, settlement: settlementPass, totals: totalsPass,
}

export function run(input: RunInput, options: RunOptions = { fullTraceFor: [] }): RunOutput {
  const hash = inputsHash(input) // first: it also refuses missing fields and number-typed *Minor / *Us values
  const ctx = buildContext(input, options)
  const out = runPipeline(ctx, PASSES)
  return {
    engineVersion: ENGINE_VERSION,
    planVersionId: input.plan.planVersionId,
    settingsVersionId: input.settings.settingsVersionId,
    snapshotId: input.snapshot.snapshotId,
    periodId: input.snapshot.period.periodId,
    inputsHash: hash,
    lines: out.rounding,
    payees: out.settlement.payees,
    taxLines: out.settlement.taxLines,
    qualification: out.totals.state,
    evaluations: out.qualification.evaluations,
    volumeSummaries: out.totals.volumeSummaries,
    constraintApplications: out.constraints.applications,
    capApplications: out.caps.applications,
    transitionReport: out.transition.report,
    controlTotals: out.totals.controlTotals,
    warnings: [...out.lineVolumes.warnings, ...out.qualification.warnings, ...out.settlement.warnings],
    resultHash: out.totals.resultHash,
  }
}
