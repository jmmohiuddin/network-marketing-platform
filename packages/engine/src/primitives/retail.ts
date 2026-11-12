// pay.retail_margin: rate x the position's own customer-order measure (ENGINE_GENEALOGY §5.5, G-E2E-01, TS-22).
import { mulRate, parseDecimal, toRaw } from '../money.js'
import type { PayoutFn } from '../pipeline.js'
import { laddersOf, measurePurpose, measureUnit, measureValues, orderAttribution, payeeOf, payoutLines } from './unilevel.js'

/** The measure is the serviced customers' order value credited to the payee (a volume.personal with orders 'customer'). */
export const retailMargin: PayoutFn<'pay.retail_margin'> = (rule, ctx, done) => {
  const q = done.qualification
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const rate = parseDecimal(rule.rate)
  const measure = measureValues(done.volumes, rule.measure)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit: measureUnit(ctx.input.plan, rule.measure), tree: null, ladders: laddersOf(rule.eligibleIf?.ladder), purposeRaw: measurePurpose(done.volumes, rule.measure) })
  for (let k = 0; k < measure.length; k++) {
    const m = measure[k]!
    if (m !== 0n && payee(k)) out.add(k, { k, level: 0, measure: rule.measure, ruleKey: null, base: m, baseScale: 'minor', rate: rule.rate, raw: mulRate(toRaw(m), rate) })
  }
  return out.lines({ orders: orderAttribution(ctx, rule, done.lineVolumes, rule.measure) })
}
