import { describe, expect, test } from 'vitest'
import { addFractions, roundFraction } from './rounding.js'

describe('T-B3-28 roundFraction (FR-COMP-012)', () => {
  test('half_up rounds ties away from zero on the magnitude, both signs', () => {
    expect([roundFraction(125n, 10n, 'half_up'), roundFraction(-125n, 10n, 'half_up')]).toEqual([13n, -13n])
    expect([roundFraction(124n, 10n, 'half_up'), roundFraction(-126n, 10n, 'half_up')]).toEqual([12n, -13n])
  })

  test('half_even rounds ties to the even unit, both signs (0.125 -> 0.12, 0.135 -> 0.14)', () => {
    expect([roundFraction(125n, 10n, 'half_even'), roundFraction(135n, 10n, 'half_even')]).toEqual([12n, 14n])
    expect([roundFraction(-125n, 10n, 'half_even'), roundFraction(-135n, 10n, 'half_even')]).toEqual([-12n, -14n])
    expect(roundFraction(-126n, 10n, 'half_even')).toBe(-13n)
  })

  test('exact values stay, fractions add exactly, a zero denominator is refused', () => {
    expect(roundFraction(-5000n, 1n, 'half_up')).toBe(-5000n)
    expect(addFractions({ num: 1n, den: 3n }, { num: 1n, den: 6n })).toEqual({ num: 9n, den: 18n })
    expect(() => roundFraction(1n, 0n, 'half_up')).toThrow('positive denominator')
  })
})
