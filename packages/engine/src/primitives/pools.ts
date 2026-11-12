// pay.pool (pass 6): market total of baseMeasure x rate, split by largest remainder in position id order (TS-06).
import { EngineError } from '../errors.js'
import { formatRate, largestRemainder, mulRate, parseDecimal, RATE_SCALE, roundRaw, toRaw } from '../money.js'
import type { BonusOf, Done, PayoutFn, QualificationOutput, RunContext } from '../pipeline.js'
import type { OrderPurpose, PoolAllocation, RawLine, TraceStep } from '../types.js'
import { pointsFactor } from './volume.js'
import { count, laddersOf, measureUnit, measureValues, payeeOf, payoutLines } from './unilevel.js'

/**
 * One split of (part of) the pool: holders by ascending position index with their weights. A holder's raw is
 * totalRaw x num / den x weight / sum(weights): `num / den` is the part's share of the whole pool.
 */
interface Split { readonly key: string; readonly totalMinor: bigint; readonly num: bigint; readonly den: bigint; readonly holders: readonly number[]; readonly weights: readonly bigint[] }

function rankIndexes(ctx: RunContext, q: Pick<QualificationOutput, 'paidAs'>, ladderKey: string, ranks: readonly string[]): { paidAs: Int16Array; index: number[] } {
  const ladder = ctx.input.plan.ladders.find((l) => l.key === ladderKey)
  const paidAs = q.paidAs.get(ladderKey)
  if (ladder === undefined || paidAs === undefined) throw new EngineError('INVALID_INPUT', 'pool references an unknown ladder', { ladder: ladderKey })
  const index = ranks.map((rank, i) => {
    const r = ladder.ranks.findIndex((x) => x.key === rank)
    if (r < 0 || ranks.indexOf(rank) !== i) throw new EngineError('INVALID_INPUT', 'pool names an unknown or repeated rank', { ladder: ladderKey, rank })
    return r
  })
  return { paidAs, index }
}

/**
 * shares: weight = shares of the payee's exact paid-as rank. rank_order: part i of the pool (share_i, the
 * unlisted rest stays with the company) split equally among holders of exactly rank i. first_n: the top n
 * payees by `orderBy` desc (ties position id asc) split equally. A part without holders is not paid (breakage).
 */
function splits(allocation: PoolAllocation, key: string, totalMinor: bigint, payees: readonly number[], ctx: RunContext, q: Pick<QualificationOutput, 'paidAs'>, values: (m: string) => BigInt64Array): Split[] {
  const equal = (holders: readonly number[], minor: bigint, num: bigint, den: bigint, splitKey: string): Split => ({ key: splitKey, totalMinor: minor, num, den, holders, weights: holders.map(() => 1n) })
  switch (allocation.type) {
    case 'shares': {
      const { paidAs, index } = rankIndexes(ctx, q, allocation.ladder, allocation.shares.map((s) => s.rank))
      const weightAt = new Map(index.map((r, i) => [r, BigInt(count(allocation.shares[i]!.shares, 'pool shares'))]))
      const holders = payees.filter((k) => (weightAt.get(paidAs[k]!) ?? 0n) > 0n)
      return [{ key, totalMinor, num: 1n, den: 1n, holders, weights: holders.map((k) => weightAt.get(paidAs[k]!)!) }]
    }
    case 'rank_order': {
      const { paidAs, index } = rankIndexes(ctx, q, allocation.ladder, allocation.parts.map((p) => p.rank))
      const shares = allocation.parts.map((p) => parseDecimal(p.share))
      const rest = RATE_SCALE - shares.reduce((a, s) => a + s, 0n)
      if (rest < 0n) throw new EngineError('INVALID_INPUT', 'pool rank_order shares exceed 1', { rule: key })
      const parts = largestRemainder(totalMinor, [...shares, rest])
      return index.map((r, i) => equal(payees.filter((k) => paidAs[k] === r), parts[i]!, shares[i]!, RATE_SCALE, `${key}/${allocation.parts[i]!.rank}`))
    }
    case 'first_n': {
      const n = count(allocation.n, 'pool first_n n')
      const v = values(allocation.orderBy)
      const top = [...payees].sort((a, b) => (v[a]! > v[b]! ? -1 : v[a]! < v[b]! ? 1 : a - b)).slice(0, n).sort((a, b) => a - b)
      return [equal(top, totalMinor, 1n, 1n, key)]
    }
  }
}

interface Pool { readonly base: bigint; readonly rawTotal: bigint; readonly factor: bigint | null; readonly totalMinor: bigint; readonly splits: readonly Split[] }

/**
 * The pool and its splits. A points pool is converted to currency once, before the split (BR-MNY-05), so its
 * parts sum to the converted total (FR-COMP-012); converting each part would not.
 */
function poolOf(rule: BonusOf<'pay.pool'>, ctx: RunContext, done: Done<'pools'>): Pool {
  const q = done.qualification
  const base = done.volumes.marketTotal.get(rule.baseMeasure)
  if (base === undefined) throw new EngineError('INVALID_INPUT', 'pool references an unknown market measure', { measure: rule.baseMeasure })
  const rawTotal = mulRate(toRaw(base), parseDecimal(rule.rate))
  const factor = measureUnit(ctx.input.plan, rule.baseMeasure) === 'points' ? pointsFactor(ctx.input.plan, ctx.input.snapshot.market.marketId, ctx.evaluation.validAtUs) : null
  const totalMinor = roundRaw(factor === null ? rawTotal : mulRate(rawTotal, factor), ctx.input.settings.roundingMode)
  if (totalMinor <= 0n) return { base, rawTotal, factor, totalMinor, splits: [] }
  const payees = ctx.positions.map((_, k) => k).filter(payeeOf(ctx, q, rule.eligibleIf))
  return { base, rawTotal, factor, totalMinor, splits: splits(rule.allocation, rule.key, totalMinor, payees, ctx, q, (m) => measureValues(done.volumes, m)) }
}

/** Minor amount of pool parts that have no holder: not paid, reported as breakage (pass 12). */
export function unpaidPoolMinor(ctx: RunContext, done: Done<'pools'>): bigint {
  let unpaid = 0n
  for (const rule of ctx.input.plan.bonuses) {
    if (rule.kind !== 'pay.pool') continue
    for (const s of poolOf(rule, ctx, done).splits) if (s.holders.length === 0) unpaid += s.totalMinor
  }
  return unpaid
}

export const pool: PayoutFn<'pay.pool', 'pools'> = (rule, ctx, done) => {
  const q = done.qualification
  const { base, rawTotal, factor, splits: parts } = poolOf(rule, ctx, done)
  const purposeRaw = (c: { readonly raw: bigint }, p: OrderPurpose): bigint => {
    const part = done.volumes.byPurpose.get(p)?.marketTotal.get(rule.baseMeasure)
    if (part === undefined) throw new EngineError('INVARIANT', 'no purpose split for a limited pool', { purpose: p, measure: rule.baseMeasure })
    return base === 0n ? 0n : (c.raw * part) / base
  }
  const ladder = rule.allocation.type === 'first_n' ? null : rule.allocation.ladder
  const out = payoutLines(ctx, rule, q, { pass: 6, unit: 'currency', tree: null, ladders: laddersOf(ladder, rule.eligibleIf?.ladder), purposeRaw })

  const allocated = new Map<number, { readonly split: Split; readonly weight: bigint; readonly minor: bigint }>()
  for (const split of parts) {
    if (split.holders.length === 0) continue
    const sum = split.weights.reduce((a, w) => a + w, 0n)
    const minor = largestRemainder(split.totalMinor, split.weights)
    split.holders.forEach((k, i) => {
      const weight = split.weights[i]!
      allocated.set(k, { split, weight, minor: minor[i]! })
      const share = { num: split.num * weight, den: split.den * sum }
      out.add(k, { k: -1, level: null, measure: rule.baseMeasure, ruleKey: null, base, baseScale: 'minor', rate: rule.rate, share, raw: (rawTotal * share.num) / share.den })
    })
  }
  return out.lines().map((line): RawLine => {
    const { split, weight, minor } = allocated.get(ctx.trees.sponsor.index.get(line.payeePositionId)!)!
    const points: TraceStep[] = factor === null ? [] : [{ step: 'points', factor: formatRate(factor), beforeRaw: line.raw, afterRaw: mulRate(line.raw, factor) }]
    const step: TraceStep = { step: 'allocation', key: split.key, weight, totalMinor: split.totalMinor, afterMinor: minor }
    return { ...line, allocatedMinor: minor, trace: { ...line.trace, steps: [...line.trace.steps, ...points, step] } }
  })
}
