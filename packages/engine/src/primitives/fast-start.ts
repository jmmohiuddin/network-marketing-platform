// pay.fast_start: per order of a new enrollee, tier t pays min(rate x order measure, per-order cap) (TS-12).
import { EngineError } from '../errors.js'
import { mulRate, parseDecimal, toRaw } from '../money.js'
import type { PayoutFn } from '../pipeline.js'
import type { Order } from '../types.js'
import { laddersOf, measureUnit, payeeOf, payoutLines } from './unilevel.js'

/**
 * An order qualifies when it is credited inside [buyer enrolledAt, enrolledAt + buyerEnrolledWithinUs).
 * Its value is the rule's line measure summed over the order's credited lines (after this period's events).
 * Tier 0 is the parent of the order's credit position, tier t its t-th ancestor; an ancestor that is not a
 * payee consumes its tier. Orders are visited by order id; each order is one trace source citing it.
 */
export const fastStart: PayoutFn<'pay.fast_start'> = (rule, ctx, done) => {
  const q = done.qualification
  const tree = ctx.trees[rule.tree]
  const payee = payeeOf(ctx, q, rule.eligibleIf)
  const tiers = rule.tiers.map((t) => ({ rate: parseDecimal(t.rate), capMinor: t.perOrderCapMinor, text: t.rate }))
  const mi = done.lineVolumes.measureKeys.indexOf(rule.measure)
  if (mi < 0) throw new EngineError('INVALID_INPUT', 'fast start needs a line measure', { measure: rule.measure })
  const orders = new Map<string, Order>(ctx.input.snapshot.orders.map((o) => [o.orderId, o]))

  const value = new Map<string, bigint>() // order id -> measure; insertion follows the lines' order id order
  for (const line of done.lineVolumes.lines) value.set(line.orderId, (value.get(line.orderId) ?? 0n) + line.values[mi]!)

  const purposeRaw = (c: { readonly raw: bigint; readonly orders?: readonly { readonly orderId: string }[] }, p: string): bigint => (orders.get(c.orders![0]!.orderId)!.purpose === p ? c.raw : 0n)
  const out = payoutLines(ctx, rule, q, { pass: 4, unit: measureUnit(ctx.input.plan, rule.measure), tree: rule.tree, ladders: laddersOf(rule.eligibleIf?.ladder), purposeRaw })
  for (const [orderId, v] of value) {
    const order = orders.get(orderId)
    if (order === undefined) throw new EngineError('INVALID_INPUT', 'credited line names an unknown order', { orderId })
    if (v <= 0n || order.creditPositionId === null) continue
    const buyer = ctx.participants.get(order.buyerParticipantId)
    if (buyer === undefined) throw new EngineError('INVALID_INPUT', 'order names an unknown buyer', { orderId, participantId: order.buyerParticipantId })
    if (order.creditedAtUs < buyer.enrolledAtUs || order.creditedAtUs >= buyer.enrolledAtUs + rule.buyerEnrolledWithinUs) continue
    const k = tree.index.get(order.creditPositionId)
    if (k === undefined) throw new EngineError('INVALID_INPUT', 'order credits an unknown position', { orderId, positionId: order.creditPositionId })
    let a = tree.parent[k]!
    for (let t = 0; t < tiers.length && a >= 0; t++, a = tree.parent[a]!) {
      if (!payee(a)) continue
      const tier = tiers[t]!
      const uncapped = mulRate(toRaw(v), tier.rate)
      const raw = uncapped < toRaw(tier.capMinor) ? uncapped : toRaw(tier.capMinor)
      out.add(a, { k, level: t + 1, measure: rule.measure, ruleKey: null, base: v, baseScale: 'minor', rate: tier.text, capMinor: tier.capMinor, raw, orders: [{ orderId, raw }] })
    }
  }
  return out.lines()
}
