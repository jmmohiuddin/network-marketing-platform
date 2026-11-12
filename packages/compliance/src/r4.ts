import type { Context } from './context.js'
import type { Figure, OmittedIndicator, OrderFact, ReportPeriod } from './types.js'

const NOTE = 'Activity here is defined by the plan on own-purchase volume, so every active status depends on own purchases; the indicator that varies is activity without any customer order.'
const ACTIVE_KEYS = ['active_distributors', 'active_with_no_customer_order_pct']
const LATE_KEYS = ['late_threshold_crossing_orders', 'of_which_refunded_later']
const EARNER_POPULATION = 'Participants of an earning type with at least one own order in the month'

interface Crossing { orderRef: string; refunded: boolean }

const omit = (keys: readonly string[], reason: string): OmittedIndicator[] => keys.map((key) => ({ key, reason }))

function activityFigures(ctx: Context, orders: readonly OrderFact[], activePvMinor: bigint): Figure[] {
  const personalVolume = new Map<string, bigint>()
  const servicedCustomerOrders = new Set<string>()
  for (const order of orders) {
    const buyer = ctx.buyer(order)
    if (buyer.canEarn) personalVolume.set(buyer.participantRef, (personalVolume.get(buyer.participantRef) ?? 0n) + order.volumeMinor)
    else if (buyer.countsAsEndCustomer && buyer.servicingRef !== null) servicedCustomerOrders.add(buyer.servicingRef)
  }
  const active = [...personalVolume].filter(([, volume]) => volume >= activePvMinor).map(([ref]) => ref)
  const noCustomer = active.filter((ref) => !servicedCustomerOrders.has(ref))
  return [
    ctx.figure({
      key: 'active_distributors', unit: 'count', value: active.length.toString(), numerator: BigInt(active.length),
      denominator: BigInt(personalVolume.size), population: EARNER_POPULATION,
      method: 'Earning-type participants whose own-order volume in the month is at or above the active threshold setting.',
      entity: 'participant', numeratorIds: active, denominatorIds: [...personalVolume.keys()],
    }),
    ctx.percentFigure({
      key: 'active_with_no_customer_order_pct', numerator: BigInt(noCustomer.length), denominator: BigInt(active.length),
      population: 'Active distributors of the month',
      method: 'Active distributors with no order in the month from an end customer they service, over active distributors.',
      entity: 'participant', numeratorIds: noCustomer, denominatorIds: active,
    }),
  ]
}

const dayOf = (order: OrderFact): number => order.orderDay ?? 0

function findCrossings(ctx: Context, orders: readonly OrderFact[], lateOrderDay: number, thresholds: readonly bigint[]): Crossing[] {
  // Day order, then order reference: the order fact carries no source row sequence, so file order within a day
  // cannot be reproduced; the reference makes the result independent of the order the facts were supplied in.
  const sorted = orders.filter((o) => ctx.buyer(o).canEarn)
    .sort((a, b) => dayOf(a) - dayOf(b) || (a.orderRef < b.orderRef ? -1 : 1))
  const running = new Map<string, bigint>()
  const crossings: Crossing[] = []
  for (const order of sorted) {
    const before = running.get(order.buyerRef) ?? 0n
    const after = before + order.volumeMinor
    running.set(order.buyerRef, after)
    if (dayOf(order) < lateOrderDay) continue
    for (const threshold of thresholds) {
      if (before < threshold && threshold <= after) crossings.push({ orderRef: order.orderRef, refunded: order.refundedMinor > 0n })
    }
  }
  return crossings
}

function lateFigures(ctx: Context, lateOrders: number, crossings: readonly Crossing[]): Figure[] {
  const population = 'Own orders of earning-type participants placed on or after the late-order day of the month'
  const refunded = crossings.filter((c) => c.refunded)
  const refs = (list: readonly Crossing[]): string[] => list.map((c) => c.orderRef)
  return [
    ctx.figure({
      key: 'late_threshold_crossing_orders', unit: 'count', value: crossings.length.toString(), numerator: BigInt(crossings.length),
      population, populationCount: lateOrders,
      method: 'Personal volume accumulated per participant in day order, orders of the same day in ascending order reference; a late order counts once for each rank threshold it lifts the running volume to or past.',
      entity: 'order', numeratorIds: refs(crossings),
    }),
    ctx.figure({
      key: 'of_which_refunded_later', unit: 'count', value: refunded.length.toString(), numerator: BigInt(refunded.length),
      // BUG-019: the denominator counts crossings (an order once per threshold it crosses), so the population does too.
      denominator: BigInt(crossings.length), population: 'Late threshold crossings of the month (an order counts once for each threshold it crosses)',
      populationCount: crossings.length,
      method: 'Crossings whose order has any refunded amount, in any refund month.',
      entity: 'order', numeratorIds: refs(refunded), denominatorIds: refs(crossings),
    }),
  ]
}

function lateOmissionReason(ctx: Context, orders: readonly OrderFact[]): string | null {
  const { lateOrderDay, rankThresholdsPvMinor } = ctx.config
  if (lateOrderDay === undefined) return 'The late-order day setting is not set for this tenant; it has no default.'
  if (rankThresholdsPvMinor === undefined || Object.keys(rankThresholdsPvMinor).length === 0) {
    return 'No rank volume thresholds are set for this tenant; they have no default.'
  }
  const missingDay = orders.filter((o) => o.orderDay === null).length
  return missingDay > 0 ? `${missingDay} order(s) in the month have no order day, so late orders cannot be identified.` : null
}

/** R4: activity from own purchases and end-of-period threshold orders, per order month. */
export function computeR4(ctx: Context, month: string): ReportPeriod {
  const orders = ctx.ordersByMonth.get(month) ?? []
  const { activePvMinor, lateOrderDay, rankThresholdsPvMinor } = ctx.config
  const lateReason = lateOmissionReason(ctx, orders)
  const late = lateReason === null && lateOrderDay !== undefined && rankThresholdsPvMinor !== undefined
    ? lateFigures(
      ctx,
      orders.filter((o) => ctx.buyer(o).canEarn && dayOf(o) >= lateOrderDay).length,
      findCrossings(ctx, orders, lateOrderDay, Object.values(rankThresholdsPvMinor)),
    )
    : []
  return {
    report: 'R4', period: month, periodKind: 'month', partial: false, notes: [NOTE],
    omitted: [
      ...(activePvMinor === undefined ? omit(ACTIVE_KEYS, 'The active volume threshold setting is not set for this tenant; it has no default.') : []),
      ...(lateReason === null ? [] : omit(LATE_KEYS, lateReason)),
    ],
    figures: [...(activePvMinor === undefined ? [] : activityFigures(ctx, orders, activePvMinor)), ...late],
  }
}
