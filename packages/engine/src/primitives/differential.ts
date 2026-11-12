// pay.differential (stairstep): the payee earns its rank rate minus the rate already earned below it (TS-43).
import { EngineError } from '../errors.js'
import { formatRate, mulRate, parseDecimal, toRaw } from '../money.js'
import type { PayoutFn, QualificationOutput, RunContext } from '../pipeline.js'
import { nearestAncestor } from '../tree.js'
import type { RankRates } from '../types.js'
import { laddersOf, measurePurpose, measureValues, orderAttribution, payeeOf, payoutLines, walkedMeasureUnit } from './unilevel.js'

/**
 * Rate by paid-as rank (pay.differential, pay.percent_of_measure): the rate of the highest rank listed in byRank
 * at or below the position's paid-as rank; 0 when none.
 */
export function rateByRank(ctx: RunContext, q: Pick<QualificationOutput, 'paidAs'>, byRank: RankRates): (k: number) => bigint {
  const ladder = ctx.input.plan.ladders.find((l) => l.key === byRank.ladder)
  const ranks = q.paidAs.get(byRank.ladder)
  if (ladder === undefined || ranks === undefined) throw new EngineError('INVALID_INPUT', 'rate by rank references an unknown ladder', { ladder: byRank.ladder })
  const listed = ladder.ranks.map((): bigint | undefined => undefined)
  for (const { rank, rate } of byRank.rates) {
    const r = ladder.ranks.findIndex((x) => x.key === rank)
    if (r < 0 || listed[r] !== undefined) throw new EngineError('INVALID_INPUT', 'rate by rank names an unknown or repeated rank', { ladder: ladder.key, rank })
    listed[r] = parseDecimal(rate)
  }
  const rateAtRank: bigint[] = []
  listed.forEach((rate, r) => rateAtRank.push(rate ?? (r > 0 ? rateAtRank[r - 1]! : 0n)))
  return (k) => (ranks[k]! >= 0 ? rateAtRank[ranks[k]!]! : 0n)
}

/**
 * Rate of a position = rate of the highest rank listed in byRank at or below its paid-as rank (0 when none).
 * For each source position with a non-zero measure, walking up: every payee whose rate exceeds the rate
 * already paid below earns (its rate - paid) x measure, then paid = its rate. The source's own rate counts
 * as paid when the source is a payee (its own volume is paid by another rule, e.g. percent_of_measure).
 * Positions that are not payees earn nothing and raise nothing. O(N x distinct rates) via nearestAncestor.
 * The measure is volume.personal: on a group measure (TS-43 "group volume") the walk would count the downline twice.
 */
export const differential: PayoutFn<'pay.differential'> = (rule, ctx, done) => {
  const q = done.qualification
  const tree = ctx.trees[rule.tree]
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rankRate = rateByRank(ctx, q, rule.byRank)
  const rateOf = (k: number): bigint => (payee(k) ? rankRate(k) : 0n)

  const nextAbove = new Map<bigint, Int32Array>() // paid rate -> nearest ancestor paying more
  const above = (paid: bigint): Int32Array => {
    let up = nextAbove.get(paid)
    if (up === undefined) {
      up = nearestAncestor(tree, (a) => rateOf(a) > paid)
      nextAbove.set(paid, up)
    }
    return up
  }

  const measure = measureValues(done.volumes, rule.measure)
  const unit = walkedMeasureUnit(ctx.input.plan, rule, rule.measure)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit, tree: rule.tree, ladders: laddersOf(rule.byRank.ladder, rule.eligibleIf?.ladder), purposeRaw: measurePurpose(done.volumes, rule.measure) })
  for (let k = 0; k < tree.ids.length; k++) {
    const m = measure[k]!
    if (m === 0n) continue
    let paid = rateOf(k)
    for (let a = above(paid)[k]!; a >= 0; a = above(paid)[a]!) {
      const gap = rateOf(a) - paid
      out.add(a, { k, level: tree.depth[k]! - tree.depth[a]!, measure: rule.measure, ruleKey: null, base: m, baseScale: 'minor', rate: formatRate(gap), raw: mulRate(toRaw(m), gap) })
      paid += gap
    }
  }
  return out.lines({ orders: orderAttribution(ctx, rule, done.lineVolumes, rule.measure) })
}
