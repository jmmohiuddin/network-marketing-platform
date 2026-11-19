// Money and decimal arithmetic. bigint only: binary floating point is prohibited (BR-MNY-01, TS-67).
//
// Precision rule (the one place it is stated):
// - Amounts and volumes are bigint MINOR units.
// - Decimal plan parameters (rates, shares, factors) have at most RATE_DECIMALS places and are held as
//   bigint parts per RATE_SCALE (parseDecimal).
// - Unrounded amounts ("raw") are bigint minor x RAW_SCALE. mulRate is exact for up to two rate
//   applications on a minor amount (e.g. matching on a unilevel line); deeper chains truncate toward
//   zero at 10^-12 of a minor unit.
// - Rounding happens ONCE per payout line, in pass 10, through roundRaw. Modes: 'half_up' (BR-MNY-02 platform
//   default): ties away from zero, so -0.005 -> -0.01; 'half_even': ties to the even minor unit, so 0.125 -> 0.12,
//   0.135 -> 0.14, -0.125 -> -0.12 (FR-COMP-012, applied to the magnitude like half_up).
// - Splits, pools and scaled caps use largestRemainder (BR-MNY-03). A bound limit (cap, max_per_period,
//   max_share_from_purpose) first fixes one whole total (the cap; roundRaw of the kept raw for max_share), then
//   splits it. Ties: largestRemainder index order = payee position id ascending (MONEY I-11).
import { EngineError } from './errors.js'

export const RATE_DECIMALS = 6
export const RATE_SCALE = 10n ** 6n
export const RAW_DECIMALS = 12
export const RAW_SCALE = 10n ** 12n

/** Rounding modes the engine implements. A tenant setting naming any other mode fails to type-check. */
export type RoundingMode = 'half_up' | 'half_even'

const INT64_MAX = (1n << 63n) - 1n
const INT64_MIN = -(1n << 63n)
const DECIMAL = /^(\d+)(?:\.(\d+))?$/

/** "0.08" -> 80000n (parts per RATE_SCALE). Non-negative, at most RATE_DECIMALS places, exact. */
export function parseDecimal(text: string): bigint {
  const m = DECIMAL.exec(text)
  const fraction = m?.[2] ?? ''
  if (!m || fraction.length > RATE_DECIMALS) {
    throw new EngineError('INVALID_INPUT', `decimal must be non-negative with at most ${RATE_DECIMALS} places`, { value: text })
  }
  return BigInt(m[1]!) * RATE_SCALE + BigInt(fraction.padEnd(RATE_DECIMALS, '0'))
}

/** Parts per RATE_SCALE -> canonical decimal text (60000n -> "0.06"), for traces of derived rates. */
export function formatRate(rate: bigint): string {
  const fraction = (rate % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0').replace(/0+$/, '')
  const whole = (rate / RATE_SCALE).toString()
  return fraction === '' ? whole : `${whole}.${fraction}`
}

/** Decimal text of `units` scaled by 10^digits, e.g. (12345n, 2) -> "123.45", (-5n, 2) -> "-0.05"; trim drops trailing zeros. */
export function formatUnits(units: bigint, digits: number, trim = false): string {
  const negative = units < 0n
  const magnitude = (negative ? -units : units).toString().padStart(digits + 1, '0')
  const whole = magnitude.slice(0, magnitude.length - digits)
  let fraction = magnitude.slice(magnitude.length - digits)
  if (trim) fraction = fraction.replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/** Minor units -> raw. */
export function toRaw(minor: bigint): bigint {
  return minor * RAW_SCALE
}

/** raw x rate (parts per RATE_SCALE), truncated toward zero; see the precision rule above. */
export function mulRate(raw: bigint, rate: bigint): bigint {
  return (raw * rate) / RATE_SCALE
}

/** The single rounding function: raw -> minor units under `mode`. */
export function roundRaw(raw: bigint, mode: RoundingMode): bigint {
  const magnitude = raw < 0n ? -raw : raw
  let rounded: bigint
  switch (mode) {
    case 'half_up':
      rounded = (magnitude * 2n + RAW_SCALE) / (RAW_SCALE * 2n)
      break
    case 'half_even': {
      const floor = magnitude / RAW_SCALE
      const twice = (magnitude % RAW_SCALE) * 2n
      rounded = twice > RAW_SCALE || (twice === RAW_SCALE && floor % 2n === 1n) ? floor + 1n : floor
      break
    }
  }
  return raw < 0n ? -rounded : rounded
}

/**
 * Splits `totalMinor` by `weights` so the parts sum exactly to the total (BR-MNY-03, FR-COMP-012).
 * Floors first, then one minor unit each to the largest remainders; ties by index ascending, so callers
 * pass weights in canonical order (payee position id ascending, ENGINE_GENEALOGY C8).
 */
export function largestRemainder(totalMinor: bigint, weights: readonly bigint[]): bigint[] {
  if (totalMinor < 0n) throw new EngineError('INVALID_INPUT', 'largestRemainder total must be >= 0')
  let sum = 0n
  for (const w of weights) {
    if (w < 0n) throw new EngineError('INVALID_INPUT', 'largestRemainder weights must be >= 0')
    sum += w
  }
  if (sum === 0n) {
    if (totalMinor !== 0n) throw new EngineError('INVALID_INPUT', 'cannot split a non-zero total over zero weights')
    return weights.map(() => 0n)
  }
  const parts = weights.map((w) => (totalMinor * w) / sum)
  const remainders = weights.map((w) => (totalMinor * w) % sum)
  const order = weights.map((_, i) => i).sort((a, b) => (remainders[a]! > remainders[b]! ? -1 : remainders[a]! < remainders[b]! ? 1 : a - b))
  let left = totalMinor - parts.reduce((acc, p) => acc + p, 0n)
  for (let j = 0; left > 0n; j++, left--) parts[order[j]!]! += 1n
  return parts
}

/** Fails the run when a value cannot be stored as amount_minor bigint (FR-COMP-012). */
export function assertInt64(value: bigint, what: string): bigint {
  if (value > INT64_MAX || value < INT64_MIN) throw new EngineError('OVERFLOW', `${what} exceeds the signed 64-bit range`, { value: value.toString() })
  return value
}
