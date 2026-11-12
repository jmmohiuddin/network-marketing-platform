// pay.percent_of_measure: rate[paid-as rank] x the payee's own measure, e.g. GV (ENGINE_GENEALOGY §5.5, G-E2E-01, TS-10).
import { formatRate, mulRate, toRaw } from '../money.js'
import type { PayoutFn } from '../pipeline.js'
import { rateByRank } from './differential.js'
import { laddersOf, measurePurpose, measureUnit, measureValues, orderAttribution, payeeOf, payoutLines } from './unilevel.js'

/** Rate = highest rank listed in byRank at or below the paid-as rank (same reading as pay.differential). */
export const percentOfMeasure: PayoutFn<'pay.percent_of_measure'> = (rule, ctx, done) => {
  const q = done.qualification
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rateOf = rateByRank(ctx, q, rule.byRank)
  const measure = measureValues(done.volumes, rule.measure)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit: measureUnit(ctx.input.plan, rule.measure), tree: null, ladders: laddersOf(rule.byRank.ladder, rule.eligibleIf?.ladder), purposeRaw: measurePurpose(done.volumes, rule.measure) })
  for (let k = 0; k < measure.length; k++) {
    const m = measure[k]!
    const rate = m === 0n || !payee(k) ? 0n : rateOf(k)
    if (rate !== 0n) out.add(k, { k, level: 0, measure: rule.measure, ruleKey: null, base: m, baseScale: 'minor', rate: formatRate(rate), raw: mulRate(toRaw(m), rate) })
  }
  return out.lines({ orders: orderAttribution(ctx, rule, done.lineVolumes, rule.measure) })
}
