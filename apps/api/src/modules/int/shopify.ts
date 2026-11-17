import { z } from 'zod'
import { credited, hints, lineAmount, MappingRefusal, money, refusing, storeId, toMinor, type Mapped, type MappingContext } from './mapping.js'

// Shopify webhooks (PLAN B2 2.6, C-B2-20): order topics, refunds/create and orders/cancelled; every other topic is ignored.
// orders/edited carries an order_edit, not the order; the edited order also arrives as orders/updated.
const ORDER_TOPICS: ReadonlySet<string> = new Set(['orders/paid', 'orders/fulfilled', 'orders/updated'])
// processed_at is set when the order is created; it is the payment time only once the order is paid (C-B2-19).
const PAID_STATUSES: ReadonlySet<string> = new Set(['paid', 'partially_refunded', 'refunded'])

const order = z.looseObject({
  id: storeId,
  currency: z.string(),
  created_at: z.string(),
  processed_at: z.string().nullish(),
  financial_status: z.string().nullish(),
  cancelled_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  fulfillment_status: z.string().nullish(),
  fulfillments: z.array(z.looseObject({ created_at: z.string() })).nullish(),
  customer: z.looseObject({ id: storeId, tags: z.string().nullish() }).nullish(),
  note_attributes: z.array(z.looseObject({ name: z.string(), value: z.unknown() })).nullish(),
  discount_codes: z.array(z.looseObject({ code: z.string() })).nullish(),
  line_items: z.array(z.looseObject({
    id: storeId,
    sku: z.string().nullish(),
    quantity: z.number().int(),
    price: money,
    discount_allocations: z.array(z.looseObject({ amount: money })).nullish(),
    tax_lines: z.array(z.looseObject({ price: money })).nullish(),
  })),
})
type ShopifyOrder = z.infer<typeof order>

const refund = z.looseObject({
  id: storeId,
  order_id: storeId,
  created_at: z.string(),
  refund_line_items: z.array(z.looseObject({ line_item_id: storeId, quantity: z.number().int(), restock_type: z.string().nullish() })).nullish(),
  transactions: z.array(z.looseObject({ amount: money, kind: z.string(), status: z.string() })).nullish(),
})

const sourceSystem = (ctx: MappingContext) => `shopify:${ctx.connectorId}`

/** Merchant-set customer tag nmp:<external_ref> names an enrolled participant; else the store customer; guests refused. */
function buyer(payload: ShopifyOrder): { external_ref: string; auto_create: boolean } {
  const tagged = (payload.customer?.tags ?? '').split(',').map((tag) => tag.trim()).find((tag) => tag.startsWith('nmp:'))
  if (tagged !== undefined) return { external_ref: tagged.slice('nmp:'.length), auto_create: false }
  if (payload.customer == null) throw new MappingRefusal('BUYER_MISSING', 'A guest checkout has no buyer to credit.')
  return { external_ref: `shopify:${payload.customer.id}`, auto_create: true }
}

function paidAt(payload: ShopifyOrder): string | undefined {
  return PAID_STATUSES.has(payload.financial_status ?? '') ? (payload.processed_at ?? undefined) : undefined
}

function fulfilledAt(payload: ShopifyOrder): string | undefined {
  if (payload.fulfillment_status !== 'fulfilled') return undefined
  return (payload.fulfillments ?? []).map((fulfillment) => fulfillment.created_at).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)
}

function lines(payload: ShopifyOrder, minorUnit: number) {
  return payload.line_items.map((item, index) => {
    if (item.sku == null || item.sku === '') throw new MappingRefusal('SKU_MISSING', 'A line item has no SKU.')
    const discounts = (item.discount_allocations ?? []).reduce((total, allocation) => total + toMinor(allocation.amount, minorUnit), 0n)
    return {
      line_no: index + 1, sku: item.sku, quantity: item.quantity, source_line_id: item.id,
      amount_minor: lineAmount(toMinor(item.price, minorUnit) * BigInt(item.quantity) - discounts),
    }
  })
}

function mapOrder(payload: ShopifyOrder, ctx: MappingContext): Mapped {
  const mapped = lines(payload, ctx.minorUnit)
  const tax = payload.line_items.flatMap((item) => item.tax_lines ?? []).reduce((total, line) => total + toMinor(line.price, ctx.minorUnit), 0n)
  const input = {
    source_system: sourceSystem(ctx), source_order_id: payload.id, market: ctx.marketCode, buyer: buyer(payload),
    attribution: hints(payload.note_attributes?.find((attribute) => attribute.name === 'nmp_ref')?.value, payload.discount_codes?.[0]?.code),
    ordered_at: payload.created_at, paid_at: paidAt(payload), fulfilled_at: fulfilledAt(payload),
    currency: payload.currency, amount_minor: mapped.reduce((total, line) => total + BigInt(line.amount_minor), 0n).toString(),
    tax_minor: tax.toString(), lines: mapped,
  }
  return credited(input, ctx) ? { kind: 'order', input } : { kind: 'ignored' }
}

function mapRefund(payload: z.infer<typeof refund>, ctx: MappingContext): Mapped {
  const items = payload.refund_line_items ?? []
  const refunded = (payload.transactions ?? [])
    .filter((transaction) => transaction.kind === 'refund' && transaction.status === 'success')
    .reduce((total, transaction) => total + toMinor(transaction.amount, ctx.minorUnit), 0n)
  const input = {
    source_system: sourceSystem(ctx), source_event_id: `refund:${payload.id}`, source_order_id: payload.order_id,
    type: items.some((item) => item.restock_type === 'return') ? 'return' : 'refund', occurred_at: payload.created_at,
    refund_minor: refunded.toString(), fee_minor: '0',
    ...(items.length === 0 ? {} : { lines: items.map((item) => ({ source_line_id: item.line_item_id, quantity: item.quantity })) }),
  }
  return { kind: 'event', input }
}

function mapCancelled(payload: ShopifyOrder, ctx: MappingContext): Mapped {
  // An order that was never credited was never ingested: its cancellation changes nothing here.
  if (!credited({ paid_at: paidAt(payload), fulfilled_at: fulfilledAt(payload) }, ctx)) return { kind: 'ignored' }
  const input = {
    source_system: sourceSystem(ctx), source_event_id: `cancel:${payload.id}`, source_order_id: payload.id, type: 'cancelled',
    occurred_at: payload.cancelled_at ?? payload.updated_at ?? payload.created_at, refund_minor: '0', fee_minor: '0',
  }
  return { kind: 'event', input }
}

/** null: the payload is not a Shopify order or refund at all (no natural key to persist a refusal under). */
export function mapShopify(topic: string, body: unknown, ctx: MappingContext): Mapped | null {
  if (ORDER_TOPICS.has(topic) || topic === 'orders/cancelled') {
    const parsed = order.safeParse(body)
    if (!parsed.success) return null
    if (topic === 'orders/cancelled') return refusing(`event:${sourceSystem(ctx)}:cancel:${parsed.data.id}`, () => mapCancelled(parsed.data, ctx))
    return refusing(`order:${sourceSystem(ctx)}:${parsed.data.id}`, () => mapOrder(parsed.data, ctx))
  }
  if (topic === 'refunds/create') {
    const parsed = refund.safeParse(body)
    if (!parsed.success) return null
    return refusing(`event:${sourceSystem(ctx)}:refund:${parsed.data.id}`, () => mapRefund(parsed.data, ctx))
  }
  return { kind: 'ignored' }
}
