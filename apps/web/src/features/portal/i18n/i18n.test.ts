import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CATALOGUES, negotiate, primarySubtag, SUPPORTED_LOCALES, translator } from '.'
import { knownMessage } from './translate'

// T-BM-35 / AC-DIST7-3 release check of the portal catalogues: every locale has every key of en, no empty value and the
// same placeholders; SUPPORTED_LOCALES equals the API's; nav.* for every portal navigation key and errors.* for every
// portal-reachable error code.

const api = (path: string): string => readFileSync(fileURLToPath(new URL(`../../../../../api/src/${path}`, import.meta.url)), 'utf8')
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()

/** Error codes the portal can receive (B5 + B-MKT §2 portal routes, sign-in, the client's own NETWORK_ERROR). */
const PORTAL_ERROR_CODES = [
  'NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'UNAUTHENTICATED', 'STEP_UP_REQUIRED', 'NOT_FOUND', 'REALM_FORBIDDEN', 'PERMISSION_DENIED',
  'SCOPE_NOT_HELD', 'VALIDATION_FAILED', 'INVALID_CURSOR', 'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'CSRF_HEADER_MISSING',
  'RATE_LIMITED', 'SIGN_IN_LOCKED', 'INVALID_CREDENTIALS', 'TENANT_NOT_FOUND', 'EMAIL_NOT_VERIFIED', 'FIREBASE_DISABLED',
  'FIREBASE_LINK_REQUIRED', 'MFA_ENROLMENT_REQUIRED', 'MFA_VERIFICATION_REQUIRED', 'PARTICIPANT_TERMINATED', 'DISPUTE_OPEN',
  'DISPUTE_WINDOW_CLOSED', 'BANK_DETAILS_INVALID', 'BANK_DETAIL_REVIEW_PENDING', 'SHARED_ACCOUNT', 'REQUEST_OPEN', 'ERASURE_DEFERRED',
  'LOCALE_NOT_OFFERED', 'TAX_ID_FORMAT',
]

describe('portal catalogues (release check)', () => {
  it('SUPPORTED_LOCALES equals apps/api/src/lib/locale.ts', () => {
    const declared = /export const SUPPORTED_LOCALES = \[([^\]]*)\] as const/.exec(api('lib/locale.ts'))
    expect(declared).not.toBeNull()
    expect([...declared![1]!.matchAll(/'([a-z]{2})'/g)].map((match) => match[1])).toEqual([...SUPPORTED_LOCALES])
    expect(Object.keys(CATALOGUES)).toEqual([...SUPPORTED_LOCALES])
  })

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== 'en'))('%s has every en key, none empty, with the same placeholders', (locale) => {
    const catalogue: Readonly<Record<string, string>> = CATALOGUES[locale]
    for (const [key, english] of Object.entries(CATALOGUES.en)) {
      expect(catalogue[key], `${locale} ${key}`).toBeTypeOf('string')
      expect(catalogue[key]!.trim(), `${locale} ${key}`).not.toBe('')
      expect(placeholders(catalogue[key]!), `${locale} ${key}`).toEqual(placeholders(english))
    }
    expect(Object.keys(catalogue).filter((key) => !(key in CATALOGUES.en))).toEqual([])
    expect(Object.values(CATALOGUES.en).filter((text) => text.trim() === '')).toEqual([])
  })

  it('names every portal navigation key of the API', () => {
    const keys = [...api('modules/iam/me-routes.ts').matchAll(/key: '(\w+)', path: '\/portal[^']*'/g)].map((match) => match[1]!)
    expect(keys.length).toBeGreaterThanOrEqual(6)
    expect(keys.filter((key) => knownMessage(translator('en'), `nav.${key}`) === null)).toEqual([])
  })

  it('words every portal-reachable error code, and the API still raises the B-MKT ones', () => {
    expect(PORTAL_ERROR_CODES.filter((code) => knownMessage(translator('en'), `errors.${code}`) === null)).toEqual([])
    expect(api('modules/iam/me-routes.ts')).toContain("'LOCALE_NOT_OFFERED'")
    expect(api('modules/tax/routes.ts')).toContain("'TAX_ID_FORMAT'")
  })

  it('never calls a tax statement filed or certified (PLAN §5): no "Bescheinigung", an official German tax certificate', () => {
    const claims = /filed|certified|certificate|zertifiziert|bescheinigung/i // "eingereicht" is a dispute word
    for (const catalogue of Object.values(CATALOGUES)) expect(Object.values(catalogue).filter((text) => claims.test(text))).toEqual([])
  })
})

describe('translator()', () => {
  it('interpolates {params} with numbers in the locale and picks _one/_other by count', () => {
    expect(translator('en')('customers.order_count', { count: 1 })).toBe('1 order')
    expect(translator('en')('customers.order_count', { count: 2000 })).toBe('2,000 orders')
    expect(translator('de')('customers.order_count', { count: 2000 })).toBe('2.000 Bestellungen')
    expect(translator('de')('errors.TAX_ID_FORMAT', { label: 'PAN' })).toBe('Das entspricht nicht dem Format PAN.')
  })
})

describe('language tags', () => {
  it('normalises to the lowercase primary subtag and negotiates Accept-Language among the supported locales', () => {
    expect([primarySubtag('de-AT'), primarySubtag('EN-gb'), primarySubtag('fil')]).toEqual(['de', 'en', 'fil'])
    expect(negotiate('de-AT,de;q=0.9,en;q=0.5')).toBe('de')
    expect(negotiate('fr-FR,en;q=0.4,de;q=0.8')).toBe('de')
    expect(negotiate('nl')).toBe('en')
    expect(negotiate(null)).toBe('en')
    expect(negotiate('de;q=0')).toBe('en')
  })
})
