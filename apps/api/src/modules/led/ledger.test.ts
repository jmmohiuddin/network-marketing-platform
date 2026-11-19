import { describe, expect, test } from 'vitest'
import { balanceOf, decimalOf, normalSide } from './ledger.js'
import { writeOffEligible } from './write-off.js'

describe('ledger arithmetic (D-B4-03, D-B4-19)', () => {
  test('minor units print with the market digits by string arithmetic', () => {
    expect([decimalOf('123456', 2), decimalOf('5', 2), decimalOf('0', 2), decimalOf('-7', 3), decimalOf('120', 0)])
      .toEqual(['1234.56', '0.05', '0.00', '-0.007', '120'])
    expect(decimalOf('999999999999999999', 2)).toBe('9999999999999999.99')
  })

  test('balances are shown on the normal side', () => {
    expect([normalSide('clawback_receivable'), normalSide('payee_payable')]).toEqual(['debit', 'credit'])
    expect([balanceOf('commission_expense', '9600', '3000'), balanceOf('payee_payable', '5000', '8000')]).toEqual(['6600', '3000'])
  })

  test('D-B4-08 eligibility: at or below the amount, or outstanding at least the days', () => {
    expect(writeOffEligible({ eligible_below_minor: '2000', second_approver_above_minor: '0' }, 2000n, 0)).toBe(true)
    expect(writeOffEligible({ eligible_below_minor: '2000', second_approver_above_minor: '0' }, 2001n, 400)).toBe(false)
    expect(writeOffEligible({ eligible_after_days: 90, second_approver_above_minor: '0' }, 10n ** 12n, 90)).toBe(true)
    expect(writeOffEligible({ eligible_after_days: 90, second_approver_above_minor: '0' }, 1n, 89)).toBe(false)
  })
})
