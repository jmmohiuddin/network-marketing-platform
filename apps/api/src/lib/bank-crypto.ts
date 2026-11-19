import { createHmac } from 'node:crypto'
import { z } from 'zod'

// D-B4-16: payee bank details as staff enter them, their fingerprint (shared-account check without decrypting) and
// mask (the only form that leaves the database, SECURITY section 6). The details themselves are sealed with
// lib/secret-box under the contexts below. shortcut: generic formats (IBAN mod-97, local alphanumerics), market-pack
// bank formats in B-MKT.

const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/
const MOD_97_CHUNK = 9

/** Upper-case alphanumerics: spaces and separators people type are dropped. */
export const compact = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** ISO 13616: 15..34 characters, country and check digits, and the rearranged number mod 97 = 1. */
export function ibanValid(iban: string): boolean {
  const value = compact(iban)
  if (!IBAN_SHAPE.test(value)) return false
  const digits = [...value.slice(4) + value.slice(0, 4)]
    .map((char) => (char >= 'A' ? String(char.charCodeAt(0) - 55) : char))
    .join('')
  let remainder = 0
  for (let index = 0; index < digits.length; index += MOD_97_CHUNK) {
    remainder = Number(`${remainder}${digits.slice(index, index + MOD_97_CHUNK)}`) % 97
  }
  return remainder === 1
}

const accountHolder = z.string().trim().min(1).max(140)

export const BankDetails = z.discriminatedUnion('scheme', [
  z.strictObject({
    scheme: z.literal('iban'),
    account_holder: accountHolder,
    iban: z.string().max(50).refine(ibanValid, 'must be a valid IBAN'),
    bic: z.string().regex(/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/, 'must be a BIC').optional(),
  }),
  z.strictObject({
    scheme: z.literal('local'),
    account_holder: accountHolder,
    account_number: z.string().regex(/^[A-Za-z0-9]{4,34}$/, 'must be 4 to 34 letters or digits'),
    bank_code: z.string().regex(/^[A-Za-z0-9]{1,20}$/, 'must be 1 to 20 letters or digits'),
  }),
])

export type BankDetails = z.infer<typeof BankDetails>

/** The account itself, independent of how it was typed: the IBAN, or bank code and account number. */
export function normaliseAccount(details: BankDetails): string {
  return details.scheme === 'iban' ? compact(details.iban) : `${compact(details.bank_code)}:${compact(details.account_number)}`
}

/** HMAC-SHA256 of the normalised account, per tenant: equal for one account, unreadable without the key. */
export function bankFingerprint(key: Buffer, tenantId: string, details: BankDetails): Buffer {
  return createHmac('sha256', key).update(`bank:${tenantId}:${normaliseAccount(details)}`).digest()
}

export function maskAccount(details: BankDetails): string {
  return `•••• ${normaliseAccount(details).slice(-4)}`
}

export const bankRequestContext = (id: string): string => `bank_detail_request:${id}`
export const bankVersionContext = (id: string): string => `bank_detail_version:${id}`
