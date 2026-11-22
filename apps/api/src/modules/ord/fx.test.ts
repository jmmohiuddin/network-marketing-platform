import { describe, expect, test } from 'vitest'
import { convertMinor } from './fx.js'

const chfEur = { rate: '1.0412000000', baseDigits: 2, quoteDigits: 2 }

describe('convertMinor (D-V1A-04: exact integer arithmetic on the 10-dp rate, rounded once)', () => {
  test('T-V1A-21: the §6 values', () => {
    expect(convertMinor(12000n, { ...chfEur, mode: 'half_up' })).toBe(12494n) // CHF 120.00 -> EUR 124.94
    expect(convertMinor(6000n, { ...chfEur, mode: 'half_up' })).toBe(6247n) // CHF 60.00 -> EUR 62.47
    expect(convertMinor(5000n, { rate: '0.9300000000', baseDigits: 2, quoteDigits: 2, mode: 'half_up' })).toBe(4650n) // USD 50.00 -> EUR 46.50
  })

  test('T-V1A-21: a tie rounds by money.rounding_mode (3750 x 1.0412 = 3904.5)', () => {
    expect(convertMinor(3750n, { ...chfEur, mode: 'half_up' })).toBe(3905n)
    expect(convertMinor(3750n, { ...chfEur, mode: 'half_even' })).toBe(3904n)
    expect(convertMinor(1250n, { ...chfEur, mode: 'half_even' })).toBe(1302n) // 1301.5: the even neighbour is up
  })

  test('the currencies\' minor digits shift the scale both ways; zero stays zero', () => {
    expect(convertMinor(1000n, { rate: '0.0061500000', baseDigits: 0, quoteDigits: 2, mode: 'half_up' })).toBe(615n) // JPY 1000 -> EUR 6.15
    expect(convertMinor(615n, { rate: '162.6016260163', baseDigits: 2, quoteDigits: 0, mode: 'half_up' })).toBe(1000n) // EUR 6.15 -> JPY 1000
    expect(convertMinor(12345n, { rate: '1.0000000000', baseDigits: 2, quoteDigits: 3, mode: 'half_up' })).toBe(123450n)
    expect(convertMinor(0n, { ...chfEur, mode: 'half_up' })).toBe(0n)
  })

  test('no float on the way: an amount near the bigint ceiling converts exactly', () => {
    expect(convertMinor(999_999_999_999_999_999n, { rate: '2.0000000000', baseDigits: 2, quoteDigits: 2, mode: 'half_up' })).toBe(1_999_999_999_999_999_998n)
  })
})
