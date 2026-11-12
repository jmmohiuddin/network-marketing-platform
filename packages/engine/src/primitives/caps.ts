// Passes 7 and 8 (BR-CAP-01..03, ENGINE_GENEALOGY §5.5): per-participant constraints, then company caps in
// plan order. A bound limit fixes whole minor amounts with largestRemainder (BR-MNY-03): canonical order is
// payee position index, then bonus plan order. Removed amounts are breakage (C10): no line receives them.
// A limit binds when the lines, each rounded once as pass 10 would, sum to more than it: deciding on the raw
// sum would let per-line rounding pay up to n/2 minor units over the limit.

import { EngineError } from '../errors.js'
import { largestRemainder, mulRate, parseDecimal, RATE_SCALE, roundRaw, toRaw, type RoundingMode } from '../money.js'
import type { PassFn, PositionVolumes, RunContext } from '../pipeline.js'
import { compareId } from '../tree.js'
import type { CapApplication, CapBase, CapRule, ConstraintApplication, ParticipantConstraint, RawLine, TraceStep } from '../types.js'

/** A line's current amount as raw: its allocated minor amount once an allocation fixed it. */
export function lineValue(line: RawLine): bigint {
  return line.allocatedMinor === null ? line.raw : toRaw(line.allocatedMinor)
}

/** Sum of the values each rounded once (what pass 10 would pay without the limit). */
function roundedSum(values: readonly bigint[], mode: RoundingMode): bigint {
  return values.reduce((a, v) => a + roundRaw(v, mode), 0n)
}

/**
 * Company cap allocation (TS-07, TS-08). `values` = in-scope lines (raw) in canonical order, `group[i]` = the
 * line's bonus, `priority` = groups to reduce first, in order. Returns minor amounts summing exactly to
 * capMinor, or null when the cap does not bind (the rounded lines fit). Priority: listed groups lose whole, or
 * the last one in part; any excess left is then taken proportionally from every line (G-E2E-01).
 */
export function allocateCap(capMinor: bigint, values: readonly bigint[], group: readonly number[], priority: readonly number[], mode: RoundingMode): bigint[] | null {
  if (roundedSum(values, mode) <= capMinor) return null
  const proposed = values.reduce((a, v) => a + v, 0n)
  const groupSum = new Map<number, bigint>()
  values.forEach((v, i) => groupSum.set(group[i]!, (groupSum.get(group[i]!) ?? 0n) + v))
  // Each reduced group keeps num/den of its amount; at most one has den != 1, so weights stay exact.
  const keep = new Map<number, { num: bigint; den: bigint }>()
  let excess = proposed - toRaw(capMinor)
  let den = 1n
  for (const g of priority) {
    const sum = groupSum.get(g) ?? 0n
    if (excess <= 0n || sum === 0n || keep.has(g)) continue
    const cut = excess < sum ? excess : sum
    keep.set(g, { num: sum - cut, den: sum })
    if (cut < sum) den = sum
    excess -= cut
  }
  const weights = values.map((v, i) => {
    const k = keep.get(group[i]!)
    if (!k) return v * den
    return k.num === 0n ? 0n : (v * k.num * den) / k.den
  })
  return largestRemainder(capMinor, weights)
}

/** TS-09 base: firstMultiplier x first when second/(first+second) > ratio, else first + second (raw). */
export function orderStructureBaseRaw(base: Extract<CapBase, { kind: 'order_structure' }>, firstMinor: bigint, secondMinor: bigint): bigint {
  const num = BigInt(base.secondShareAbove.num)
  const den = BigInt(base.secondShareAbove.den)
  if (den <= 0n || num < 0n) throw new EngineError('INVALID_INPUT', 'secondShareAbove needs num >= 0 and den > 0')
  const sum = firstMinor + secondMinor
  return secondMinor * den > num * sum ? mulRate(toRaw(firstMinor), parseDecimal(base.firstMultiplier)) : toRaw(sum)
}

/** Cap amount = roundRaw(base x rate). */
export function capAmountMinor(baseRaw: bigint, rate: string, mode: RoundingMode): bigint {
  return roundRaw(mulRate(baseRaw, parseDecimal(rate)), mode)
}

// ---------- shared helpers ----------

interface Scoped { readonly index: number; readonly position: number; readonly rule: number }

function positionOf(ctx: RunContext, id: string): number {
  const k = ctx.trees.sponsor.index.get(id)
  if (k === undefined) throw new EngineError('INVALID_INPUT', 'line payee is not a snapshot position', { positionId: id })
  return k
}

/** In-scope line indexes in canonical order (position index, then bonus plan order). */
function scoped(ctx: RunContext, lines: readonly RawLine[], scope: readonly string[], what: string): Scoped[] {
  const order = new Map(ctx.input.plan.bonuses.map((b, i) => [b.key, i]))
  for (const key of scope) if (!order.has(key)) throw new EngineError('INVALID_INPUT', `${what} scope names an unknown bonus`, { key })
  const inScope = new Set(scope)
  const out: Scoped[] = []
  lines.forEach((l, index) => {
    if (!inScope.has(l.ruleKey) || l.kind === 'adjustment') return
    if (l.unit !== 'currency') throw new EngineError('INVALID_INPUT', `${what} applies to currency lines only`, { ruleKey: l.ruleKey })
    out.push({ index, position: positionOf(ctx, l.payeePositionId), rule: order.get(l.ruleKey)! })
  })
  return out.sort((a, b) => a.position - b.position || a.rule - b.rule)
}

function withStep(line: RawLine, step: TraceStep, change: Partial<Pick<RawLine, 'raw' | 'allocatedMinor'>>): RawLine {
  return { ...line, ...change, trace: { ...line.trace, steps: [...line.trace.steps, step] } }
}

function byParticipant(ctx: RunContext, items: readonly Scoped[]): [string, Scoped[]][] {
  const groups = new Map<string, Scoped[]>()
  for (const s of items) {
    const p = ctx.ownerOf[s.position]!
    groups.set(p, [...(groups.get(p) ?? []), s])
  }
  return [...groups].sort((a, b) => compareId(a[0], b[0]))
}

// ---------- pass 7 ----------

/** Part of the line's pass 4-6 raw paid on orders of the constraint's purpose (RawLine.purposeRaw, never truncated). */
function purposePart(line: RawLine, c: Extract<ParticipantConstraint, { kind: 'limit.max_share_from_purpose' }>): bigint {
  const part = line.purposeRaw.find((p) => p.purpose === c.purpose)
  if (part === undefined) throw new EngineError('INVARIANT', 'in-scope line carries no purpose split', { key: c.key, ruleKey: line.ruleKey, positionId: line.payeePositionId })
  return part.raw
}

/**
 * New whole-minor values for one participant's lines, or null when the constraint does not bind. max_share keeps
 * the non-purpose pay and the largest purpose pay P' with P' <= share x (other + P'); the kept total is rounded
 * once (roundRaw) and split by largestRemainder.
 */
function limitParticipant(c: ParticipantConstraint, lines: readonly RawLine[], values: readonly bigint[], mode: RoundingMode): bigint[] | null {
  if (c.kind === 'limit.max_per_period') return roundedSum(values, mode) > c.maxMinor ? largestRemainder(c.maxMinor, values) : null
  const total = values.reduce((a, v) => a + v, 0n)
  const share = parseDecimal(c.maxShare)
  if (share >= RATE_SCALE) return null
  // Purpose part of each line, scaled to its current value when an earlier limit changed it.
  const part = lines.map((l, i) => (l.trace.raw === 0n ? 0n : (purposePart(l, c) * values[i]!) / l.trace.raw))
  const purposeRaw = part.reduce((a, v) => a + v, 0n)
  if (purposeRaw * RATE_SCALE <= share * total) return null
  const allowed = ((total - purposeRaw) * share) / (RATE_SCALE - share)
  const keep = values.map((v, i) => v - part[i]! + (purposeRaw === 0n ? 0n : (part[i]! * allowed) / purposeRaw))
  return largestRemainder(roundRaw(keep.reduce((a, v) => a + v, 0n), mode), keep)
}

function applyConstraint(ctx: RunContext, c: ParticipantConstraint, lines: readonly RawLine[]): { lines: RawLine[]; applications: ConstraintApplication[] } {
  const out = [...lines]
  const applications: ConstraintApplication[] = []
  for (const [participantId, items] of byParticipant(ctx, scoped(ctx, lines, c.scope, c.key))) {
    const mine = items.map((s) => lines[s.index]!)
    const values = mine.map(lineValue)
    const after = limitParticipant(c, mine, values, ctx.input.settings.roundingMode)
    if (after === null) continue
    items.forEach((s, i) => {
      const afterRaw = toRaw(after[i]!)
      out[s.index] = withStep(mine[i]!, { step: 'constraint', key: c.key, beforeRaw: values[i]!, afterRaw }, { raw: afterRaw, allocatedMinor: null })
    })
    applications.push({ key: c.key, participantId, beforeRaw: values.reduce((a, v) => a + v, 0n), afterRaw: toRaw(after.reduce((a, v) => a + v, 0n)) })
  }
  return { lines: out, applications }
}

/** Pass 7: per-participant limits in plan order, over every pass 4-6 line (BR-CAP-02: before company caps). */
export const constraintPass: PassFn<'constraints'> = (ctx, done) => {
  let lines: readonly RawLine[] = [...done.individual, ...done.matching, ...done.pools]
  const applications: ConstraintApplication[] = []
  for (const c of ctx.input.plan.constraints) {
    const r = applyConstraint(ctx, c, lines)
    lines = r.lines
    applications.push(...r.applications)
  }
  return { lines, applications }
}

// ---------- pass 8 ----------

function marketTotal(volumes: PositionVolumes, measure: string): bigint {
  const v = volumes.marketTotal.get(measure)
  if (v === undefined) throw new EngineError('INVALID_INPUT', 'cap base must be a volume.personal measure', { measure })
  return v
}

function baseRaw(base: CapBase, volumes: PositionVolumes): bigint {
  return base.kind === 'measure' ? toRaw(marketTotal(volumes, base.measure)) : orderStructureBaseRaw(base, marketTotal(volumes, base.first), marketTotal(volumes, base.second))
}

type Affected = CapApplication['affected'][number]
interface CapScope { readonly cap: CapRule; readonly priority: readonly number[]; readonly mode: RoundingMode }

/** Allocates one block of in-scope lines into `out`; changed lines are recorded in `affected` (BR-CAP-03). */
function capBlock(c: CapScope, capMinor: bigint, items: readonly Scoped[], lines: readonly RawLine[], out: RawLine[], affected: Affected[]): { proposed: bigint; bound: boolean } {
  const { cap, priority, mode } = c
  const values = items.map((s) => lineValue(lines[s.index]!))
  const alloc = allocateCap(capMinor, values, items.map((s) => s.rule), priority, mode)
  const proposed = values.reduce((a, v) => a + v, 0n)
  if (alloc === null) return { proposed, bound: false }
  items.forEach((s, i) => {
    const line = lines[s.index]!
    out[s.index] = withStep(line, { step: 'cap', key: cap.key, method: cap.method.type, beforeRaw: values[i]!, afterMinor: alloc[i]! }, { allocatedMinor: alloc[i]! })
    if (roundRaw(values[i]!, mode) !== alloc[i]!) affected.push({ payeePositionId: line.payeePositionId, ruleKey: line.ruleKey, beforeRaw: values[i]!, afterMinor: alloc[i]! })
  })
  return { proposed, bound: true }
}

function applyCap(ctx: RunContext, cap: CapRule, lines: readonly RawLine[], volumes: PositionVolumes): { lines: RawLine[]; application: CapApplication } {
  const mode = ctx.input.settings.roundingMode
  const order = new Map(ctx.input.plan.bonuses.map((b, i) => [b.key, i]))
  const reduce = cap.method.type === 'priority' ? cap.method.reduce : []
  for (const key of reduce) {
    if (!cap.scope.includes(key)) throw new EngineError('INVALID_INPUT', 'priority list names a bonus outside the cap scope', { cap: cap.key, key })
  }
  const items = scoped(ctx, lines, cap.scope, cap.key)
  const c: CapScope = { cap, priority: reduce.map((k) => order.get(k)!), mode }
  const out = [...lines]
  const affected: Affected[] = []
  if (cap.method.type !== 'per_person') {
    const base = baseRaw(cap.base, volumes)
    const capMinor = capAmountMinor(base, cap.rate, mode)
    const { proposed, bound } = capBlock(c, capMinor, items, lines, out, affected)
    return { lines: out, application: { capKey: cap.key, method: cap.method.type, baseMinor: roundRaw(base, mode), capMinor, proposedRaw: proposed, bound, affected } }
  }
  if (cap.base.kind !== 'measure') throw new EngineError('INVALID_INPUT', 'per_person caps need a measure base', { cap: cap.key })
  const own = volumes.byMeasure.get(cap.base.measure)
  if (!own) throw new EngineError('INVALID_INPUT', 'cap base names an unknown measure', { measure: cap.base.measure })
  let baseMinor = 0n, capMinor = 0n, proposedRaw = 0n, bound = false
  for (let i = 0; i < items.length; ) {
    let j = i
    while (j < items.length && items[j]!.position === items[i]!.position) j++
    const base = own[items[i]!.position]!
    const personCap = capAmountMinor(toRaw(base), cap.rate, mode)
    const r = capBlock(c, personCap, items.slice(i, j), lines, out, affected)
    baseMinor += base
    capMinor += personCap
    proposedRaw += r.proposed
    bound ||= r.bound
    i = j
  }
  return { lines: out, application: { capKey: cap.key, method: 'per_person', baseMinor, capMinor, proposedRaw, bound, affected } }
}

/** Pass 8: company caps in plan order (array order = stated precedence). */
export const capPass: PassFn<'caps'> = (ctx, done) => {
  let lines: readonly RawLine[] = done.constraints.lines
  const applications: CapApplication[] = []
  for (const cap of ctx.input.plan.caps) {
    const r = applyCap(ctx, cap, lines, done.volumes)
    lines = r.lines
    applications.push(r.application)
  }
  return { lines, applications }
}
