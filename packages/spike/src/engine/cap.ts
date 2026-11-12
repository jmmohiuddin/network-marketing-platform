import { largestRemainder, RATE_SCALE } from './money.js'

/**
 * Company cap (pass 8, BR-CAP-01). `raw` = in-scope lines (minor * RATE_SCALE) in canonical order,
 * `group[i]` = the line's bonus. Returns final minor amounts summing exactly to `capMinor`, or null
 * when the cap does not bind.
 * Priority: listed groups are reduced in order (whole group, or the last one proportionally);
 * whatever excess remains is then taken proportionally from all lines (TS-08, G-E2E-01).
 * Without priority the whole scope is scaled proportionally (TS-07). Splits use largest remainder.
 */
export function allocateCap(capMinor: bigint, raw: readonly bigint[], group: readonly number[], priority: readonly number[] = []): bigint[] | null {
  let proposed = 0n
  for (const r of raw) proposed += r
  if (proposed <= capMinor * RATE_SCALE) return null

  const groupSum = new Map<number, bigint>()
  raw.forEach((r, i) => groupSum.set(group[i]!, (groupSum.get(group[i]!) ?? 0n) + r))
  // Each group keeps num/den of its raw amount; at most one group has den != 1.
  const keep = new Map<number, { num: bigint; den: bigint }>()
  let excess = proposed - capMinor * RATE_SCALE
  for (const g of priority) {
    const sum = groupSum.get(g) ?? 0n
    if (excess <= 0n || sum === 0n) continue
    if (excess >= sum) {
      keep.set(g, { num: 0n, den: 1n })
      excess -= sum
    } else {
      keep.set(g, { num: sum - excess, den: sum })
      excess = 0n
    }
  }
  let common = 1n
  for (const k of keep.values()) common *= k.den
  const weights = raw.map((r, i) => {
    const k = keep.get(group[i]!)
    return k ? (r * k.num * common) / k.den : r * common
  })
  return largestRemainder(capMinor, weights)
}
