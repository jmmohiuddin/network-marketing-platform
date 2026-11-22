import type { Tx } from '@nmp/db'
import { getSetting, minorUnitOf } from '../ten/index.js'
import { Refusal } from './refusal.js'

// D-V1A-04: an order in another currency than its market's is converted once, at acceptance, with the approved rate in
// force at ordered_at; its events' refunds and fees at the order's rate. Rates are tenant data only: never fetched.

/** D-V1A-10: rates carry exactly 10 fractional digits (numeric(20,10)). */
export const FX_RATE_SCALE = 10
const RATE_UNIT = 10n ** BigInt(FX_RATE_SCALE)
const DAY_MS = 86_400_000

export type RoundingMode = 'half_up' | 'half_even'

/** The rate an amount is converted with, and how. */
export interface Conversion {
  readonly rateId: string
  /** The 10-dp decimal string as stored. */
  readonly rate: string
  readonly baseDigits: number
  readonly quoteDigits: number
  readonly mode: RoundingMode
}

export type FxHold = { readonly held: 'FX_RATE_MISSING' | 'FX_RATE_STALE'; readonly ref: string }

/**
 * amount (base minor units) × rate × 10^(quote digits − base digits), exact integer arithmetic on the 10-dp rate,
 * rounded once on the magnitude by `mode` (amounts here are never negative).
 */
export function convertMinor(amount: bigint, c: Pick<Conversion, 'rate' | 'baseDigits' | 'quoteDigits' | 'mode'>): bigint {
  const [whole = '', fraction = ''] = c.rate.split('.')
  const shift = c.quoteDigits - c.baseDigits
  const num = amount * BigInt(whole + fraction.padEnd(FX_RATE_SCALE, '0')) * 10n ** BigInt(Math.max(shift, 0))
  const den = RATE_UNIT * 10n ** BigInt(Math.max(-shift, 0))
  const floor = num / den
  const twice = (num % den) * 2n
  return twice > den || (twice === den && (c.mode === 'half_up' || floor % 2n === 1n)) ? floor + 1n : floor
}

/** The ISO 4217 minor unit of a currency, or 422 CURRENCY_UNKNOWN. */
export function digitsOf(currency: string): number {
  const digits = minorUnitOf(currency)
  if (digits === undefined) throw new Refusal(422, 'CURRENCY_UNKNOWN', 'The currency is not an active ISO 4217 currency.', { currency })
  return digits
}

/** money.rounding_mode, needed by every conversion (unset: 422 SETTING_NOT_CONFIGURED). */
export async function roundingMode(tx: Tx): Promise<RoundingMode> {
  const mode = await getSetting(tx, 'money.rounding_mode')
  if (mode === null) {
    throw new Refusal(422, 'SETTING_NOT_CONFIGURED', 'Set money.rounding_mode before sending orders in another currency.', { key: 'money.rounding_mode' })
  }
  return mode
}

/**
 * The conversion of an order in `base` into its market's `quote` currency at `at`: the latest approved rate with
 * valid_from ≤ at, held FX_RATE_MISSING without one and FX_RATE_STALE when it is older than fx.max_rate_age_days.
 */
export async function conversionAt(tx: Tx, base: string, quote: string, at: string): Promise<Conversion | FxHold> {
  const baseDigits = digitsOf(base)
  const maxAgeDays = await getSetting(tx, 'fx.max_rate_age_days')
  if (maxAgeDays === null) {
    throw new Refusal(422, 'FX_POLICY_NOT_CONFIGURED', 'Set fx.max_rate_age_days before sending orders in another currency.', { key: 'fx.max_rate_age_days' })
  }
  const mode = await roundingMode(tx)
  const { rows } = await tx.query<{ id: string; rate: string; valid_from: Date }>(
    'SELECT id, rate::text AS rate, valid_from FROM fx_rate_at($1, $2, $3)', [base, quote, at],
  )
  const ref = `${base}:${quote}`
  const rate = rows[0]
  if (rate === undefined) return { held: 'FX_RATE_MISSING', ref }
  if (Date.parse(at) - rate.valid_from.getTime() > maxAgeDays * DAY_MS) return { held: 'FX_RATE_STALE', ref }
  return { rateId: rate.id, rate: rate.rate, baseDigits, quoteDigits: digitsOf(quote), mode }
}
