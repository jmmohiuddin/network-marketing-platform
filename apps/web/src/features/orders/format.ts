// Words and exact number formatting of SC-31 / SC-32. Never Number arithmetic on money or volume.
import { decimal, integer } from '../data/format'
import { PROVIDER_NAMES } from '../integrations/format'
import type { CommerceProvider } from '../integrations/types'
import type { AttributionSource, Handling, LateState, Purpose, Volumes } from './types'

/** "-12345" with 2 decimals -> "-123.45": exact string arithmetic on minor units. */
export function minorToDecimal(minor: string, minorUnit: number): string {
  const negative = minor.startsWith('-')
  const digits = (negative ? minor.slice(1) : minor).replace(/^\+/, '').padStart(minorUnit + 1, '0')
  const whole = digits.slice(0, digits.length - minorUnit)
  const fraction = minorUnit === 0 ? '' : `.${digits.slice(-minorUnit)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** "1,234.50 EUR" with the market's minor unit; minor units as such while the minor unit is unknown. */
export function moneyText(minor: string, currency: string, minorUnit: number | undefined): string {
  return minorUnit === undefined ? `${integer(minor)} ${currency} minor units` : `${decimal(minorToDecimal(minor, minorUnit))} ${currency}`
}

const CONNECTOR_SOURCE = /^(shopify|woocommerce):([0-9a-f-]{36})$/

/**
 * An order's source system in words (BUG-076): a storefront connector's orders ("shopify:<connector id>") by the
 * connector's name, else by the provider when the name is not readable; any other source system as sent.
 */
export function sourceText(sourceSystem: string, connectorNames: ReadonlyMap<string, string>): string {
  const match = CONNECTOR_SOURCE.exec(sourceSystem)
  if (match === null) return sourceSystem
  return connectorNames.get(match[2]!) ?? `${PROVIDER_NAMES[match[1] as CommerceProvider]} connector`
}

/** "140 pv · 120 cv" (volume minor units per measure, sorted by measure); "—" for none. */
export function volumesText(volumes: Volumes | undefined): string {
  const entries = Object.entries(volumes ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return entries.length === 0 ? '—' : entries.map(([measure, value]) => `${integer(value)} ${measure}`).join(' · ')
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

/** Why an order or event write was refused (PLAN B2 API-10, API-11, C-B2-20), in words; unknown codes show as they are. */
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
  VALIDATION_FAILED: 'The order or event is not valid',
}

/** A refusal code in words (BUG-075). */
export function refusalText(code: string | undefined): string {
  return code === undefined ? 'Refused' : REFUSAL_LABELS[code] ?? code
}

export const HANDLING_LABELS: Readonly<Record<Handling, string>> = { adjust: 'Adjust in an open period', restatement: 'Restatement' }

export const LATE_STATE_LABELS: Readonly<Record<LateState, string>> = { pending: 'Pending', decided: 'Decided', consumed: 'Used by a run' }

export const ITEM_CLASSES = ['product', 'starter_kit', 'service', 'shipping', 'fee'] as const

export const ITEM_CLASS_LABELS: Readonly<Record<string, string>> = {
  product: 'Product', starter_kit: 'Starter kit', service: 'Service', shipping: 'Shipping', fee: 'Fee',
}

/** A measure name the API accepts (D-B2-17). */
export const MEASURE = /^[a-z][a-z0-9_]{0,31}$/
/** A non-negative bigint decimal string, as the API's minorString accepts. */
export const MINOR = /^(0|[1-9]\d{0,18})$/
