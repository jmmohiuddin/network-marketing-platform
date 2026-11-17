import { z } from 'zod'
import { credited, hints, lineAmount, MappingRefusal, money, refusing, storeId, toMinor, utc, type Mapped, type MappingContext } from './mapping.js'

// WooCommerce webhooks (PLAN B2 2.6): order.created / order.updated by status; partial refunds are deferred (PLAN 8).
const ORDER_TOPICS: ReadonlySet<string> = new Set(['order.created', 'order.updated'])

const order = z.looseObject({
  id: storeId,
  status: z.string(),
  currency: z.string(),
  total: money,
  customer_id: z.number().int(),
  date_created_gmt: z.string(),
  date_paid_gmt: z.string().nullish(),
  date_completed_gmt: z.string().nullish(),
  date_modified_gmt: z.string().nullish(),
  meta_data: z.array(z.looseObject({ key: z.string(), value: z.unknown() })).nullish(),
  coupon_lines: z.array(z.looseObject({ code: z.string() })).nullish(),
  line_items: z.array(z.looseObject({ id: storeId, sku: z.string().nullish(), quantity: z.number().int(), total: money, total_tax: money })),
})
type WooOrder = z.infer<typeof order>

const sourceSystem = (ctx: MappingContext) => `woocommerce:${ctx.connectorId}`

/** Protected order meta _nmp_participant_ref (set in the back office) names an enrolled participant; guests refused. */
function buyer(payload: WooOrder): { external_ref: string; auto_create: boolean } {
  const tagged = payload.meta_data?.find((meta) => meta.key === '_nmp_participant_ref')?.value
  if (typeof tagged === 'string' && tagged !== '') return { external_ref: tagged, auto_create: false }
  if (payload.customer_id <= 0) throw new MappingRefusal('BUYER_MISSING', 'A guest checkout has no buyer to credit.')
  return { external_ref: `woocommerce:${payload.customer_id}`, auto_create: true }
}

function mapOrder(payload: WooOrder, ctx: MappingContext): Mapped {
  const lines = payload.line_items.map((item, index) => {
    if (item.sku == null || item.sku === '') throw new MappingRefusal('SKU_MISSING', 'A line item has no SKU.')
    return { line_no: index + 1, sku: item.sku, quantity: item.quantity, source_line_id: item.id, amount_minor: lineAmount(toMinor(item.total, ctx.minorUnit)) }
  })
  const tax = payload.line_items.reduce((total, item) => total + toMinor(item.total_tax, ctx.minorUnit), 0n)
  const input = {
    source_system: sourceSystem(ctx), source_order_id: payload.id, market: ctx.marketCode, buyer: buyer(payload),
    attribution: hints(undefined, payload.coupon_lines?.[0]?.code), ordered_at: utc(payload.date_created_gmt),
    paid_at: utc(payload.date_paid_gmt), fulfilled_at: utc(payload.date_completed_gmt), currency: payload.currency,
    amount_minor: lines.reduce((total, line) => total + BigInt(line.amount_minor), 0n).toString(), tax_minor: tax.toString(), lines,
  }
  return credited(input, ctx) ? { kind: 'order', input } : { kind: 'ignored' }
}

function mapClosing(payload: WooOrder, ctx: MappingContext, type: 'refund' | 'cancelled'): Mapped {
  // An order that was never credited was never ingested: closing it changes nothing here.
  if (!credited({ paid_at: utc(payload.date_paid_gmt), fulfilled_at: utc(payload.date_completed_gmt) }, ctx)) return { kind: 'ignored' }
  const input = {
    source_system: sourceSystem(ctx), source_event_id: `${type}:${payload.id}`, source_order_id: payload.id, type,
    occurred_at: utc(payload.date_modified_gmt) ?? utc(payload.date_created_gmt), fee_minor: '0',
    // A refunded order returns every remaining line; a cancellation's lines are the remaining ones by default.
    ...(type === 'refund' ? { lines: 'remaining', refund_minor: toMinor(payload.total, ctx.minorUnit).toString() } : { refund_minor: '0' }),
  }
  return { kind: 'event', input }
}

/** null: the payload is not a WooCommerce order (no natural key to persist a refusal under). */
export function mapWooCommerce(topic: string, body: unknown, ctx: MappingContext): Mapped | null {
  if (!ORDER_TOPICS.has(topic)) return { kind: 'ignored' }
  const parsed = order.safeParse(body)
  if (!parsed.success) return null
  const payload = parsed.data
  if (payload.status === 'processing' || payload.status === 'completed') {
    return refusing(`order:${sourceSystem(ctx)}:${payload.id}`, () => mapOrder(payload, ctx))
  }
  if (topic === 'order.updated' && payload.status === 'refunded') {
    return refusing(`event:${sourceSystem(ctx)}:refund:${payload.id}`, () => mapClosing(payload, ctx, 'refund'))
  }
  if (topic === 'order.updated' && payload.status === 'cancelled') {
    return refusing(`event:${sourceSystem(ctx)}:cancelled:${payload.id}`, () => mapClosing(payload, ctx, 'cancelled'))
  }
  return { kind: 'ignored' }
}
