// pay.generations: leader generations with dynamic compression (non-leaders never consume a generation).
import { mulRate, parseDecimal, toRaw } from '../money.js'
import { holdsRank, type PayoutFn } from '../pipeline.js'
import { nearestAncestor, rollUp } from '../tree.js'
import type { OrderPurpose } from '../types.js'
import { laddersOf, measureValues, orderAttribution, payeeOf, payoutLines, purposeValues, walkedMeasureUnit } from './unilevel.js'

/**
 * A leader's generation volume = own measure + the measure of its downline down to (excluding) the next
 * leaders. The payee earns rates[g-1] x generation volume of each leader g leaders below it. A leader that is
 * not a payee (not an earner, or failing eligibleIf) still consumes its generation. Generation volume is an
 * aggregate: under order_line its sources cite their orders in full traces only.
 */
export const generations: PayoutFn<'pay.generations'> = (rule, ctx, done) => {
  const q = done.qualification
  const tree = ctx.trees[rule.tree]
  const leader = holdsRank(ctx, q, rule.leader)
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rates = rule.rates.map(parseDecimal)
  const passUp = (child: number): boolean => !leader(child)
  const generationVolume = rollUp(tree, measureValues(done.volumes, rule.measure), passUp)
  const byPurpose = new Map<OrderPurpose, BigInt64Array>()
  const purposeVolume = (p: OrderPurpose): BigInt64Array => byPurpose.get(p) ?? byPurpose.set(p, rollUp(tree, purposeValues(done.volumes, p, rule.measure), passUp)).get(p)!
  const up = nearestAncestor(tree, leader)
  const unit = walkedMeasureUnit(ctx.input.plan, rule, rule.measure)
  const out = payoutLines(ctx, rule, q, {
    pass: 4, unit, tree: rule.tree, ladders: laddersOf(rule.leader.ladder, rule.eligibleIf?.ladder),
    purposeRaw: (c, p) => (c.raw * purposeVolume(p)[c.k]!) / c.base,
  })

  for (let k = 0; k < tree.ids.length; k++) {
    const v = generationVolume[k]!
    if (v === 0n || !leader(k)) continue
    let a = up[k]!
    for (let g = 1; g <= rates.length && a >= 0; g++, a = up[a]!) {
      if (!payee(a)) continue
      out.add(a, { k, level: g, measure: rule.measure, ruleKey: null, base: v, baseScale: 'minor', rate: rule.rates[g - 1]!, raw: mulRate(toRaw(v), rates[g - 1]!) })
    }
  }
  // A line credited at j is in the generation volume of j, and of each parent while the position below is no leader.
  const targets = (j: number, visit: (k: number) => void): void => {
    visit(j)
    for (let c = j; tree.parent[c]! >= 0 && passUp(c); c = tree.parent[c]!) visit(tree.parent[c]!)
  }
  return out.lines({ orders: orderAttribution(ctx, rule, done.lineVolumes, rule.measure, targets) })
}
