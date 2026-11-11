import type { Ratio } from './types.js'

/**
 * numerator / denominator rounded half up (ties away from zero, as Decimal ROUND_HALF_UP)
 * to `decimals` places, as a decimal string. Null when the denominator is zero.
 */
export function roundedRatio(numerator: bigint, denominator: bigint, decimals: number): string | null {
  if (denominator === 0n) return null
  const negative = numerator < 0n !== denominator < 0n
  const absNumerator = numerator < 0n ? -numerator : numerator
  const absDenominator = denominator < 0n ? -denominator : denominator
  const scale = 10n ** BigInt(decimals)
  const scaled = (2n * absNumerator * scale + absDenominator) / (2n * absDenominator)
  const whole = (scaled / scale).toString()
  const fraction = decimals > 0 ? `.${(scaled % scale).toString().padStart(decimals, '0')}` : ''
  return `${negative && scaled !== 0n ? '-' : ''}${whole}${fraction}`
}

const PERCENT_DECIMALS = 2

/** Percentage of numerator in denominator, e.g. "62.50". Null when the denominator is zero. */
export function percent(numerator: bigint, denominator: bigint): string | null {
  return roundedRatio(numerator * 100n, denominator, PERCENT_DECIMALS)
}

export function formatRatio(ratio: Ratio, decimals: number): string | null {
  return roundedRatio(ratio.numerator, ratio.denominator, decimals)
}
