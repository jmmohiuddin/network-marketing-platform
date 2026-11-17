// Words and exact number formatting of SC-31 / SC-32. Never Number arithmetic on money or volume.
import { decimal, integer } from '../data/format'
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
