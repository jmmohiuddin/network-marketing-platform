import type { Ratio } from './types.js'

const PERCENT_DENOMINATOR = 100

export function sortedAscending(values: readonly bigint[]): bigint[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Percentile with linear interpolation between closest ranks: k = (n - 1) * p / 100,
 * value = v[floor k] + (v[floor k + 1] - v[floor k]) * frac(k). Exact; index arithmetic is integer only.
 * `percentile` is a whole number 0..100; 50 gives the median (mean of the middle two when n is even).
 */
export function interpolatedPercentile(sorted: readonly bigint[], percentile: number): Ratio | null {
  const last = sorted.length - 1
  if (last < 0) return null
  const scaledRank = last * percentile
  const remainder = scaledRank % PERCENT_DENOMINATOR
  const lowerIndex = (scaledRank - remainder) / PERCENT_DENOMINATOR
  const lower = sorted[lowerIndex]
  const upper = sorted[Math.min(lowerIndex + 1, last)]
  if (lower === undefined || upper === undefined) throw new RangeError(`percentile ${percentile} is outside 0..100`)
  const denominator = BigInt(PERCENT_DENOMINATOR)
  return { numerator: lower * denominator + (upper - lower) * BigInt(remainder), denominator }
}

export function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n)
}
