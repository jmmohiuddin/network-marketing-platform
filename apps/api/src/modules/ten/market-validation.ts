import { ApiError } from '../../lib/errors.js'
import { minorUnitOf } from './iso4217.js'

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
// ISO 3166-1 user-assigned (AA, QM-QZ, XA-XZ, ZZ) and exceptionally reserved non-country codes CLDR still names.
const NOT_A_COUNTRY = /^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/

/** 422 VALIDATION_FAILED naming the field (AC-TEN2-2): well-formed input that is not a real code. */
export function invalidField(path: string, message: string): ApiError {
  return new ApiError(422, 'VALIDATION_FAILED', `${path} is not valid: ${message}.`, { issues: [{ path, message }] })
}

export function isCountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && !NOT_A_COUNTRY.test(code) && REGIONS.of(code) !== undefined
}

/** An IANA zone name the runtime knows (offsets such as "+01:00" are not zones). */
export function isTimeZone(zone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(zone)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false // RangeError: unknown zone
  }
}

/** BCP-47 tags in canonical form, or the first invalid one. */
export function canonicalLanguages(tags: readonly string[]): { ok: true; tags: string[] } | { ok: false; tag: string } {
  const canonical: string[] = []
  for (const tag of tags) {
    try {
      canonical.push(...Intl.getCanonicalLocales(tag))
    } catch {
      return { ok: false, tag } // RangeError: not a well-formed language tag
    }
  }
  return { ok: true, tags: [...new Set(canonical)] }
}

export interface MarketFields {
  readonly time_zone?: string
  readonly languages?: readonly string[]
  readonly currency?: string
}

/** Validates the zone, languages and currency given; returns canonical languages and the currency's minor unit. */
export function validateMarketFields(fields: MarketFields): { languages?: string[]; minorUnit?: number } {
  if (fields.time_zone !== undefined && !isTimeZone(fields.time_zone)) throw invalidField('time_zone', 'not an IANA time zone')
  let languages: string[] | undefined
  if (fields.languages !== undefined) {
    const result = canonicalLanguages(fields.languages)
    if (!result.ok) throw invalidField('languages', `${result.tag} is not a BCP-47 language tag`)
    languages = result.tags
  }
  let minorUnit: number | undefined
  if (fields.currency !== undefined) {
    minorUnit = minorUnitOf(fields.currency)
    if (minorUnit === undefined) throw invalidField('currency', 'not an active ISO 4217 currency code')
  }
  return { ...(languages === undefined ? {} : { languages }), ...(minorUnit === undefined ? {} : { minorUnit }) }
}
