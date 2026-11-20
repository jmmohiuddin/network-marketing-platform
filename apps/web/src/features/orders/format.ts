// Words and exact number formatting of SC-31 / SC-32. Never Number arithmetic on money or volume.
import { minorToDecimal } from '../../lib/format'
import { decimal, integer } from '../data/format'
import { PROVIDER_NAMES } from '../integrations/format'
import type { CommerceProvider } from '../integrations/types'
import type { AttributionSource, Handling, LateState, Purpose, Volumes } from './types'

// Lives in lib/format so the portal bundle does not pull the staff format modules in (BUG-132).
export { minorToDecimal }

/** "1,234.50 EUR" with the market's minor unit; minor units as such while the minor unit is unknown. */
export function moneyText(minor: string, currency: string, minorUnit: number | undefined): string {
  return minorUnit === undefined ? `${integer(minor)} ${currency} minor units` : `${decimal(minorToDecimal(minor, minorUnit))} ${currency}`
}

const CONNECTOR_SOURCE = /^(shopify|woocommerce|connector):([0-9a-f-]{36})$/

/**
 * An order's source system or an inbound event's source in words (BUG-076, BUG-082): a storefront connector
 * ("shopify:<id>" on orders, "connector:<id>" on inbound events) by the connector's name, else by the provider when
 * the name is not readable; any other source as sent.
 */
export function sourceText(sourceSystem: string, connectorNames: ReadonlyMap<string, string>): string {
  const match = CONNECTOR_SOURCE.exec(sourceSystem)
  if (match === null) return sourceSystem
  const provider = match[1] === 'connector' ? 'Storefront' : PROVIDER_NAMES[match[1] as CommerceProvider]
  return connectorNames.get(match[2]!) ?? `${provider} connector`
}

/**
 * "1.40 pv · 120.00 cv" per measure, sorted by measure; "—" for none. Volumes are minor units on the market's currency
 * scale (a percentage of a volume is money in minor units), so they show the market's decimals (BUG-090); whole minor
 * units while the market's minor unit is unknown.
 */
export function volumesText(volumes: Volumes | undefined, minorUnit: number | undefined): string {
  const entries = Object.entries(volumes ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const value = (minor: string) => (minorUnit === undefined ? integer(minor) : decimal(minorToDecimal(minor, minorUnit)))
  return entries.length === 0 ? '—' : entries.map(([measure, minor]) => `${value(minor)} ${measure}`).join(' · ')
}

export const PURPOSE_LABELS: Readonly<Record<Purpose, string>> = {
  resale: 'Resale', personal: 'Personal use', unspecified: 'Not given', customer: 'Customer purchase',
}

export const ATTRIBUTION_LABELS: Readonly<Record<AttributionSource, string>> = {
  link: 'Referral link', code: 'Referral code', servicing: 'Servicing distributor', buyer: "Buyer's own position",
}

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  refund: 'Refund', return: 'Return', exchange: 'Exchange', chargeback: 'Chargeback', chargeback_reversed: 'Chargeback reversed',
  cancelled: 'Cancelled', renewal_failed: 'Renewal failed',
}

export const HOLD_LABELS: Readonly<Record<string, string>> = {
  UNKNOWN_SKU: 'Unknown SKU (no volumes yet)', ORDER_NOT_FOUND: 'Order not received yet',
}

/**
 * Why an order or event write was refused (PLAN B2 API-10, API-11, C-B2-20, and the storefront mapping codes of
 * api/modules/int, BUG-081), in words; unknown codes show as they are.
 */
const REFUSAL_LABELS: Readonly<Record<string, string>> = {
  ORDER_CONFLICT: 'Already received with a different body (corrections arrive as order events)',
  EVENT_CONFLICT: 'Event already received with a different body',
  MARKET_NOT_LIVE: 'The market is not live yet',
  CURRENCY_MISMATCH: 'The currency is not the market currency',
  TOTALS_MISMATCH: 'The order amount is not the sum of its lines',
  LINE_NUMBERS_INVALID: 'A line number appears more than once',
  TIMESTAMP_IN_FUTURE: 'A timestamp lies in the future',
  BUYER_NOT_FOUND: 'No participant has the buyer reference',
  BUYER_TYPE_INVALID: 'The type set for new buyers is not an active end-customer type',
  BUYER_TYPE_MISSING: 'The buyer had no participant type at the crediting time',
  PURPOSE_INVALID: 'An end customer’s order cannot carry a resale or personal purpose',
  ATTRIBUTION_NOT_CONFIGURED: 'Attribution precedence is not set',
  CREDITING_EVENT_NOT_CONFIGURED: 'The crediting event is not set',
  CREDITING_EVENT_MISSING: 'The order does not carry the time of the crediting event yet',
  RETURN_EXCEEDS_PURCHASED: 'The event returns more than was purchased',
  LINE_UNKNOWN: 'The event names a line the order does not have',
  LINES_REQUIRED: 'A return or exchange must name its lines',
  EVENT_TYPE_NOT_SUPPORTED: 'This event type is not supported',
  EVENT_NOT_FOUND: 'The chargeback the event reverses was not received',
  CHARGEBACK_ALREADY_REVERSED: 'The chargeback was already reversed',
  RESTOCKING_FEE_EFFECT_NOT_CONFIGURED: 'The restocking-fee volume effect is not set',
  VOLUME_OUT_OF_RANGE: 'A volume is too large to store',
  PAYLOAD_INVALID: 'The storefront sent a body that is not an order or refund',
  BUYER_MISSING: 'A guest checkout has no buyer to credit',
  SKU_MISSING: 'A line item has no SKU',
  AMOUNT_INVALID: 'A line amount after discounts is negative',
  AMOUNT_PRECISION: 'An amount has more decimals than the market currency',
  VALIDATION_FAILED: 'The order or event is not valid',
}

/** A refusal code in words (BUG-075). */
export function refusalText(code: string | undefined): string {
  return code === undefined ? 'Refused' : REFUSAL_LABELS[code] ?? code
}

export const HANDLING_LABELS: Readonly<Record<Handling, string>> = { adjust: 'Adjust in an open period', restatement: 'Restatement' }

export const LATE_STATE_LABELS: Readonly<Record<LateState, string>> = { pending: 'Pending', decided: 'Decided', consumed: 'Consumed' }

export const ITEM_CLASSES = ['product', 'starter_kit', 'service', 'shipping', 'fee'] as const

export const ITEM_CLASS_LABELS: Readonly<Record<string, string>> = {
  product: 'Product', starter_kit: 'Starter kit', service: 'Service', shipping: 'Shipping', fee: 'Fee',
}

/** A measure name the API accepts (D-B2-17). */
export const MEASURE = /^[a-z][a-z0-9_]{0,31}$/
/** A non-negative bigint decimal string, as the API's minorString accepts. */
export const MINOR = /^(0|[1-9]\d{0,18})$/
