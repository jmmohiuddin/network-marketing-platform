// FR-COMP-012: the one place COMP rounds money (D-B3-13 adjustment origins). The tenant's money.rounding_mode (half_up
// when unset, BR-MNY-02) applies to the magnitude, the sign is kept: -0.125 -> -0.13 half_up, -0.12 half_even.

import type { RoundingMode } from '@nmp/engine'

export type { RoundingMode }

/** num / den (den > 0) rounded to a whole minor unit on its magnitude. */
export function roundFraction(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (den <= 0n) throw new Error('roundFraction needs a positive denominator')
  const magnitude = num < 0n ? -num : num
  const whole = magnitude / den
  const twice = (magnitude % den) * 2n
  const up = twice > den || (twice === den && (mode === 'half_up' || whole % 2n === 1n))
  const rounded = up ? whole + 1n : whole
  return num < 0n ? -rounded : rounded
}

/** Exact sum of fractions, kept as one fraction (num, den > 0). */
export interface Fraction {
  readonly num: bigint
  readonly den: bigint
}

export const ZERO: Fraction = { num: 0n, den: 1n }

export function addFractions(a: Fraction, b: Fraction): Fraction {
  return a.den === b.den ? { num: a.num + b.num, den: a.den } : { num: a.num * b.den + b.num * a.den, den: a.den * b.den }
}
