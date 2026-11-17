import { describe, expect, test } from 'vitest'
import { Refusal } from './refusal.js'
import { perUnit, proportional, scaleHalfUp, sum, times } from './volumes.js'

describe('D-B2-17 volume arithmetic (exact BigInt)', () => {
  test('line volumes are per-unit times quantity, and a line divides back exactly', () => {
    const line = times({ qv: '150', bv: '7' }, 3)

    expect(line).toEqual({ qv: '450', bv: '21' })
    expect(perUnit(line, 3)).toEqual({ qv: '150', bv: '7' })
    expect(times({ qv: '150' }, -2)).toEqual({ qv: '-300' })
    expect(times({ qv: '9007199254740993' }, 1)).toEqual({ qv: '9007199254740993' }) // beyond float precision
  })

  test('sums per measure, sorted, missing measures count as zero', () => {
    expect(sum([{ qv: '300', bv: '14' }, { qv: '100' }, { qv: '-50' }])).toEqual({ bv: '14', qv: '350' })
    expect(sum([])).toEqual({})
  })

  test('TS-65: proportional scaling rounds half-up on the magnitude', () => {
    expect(scaleHalfUp(-14n, 750n, 1000n)).toBe(-11n) // -10.5 -> -11
    expect(scaleHalfUp(14n, 750n, 1000n)).toBe(11n)
    expect(scaleHalfUp(-300n, 750n, 1000n)).toBe(-225n)
    expect(scaleHalfUp(-10n, 1n, 3n)).toBe(-3n) // -3.33 -> -3
    expect(scaleHalfUp(-5n, 1n, 2n)).toBe(-3n) // -2.5 -> -3
    expect(proportional({ qv: '-300', bv: '-14' }, 750n, 1000n)).toEqual({ qv: '-225', bv: '-11' })
  })

  test('a volume beyond the bigint range is refused VOLUME_OUT_OF_RANGE', () => {
    expect(() => times({ qv: '9223372036854775807' }, 2)).toThrow(Refusal)
  })
})
