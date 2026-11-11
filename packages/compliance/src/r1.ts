import type { Context } from './context.js'
import { sum } from './stats.js'
import type { OrderFact, ReportPeriod } from './types.js'

const POPULATION = 'All orders placed in the month'
const NET_METHOD = 'Net sales = amount minus refunded amount per order; refunds are netted into the month of the order.'

const net = (order: OrderFact): bigint => order.amountMinor - order.refundedMinor
const netOf = (orders: readonly OrderFact[]): bigint => sum(orders.map(net))
const refs = (orders: readonly OrderFact[]): string[] => orders.map((o) => o.orderRef)

/** R1: sales to non-participant customers, per order month. */
export function computeR1(ctx: Context, month: string): ReportPeriod {
  const orders = ctx.ordersByMonth.get(month) ?? []
  const isEndCustomer = (o: OrderFact): boolean => ctx.buyer(o).countsAsEndCustomer
  const customer = orders.filter(isEndCustomer)
  const customerOrResale = orders.filter((o) => isEndCustomer(o) || o.purpose === 'resale')
  const kits = orders.filter((o) => o.isStarterKit)
  const participantOrders = orders.filter((o) => !isEndCustomer(o) && !o.isStarterKit)
  const unknown = participantOrders.filter((o) => o.purpose === 'unknown')
  const total = netOf(orders)
  const share = (key: string, numerator: readonly OrderFact[], method: string) =>
    ctx.percentFigure({
      key, numerator: netOf(numerator), denominator: total, population: POPULATION, method: `${method} ${NET_METHOD}`,
      entity: 'order', numeratorIds: refs(numerator), denominatorIds: refs(orders),
    })
  return {
    report: 'R1', period: month, periodKind: 'month', partial: false, omitted: [], notes: [],
    figures: [
      ctx.figure({
        key: 'net_sales_cents', unit: 'minor', value: total.toString(), numerator: total, population: POPULATION,
        method: NET_METHOD, entity: 'order', numeratorIds: refs(orders),
      }),
      share('customer_share_pct', customer, 'Net sales of orders whose buyer type counts as an end customer, over net sales. Classified by buyer type, not by declared purpose.'),
      share('customer_plus_declared_resale_pct', customerOrResale, 'End-customer net sales plus net sales of participant orders declared as resale, over net sales.'),
      share('starter_kit_share_pct', kits, 'Net sales of starter-kit orders from any buyer, over net sales.'),
      ctx.percentFigure({
        key: 'participant_orders_purpose_unknown_pct',
        numerator: BigInt(unknown.length), denominator: BigInt(participantOrders.length),
        population: 'Orders in the month from buyers whose type does not count as an end customer, excluding starter kits',
        method: 'Count of those orders with purpose unknown, over their count (orders, not amounts).',
        entity: 'order', numeratorIds: refs(unknown), denominatorIds: refs(participantOrders),
      }),
    ],
  }
}
