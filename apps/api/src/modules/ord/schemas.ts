import { z } from 'zod'

// API-10 / API-11 bodies (PLAN B2 2.6). Money and volumes are decimal strings of integer minor units, never numbers.
// OI-7: at most 18 digits, so every value fits a bigint (the database checks volumes the same way).
export const minorString = z.string().regex(/^(0|[1-9]\d{0,17})$/, 'must be a decimal string of minor units (at most 18 digits)')
export const signedMinorString = z.string().regex(/^-?(0|[1-9]\d{0,17})$/, 'must be a signed decimal string of at most 18 digits')
export const volumesSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), signedMinorString)
const instant = z.iso.datetime({ offset: true })
const text100 = z.string().min(1).max(100)
const sourceSystem = z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,63}$/, 'must be lower-case letters, digits and _.:-')
/** API callers may not write into a store connector's namespace (connector source systems are shopify:/woocommerce:<id>). */
const apiSourceSystem = sourceSystem.refine((value) => !/^(shopify|woocommerce):/.test(value), 'shopify: and woocommerce: name store connectors')
const sku = z.string().regex(/^[\x21-\x7e]{1,64}$/, 'must be 1-64 printable characters')
const quantity = z.number().int().min(1).max(1_000_000)
const lineNo = z.number().int().min(1).max(100_000)
export const positionRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
const externalRef = z.string().regex(/^[\x21-\x7e]{1,100}$/)
const attributionHint = z.strictObject({ kind: z.enum(['link', 'code']), position_ref: positionRef })

const orderShape = {
  source_system: sourceSystem,
  source_order_id: text100,
  market: z.string().min(1).max(16).describe('Market code, e.g. GB'),
  purpose: z.enum(['resale', 'personal']).optional(),
  ordered_at: instant,
  paid_at: instant.optional(),
  fulfilled_at: instant.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount_minor: minorString,
  tax_minor: minorString,
  lines: z.array(z.strictObject({ line_no: lineNo, sku, quantity, amount_minor: minorString, source_line_id: text100.optional() }))
    .min(1).max(500),
  /** D-V1A-05: the subscription this order renews (a successful renewal is an ordinary order). */
  subscription_ref: text100.optional(),
}

/** POST /v1/orders body: one attribution hint. */
export const orderBody = z.strictObject({
  ...orderShape, source_system: apiSourceSystem, buyer: z.strictObject({ external_ref: externalRef }), attribution: attributionHint.optional(),
})

/**
 * The normalised order every source is ingested as (stored on a held inbound event): API bodies and connector payloads.
 * auto_create: an unknown buyer becomes a customer of orders.new_buyer_type (false for a merchant-tagged participant).
 */
export const orderInput = z.strictObject({
  ...orderShape, buyer: z.strictObject({ external_ref: externalRef, auto_create: z.boolean() }),
  // Every hint the source carries (a store order can carry a link and a code); orders.attribution_precedence picks one.
  attribution: z.array(attributionHint).min(1).max(2).refine((hints) => new Set(hints.map((hint) => hint.kind)).size === hints.length, 'one hint per kind')
    .optional(),
})
export type OrderInput = z.infer<typeof orderInput>

const EVENT_TYPES = [
  'refund', 'return', 'exchange', 'chargeback', 'chargeback_reversed', 'cancelled', 'renewal_failed', 'subscription_cancelled', 'dispute_lost',
] as const
/** D-V1A-05: events recorded for the order timeline only: no lines, no amounts, no volume, pay or late effect. */
export const NO_EFFECT_TYPES: readonly string[] = ['renewal_failed', 'subscription_cancelled', 'dispute_lost']
/** The events that name a subscription instead of an order. */
const SUBSCRIPTION_TYPES: readonly string[] = ['renewal_failed', 'subscription_cancelled']
const eventShape = {
  source_system: sourceSystem,
  source_event_id: text100,
  source_order_id: text100.optional(),
  subscription_ref: text100.optional(),
  type: z.enum(EVENT_TYPES),
  occurred_at: instant,
  refund_minor: minorString,
  fee_minor: minorString,
  equal_value: z.boolean().optional(),
  reverses_source_event_id: text100.optional(),
  disputes_source_event_id: text100.optional(),
}
type EventShape = {
  type: string; equal_value?: boolean | undefined; reverses_source_event_id?: string | undefined; lines?: unknown
  source_order_id?: string | undefined; subscription_ref?: string | undefined; disputes_source_event_id?: string | undefined
}

const uniqueLines = (lines: readonly { line_no?: number; source_line_id?: string }[]) =>
  new Set(lines.map((line) => line.line_no ?? line.source_line_id)).size === lines.length

function eventRules<S extends z.ZodType<EventShape>>(schema: S): S {
  return schema
    .refine((body) => body.equal_value !== true || body.type === 'exchange', { message: 'equal_value applies to exchanges only', path: ['equal_value'] })
    .refine((body) => (body.type === 'chargeback_reversed') === (body.reverses_source_event_id !== undefined), {
      message: 'reverses_source_event_id names the chargeback a chargeback_reversed event reverses (and only then)', path: ['reverses_source_event_id'],
    })
    .refine((body) => body.type !== 'chargeback_reversed' || body.lines === undefined, {
      message: 'a chargeback reversal re-credits the lines of its chargeback', path: ['lines'],
    })
    .refine((body) => (body.source_order_id === undefined) !== (body.subscription_ref === undefined), {
      message: 'name exactly one of source_order_id and subscription_ref', path: ['source_order_id'],
    })
    .refine((body) => body.subscription_ref === undefined || SUBSCRIPTION_TYPES.includes(body.type), {
      message: 'subscription_ref names the subscription of renewal_failed and subscription_cancelled events only', path: ['subscription_ref'],
    })
    .refine((body) => (body.type === 'dispute_lost') === (body.disputes_source_event_id !== undefined), {
      message: 'disputes_source_event_id names the chargeback a dispute_lost event closes (and only then)', path: ['disputes_source_event_id'],
    }) as unknown as S
}

const eventLine = z.strictObject({ line_no: lineNo, quantity })

/** POST /v1/order-events body. */
export const eventBody = eventRules(z.strictObject({
  ...eventShape,
  source_system: apiSourceSystem,
  lines: z.array(eventLine).min(1).max(500).refine(uniqueLines, 'each line once').optional(),
}))

/** The normalised event: connector lines name the store's line id; 'remaining' = every quantity not yet returned. */
export const eventInput = eventRules(z.strictObject({
  ...eventShape,
  lines: z.union([
    z.array(z.union([eventLine, z.strictObject({ source_line_id: text100, quantity })])).min(1).max(500).refine(uniqueLines, 'each line once'),
    z.literal('remaining'),
  ]).optional(),
}))
export type EventInput = z.infer<typeof eventInput>

/** inbound_event.hold_reason values (0802). */
export const HOLD_REASONS = ['UNKNOWN_SKU', 'ORDER_NOT_FOUND', 'SUBSCRIPTION_NOT_FOUND', 'FX_RATE_MISSING', 'FX_RATE_STALE'] as const
export type HoldReason = (typeof HOLD_REASONS)[number]

const id = z.guid()
const orderLineView = z.object({
  line_no: z.number(), sku: z.string(), item_class: z.string(), quantity: z.number(), amount_minor: z.string(),
  original_amount_minor: z.string().nullable(), volumes: volumesSchema, source_line_id: z.string().nullable(),
})
const orderView = z.object({
  id, source_system: z.string(), source_order_id: z.string(), market: z.object({ id, code: z.string() }),
  buyer: z.object({ id, external_ref: z.string() }), buyer_type: z.object({ code: z.string() }),
  purpose: z.enum(['resale', 'personal', 'unspecified', 'customer']), purpose_missing: z.boolean(),
  attributed_position: z.object({ id, position_ref: z.string() }).nullable(),
  attribution_source: z.enum(['link', 'code', 'servicing', 'buyer']).nullable(), attribution_conflict: z.boolean(),
  ordered_at: z.string(), credited_at: z.string(), period_id: id.nullable(), amount_minor: z.string(), tax_minor: z.string(),
  currency: z.string(), volumes: volumesSchema, lines: z.array(orderLineView), subscription_ref: z.string().nullable(),
  original: z.object({
    currency: z.string(), amount_minor: z.string(), tax_minor: z.string(), rate: z.string(), rate_valid_from: z.string(), rate_id: id,
  }).nullable(),
})
const eventView = z.object({
  id, order_id: id, source_system: z.string(), source_event_id: z.string(), type: z.string(), occurred_at: z.string(),
  lines: z.array(z.object({ line_no: z.number(), quantity: z.number() })), refund_minor: z.string(), fee_minor: z.string(),
  equal_value: z.boolean(), volume_effect: z.object({ lines: z.array(z.object({ line_no: z.number(), volumes: volumesSchema })).optional(), total: volumesSchema.optional() }),
  period_id: id.nullable(), late: z.boolean(),
  original: z.object({ refund_minor: z.string(), fee_minor: z.string(), currency: z.string() }).nullable(),
})
const lateItem = z.object({ id, original_period_id: id })

/** Request and response schemas of the key routes, for the OpenAPI document (int/openapi.ts). */
export const publicOrderSchemas = {
  orderBody,
  eventBody,
  orderCreated: z.object({ data: z.object({ order: orderView, late: z.boolean(), late_transactions: z.array(lateItem) }), meta: z.object({}) }),
  orderReplayed: z.object({ data: z.object({ order: orderView, replayed: z.literal(true) }), meta: z.object({}) }),
  eventCreated: z.object({ data: z.object({ event: eventView, late: z.boolean() }), meta: z.object({}) }),
  eventReplayed: z.object({ data: z.object({ event: eventView, replayed: z.literal(true) }), meta: z.object({}) }),
  held: z.object({
    data: z.object({ held: z.object({ inbound_event_id: id, reason: z.enum(HOLD_REASONS), skus: z.array(z.string()).optional() }) }),
    meta: z.object({}),
  }),
}
