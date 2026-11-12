// Money arithmetic for the spike engine: bigint only, no binary float (BR-MNY-01, TS-67).
// Raw (unrounded) amounts carry RATE_SCALE below the minor unit: raw = minor * 10^6.

export const RATE_DECIMALS = 6
export const RATE_SCALE = 1_000_000n

/** Parses a decimal rate string ("0.08", "0.8856") into parts per 10^6, exactly. */
export function parseRate(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text)
  if (!m) throw new Error(`rate must be a non-negative decimal with at most ${RATE_DECIMALS} places, got "${text}"`)
  return BigInt(m[1]!) * RATE_SCALE + BigInt((m[2] ?? '').padEnd(RATE_DECIMALS, '0'))
}

/** n / d rounded half-up, for n >= 0, d > 0 (BR-MNY-02 platform default). */
export function halfUpDiv(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error('halfUpDiv expects n >= 0 and d > 0')
  return (n * 2n + d) / (d * 2n)
}

/**
 * Splits `total` minor units by `weights` so the parts sum exactly to `total` (BR-MNY-03).
 * Floors first, then one unit each to the largest fractional parts; ties by index ascending,
 * so callers pass weights in canonical (payee id asc) order.
 */
export function largestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) throw new Error('largestRemainder: total must be >= 0')
  let sumW = 0n
  for (const w of weights) {
    if (w < 0n) throw new Error('largestRemainder: weights must be >= 0')
    sumW += w
  }
  if (sumW === 0n) {
    if (total !== 0n) throw new Error('largestRemainder: cannot split a non-zero total over zero weights')
    return weights.map(() => 0n)
  }
  const parts = new Array<bigint>(weights.length)
  const rems = new Array<bigint>(weights.length)
  let floors = 0n
  for (let i = 0; i < weights.length; i++) {
    const x = total * weights[i]!
    parts[i] = x / sumW
    rems[i] = x % sumW
    floors += parts[i]!
  }
  const left = Number(total - floors)
  if (left > 0) {
    const order = Array.from(weights.keys())
    order.sort((a, b) => (rems[a]! > rems[b]! ? -1 : rems[a]! < rems[b]! ? 1 : a - b))
    for (let j = 0; j < left; j++) parts[order[j]!]! += 1n
  }
  return parts
}
