import { expect, test } from 'vitest'
import { formatMinor } from './money.js'

test('minor units format with the market digits by string arithmetic', () => {
  expect(formatMinor('2300', 2)).toBe('23.00')
  expect(formatMinor('5', 2)).toBe('0.05')
  expect(formatMinor('0', 2)).toBe('0.00')
  expect(formatMinor('-1234', 3)).toBe('-1.234')
  expect(formatMinor('900719925474099312', 2)).toBe('9007199254740993.12')
  expect(formatMinor('42', 0)).toBe('42')
})
