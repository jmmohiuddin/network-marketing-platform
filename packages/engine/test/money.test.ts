import { describe, expect, test } from 'vitest'
import { assertInt64, largestRemainder, mulRate, parseDecimal, RATE_SCALE, roundRaw, toRaw } from '../src/money.js'
import { loadFixture } from './fixtures/load.js'

interface MoneyFixture {
  readonly cases: readonly { readonly name: string; readonly totalMinor: bigint; readonly weights: readonly string[]; readonly expectedMinor: readonly bigint[] }[]
  readonly rounding: readonly { readonly rawOfMinor: bigint; readonly rate: string; readonly expectedMinor: bigint }[]
}
const fixture = loadFixture<MoneyFixture>('money.json')

describe('largestRemainder (BR-MNY-03): parts sum exactly, ties by index ascending', () => {
  test.each(fixture.cases)('$name', ({ totalMinor, weights, expectedMinor }) => {
    const parts = largestRemainder(totalMinor, weights.map((w) => BigInt(w)))
    expect(parts).toEqual(expectedMinor)
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(totalMinor)
  })

  test('zero weights split only a zero total; negatives refused', () => {
    expect(largestRemainder(0n, [0n, 0n])).toEqual([0n, 0n])
    expect(() => largestRemainder(1n, [0n])).toThrow('INVALID_INPUT')
    expect(() => largestRemainder(-1n, [1n])).toThrow('INVALID_INPUT')
    expect(() => largestRemainder(1n, [-1n, 2n])).toThrow('INVALID_INPUT')
  })
})

describe('roundRaw half_up (BR-MNY-02): the single rounding function', () => {
  test.each(fixture.rounding)('$rawOfMinor x $rate', ({ rawOfMinor, rate, expectedMinor }) => {
    expect(roundRaw(mulRate(toRaw(rawOfMinor), parseDecimal(rate)), 'half_up')).toBe(expectedMinor)
  })

  test('ties go away from zero; just below a tie goes down', () => {
    const half = toRaw(1n) / 2n
    expect(roundRaw(half, 'half_up')).toBe(1n)
    expect(roundRaw(half - 1n, 'half_up')).toBe(0n)
    expect(roundRaw(-half, 'half_up')).toBe(-1n)
    expect(roundRaw(-half + 1n, 'half_up')).toBe(0n)
  })
})

describe('parseDecimal and mulRate', () => {
  test('exact parts per RATE_SCALE', () => {
    expect(parseDecimal('0.08')).toBe(80_000n)
    expect(parseDecimal('1')).toBe(RATE_SCALE)
    expect(parseDecimal('0.000001')).toBe(1n)
    expect(parseDecimal('41.75')).toBe(41_750_000n)
  })

  test.each(['', '-0.1', '0.1234567', '1e-3', '.5', '1.', ' 1', '0,5'])('rejects %j', (text) => {
    expect(() => parseDecimal(text)).toThrow('INVALID_INPUT')
  })

  test('two rate applications on a minor amount are exact (matching on a level bonus)', () => {
    const level = mulRate(toRaw(12_345n), parseDecimal('0.123457'))
    const match = mulRate(level, parseDecimal('0.333333'))
    expect(match * RATE_SCALE * RATE_SCALE).toBe(toRaw(12_345n) * 123_457n * 333_333n)
  })
})

test('assertInt64 fails the run outside the amount_minor range (FR-COMP-012)', () => {
  expect(assertInt64((1n << 63n) - 1n, 'x')).toBe((1n << 63n) - 1n)
  expect(() => assertInt64(1n << 63n, 'x')).toThrow('OVERFLOW')
  expect(() => assertInt64(-(1n << 63n) - 1n, 'x')).toThrow('OVERFLOW')
})
