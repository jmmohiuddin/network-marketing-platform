// pay.override: one rate on the measure of every position up to `levels` below the payee (TS-43).
import { mulRate, parseDecimal, toRaw } from '../money.js'
import type { PayoutFn } from '../pipeline.js'
import { count, laddersOf, measurePurpose, measureValues, orderAttribution, payeeOf, payoutLines, walkedMeasureUnit } from './unilevel.js'

/** No compression: a position that is not a payee consumes its level (TS-43: 3% x 6,000.00 = 180.00). */
export const override: PayoutFn<'pay.override'> = (rule, ctx, done) => {
  const q = done.qualification
  const tree = ctx.trees[rule.tree]
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rate = parseDecimal(rule.rate)
  const levels = count(rule.levels, 'override levels')
  const measure = measureValues(done.volumes, rule.measure)
  const unit = walkedMeasureUnit(ctx.input.plan, rule, rule.measure)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit, tree: rule.tree, ladders: laddersOf(rule.eligibleIf?.ladder), purposeRaw: measurePurpose(done.volumes, rule.measure) })

  for (let k = 0; k < tree.ids.length; k++) {
    const m = measure[k]!
    if (m === 0n) continue
    let a = tree.parent[k]!
    for (let level = 1; level <= levels && a >= 0; level++, a = tree.parent[a]!) {
      if (payee(a)) out.add(a, { k, level, measure: rule.measure, ruleKey: null, base: m, baseScale: 'minor', rate: rule.rate, raw: mulRate(toRaw(m), rate) })
    }
  }
  return out.lines({ orders: orderAttribution(ctx, rule, done.lineVolumes, rule.measure) })
}
