// T-B4-21: bank-detail validation, fingerprint and mask (D-B4-16).
import { randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { BankDetails, bankFingerprint, bankRequestContext, bankVersionContext, ibanValid, maskAccount, normaliseAccount } from './bank-crypto.js'
import { open, seal } from './secret-box.js'

const EXAMPLE_IBAN = 'DE89370400440532013000' // public example IBAN
const holder = { account_holder: 'DE-A E2E' }

describe('ibanValid (ISO 13616 mod-97)', () => {
  test('accepts valid IBANs however they are typed', () => {
    expect(ibanValid(EXAMPLE_IBAN)).toBe(true)
    expect(ibanValid('de89 3704 0044 0532 0130 00')).toBe(true)
    expect(ibanValid('GB82WEST12345698765432')).toBe(true)
  })

  test('refuses a wrong check digit, a bad shape and a length outside 15..34', () => {
    expect(ibanValid('DE89370400440532013001')).toBe(false)
    expect(ibanValid('8937040044053201300DE')).toBe(false)
    expect(ibanValid('DE8937040044')).toBe(false)
    expect(ibanValid(`DE89${'1'.repeat(31)}`)).toBe(false)
  })
})

describe('BankDetails', () => {
  test('parses both schemes and reports the failing path', () => {
    expect(BankDetails.safeParse({ scheme: 'iban', ...holder, iban: EXAMPLE_IBAN, bic: 'COBADEFFXXX' }).success).toBe(true)
    expect(BankDetails.safeParse({ scheme: 'local', ...holder, account_number: '12345678', bank_code: '001' }).success).toBe(true)

    const bad = BankDetails.safeParse({ scheme: 'iban', ...holder, iban: 'DE89370400440532013001' })
    expect(bad.success).toBe(false)
    expect(bad.error?.issues[0]?.path).toEqual(['iban'])
    expect(BankDetails.safeParse({ scheme: 'local', ...holder, account_number: '12', bank_code: '001' }).success).toBe(false)
    expect(BankDetails.safeParse({ scheme: 'iban', account_holder: ' ', iban: EXAMPLE_IBAN }).success).toBe(false)
  })
})

describe('fingerprint and mask', () => {
  const key = randomBytes(32)
  const typed = BankDetails.parse({ scheme: 'iban', ...holder, iban: 'de89 3704 0044 0532 0130 00' })
  const plain = BankDetails.parse({ scheme: 'iban', account_holder: 'Someone else', iban: EXAMPLE_IBAN })

  test('one account has one fingerprint per tenant, whatever the holder or spacing', () => {
    expect(normaliseAccount(typed)).toBe(EXAMPLE_IBAN)
    expect(bankFingerprint(key, 't1', typed)).toEqual(bankFingerprint(key, 't1', plain))
    expect(bankFingerprint(key, 't1', typed)).toHaveLength(32)
    expect(bankFingerprint(key, 't2', typed)).not.toEqual(bankFingerprint(key, 't1', typed))
  })

  test('masks to the last four characters of the account', () => {
    expect(maskAccount(typed)).toBe('•••• 3000')
    expect(maskAccount(BankDetails.parse({ scheme: 'local', ...holder, account_number: 'ab12345678', bank_code: '001' }))).toBe('•••• 5678')
  })

  test('sealed details open only under their own row context', () => {
    const sealed = seal(key, JSON.stringify(typed), bankVersionContext('v1'))

    expect(JSON.parse(open(key, sealed, bankVersionContext('v1')))).toEqual(typed)
    expect(() => open(key, sealed, bankRequestContext('v1'))).toThrow()
  })
})
