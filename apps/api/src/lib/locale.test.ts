import type { Tx } from '@nmp/db'
import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { describe, expect, test, vi } from 'vitest'
import { LOCALE_LABELS, message, negotiate, offeredLocales, portalLocale, primarySubtag, SUPPORTED_LOCALES } from './locale.js'

// T-BM-30 (PLAN B-MKT D-BM-11): tag normalisation, offered locales, negotiation, fallback logs and the catalogue lookup.

const logger = () => ({ warn: vi.fn() }) as unknown as FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> }

function portalRequest(row: { locale: string | null; languages: string[]; market_id?: string }, acceptLanguage?: string) {
  const log = logger()
  const tx = { query: vi.fn(async () => ({ rows: [{ tenant_id: 't-1', market_id: row.market_id ?? 'm-1', ...row }] })) } as unknown as Tx
  const request = {
    auth: { realm: 'portal', userId: 'u-1', mfaRequired: false, mfaEnrolled: false, mfaVerified: false },
    routeOptions: { config: {} },
    headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
    log,
  } as unknown as FastifyRequest
  return { tx, request, log }
}

describe('lib/locale (T-BM-30)', () => {
  test('supports en and de with endonym labels', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'de'])
    expect(LOCALE_LABELS).toEqual({ en: 'English', de: 'Deutsch' })
  })

  test('primarySubtag lowercases the part before the first hyphen', () => {
    expect(['en-GB', 'de-AT', 'fil', 'DE', 'pt-BR'].map(primarySubtag)).toEqual(['en', 'de', 'fil', 'de', 'pt'])
  })

  test('offered locales: primary subtags in market order, de-duplicated, supported only, else en', () => {
    expect(offeredLocales(['en-GB'])).toEqual(['en'])
    expect(offeredLocales(['de-AT'])).toEqual(['de'])
    expect(offeredLocales(['de', 'en', 'de-AT'])).toEqual(['de', 'en'])
    expect(offeredLocales(['nl'])).toEqual(['en'])
    expect(offeredLocales(['fil'])).toEqual(['en'])
  })

  test('negotiate honours q-values and order, matches primary subtags among the offered only', () => {
    expect(negotiate('de-AT,de;q=0.9,en;q=0.8', ['en', 'de'])).toBe('de')
    expect(negotiate('en;q=0.5, de;q=0.7', ['en', 'de'])).toBe('de')
    expect(negotiate('fr, en-US;q=0.4', ['en', 'de'])).toBe('en')
    expect(negotiate('de;q=0', ['en', 'de'])).toBeNull()
    expect(negotiate('fr', ['en', 'de'])).toBeNull()
    expect(negotiate(undefined, ['en'])).toBeNull()
  })

  test('portalLocale: saved preference if offered, else Accept-Language, else the market default', async () => {
    const saved = portalRequest({ locale: 'de', languages: ['en', 'de'] }, 'en')
    const header = portalRequest({ locale: null, languages: ['en', 'de'] }, 'de')
    const notOffered = portalRequest({ locale: 'de', languages: ['en-GB'] })
    const regional = portalRequest({ locale: null, languages: ['de-AT'] })

    expect(await portalLocale(saved.tx, saved.request)).toEqual({ locale: 'de', offered: ['en', 'de'], defaultLocale: 'en' })
    expect(await portalLocale(header.tx, header.request)).toEqual({ locale: 'de', offered: ['en', 'de'], defaultLocale: 'en' })
    expect(await portalLocale(notOffered.tx, notOffered.request)).toEqual({ locale: 'en', offered: ['en'], defaultLocale: 'en' })
    expect(await portalLocale(regional.tx, regional.request)).toEqual({ locale: 'de', offered: ['de'], defaultLocale: 'de' })
    expect([saved, header, notOffered, regional].every(({ log }) => log.warn.mock.calls.length === 0)).toBe(true)
  })

  test('portalLocale logs a market language without a catalogue once per process (LOCALE_FALLBACK)', async () => {
    const first = portalRequest({ locale: null, languages: ['nl'], market_id: 'm-nl' })
    const again = portalRequest({ locale: null, languages: ['nl'], market_id: 'm-nl' })

    expect(await portalLocale(first.tx, first.request)).toEqual({ locale: 'en', offered: ['en'], defaultLocale: 'en' })
    await portalLocale(again.tx, again.request)
    expect(first.log.warn).toHaveBeenCalledWith({ tenant_id: 't-1', market_id: 'm-nl', language: 'nl' }, 'LOCALE_FALLBACK')
    expect(again.log.warn).not.toHaveBeenCalled()
  })

  test('message interpolates, picks plurals per locale, falls back to the market default then en with one log', () => {
    const catalogues = {
      en: { greeting: 'Hello {name}', lines_one: '{count} line', lines_other: '{count} lines', only_en: 'English only', in_default: 'EN' },
      de: { greeting: 'Hallo {name}', lines_one: '{count} Zeile', lines_other: '{count} Zeilen', in_default: 'DE' },
    }
    const log = logger()

    expect(message(catalogues, 'greeting', { name: 'Ada' }, 'de', 'en', log)).toBe('Hallo Ada')
    expect(message(catalogues, 'lines', { count: 1 }, 'de', 'en', log)).toBe('1 Zeile')
    expect(message(catalogues, 'lines', { count: 3 }, 'en', 'en', log)).toBe('3 lines')
    expect(log.warn).not.toHaveBeenCalled()
    expect(message(catalogues, 'only_en', {}, 'de', 'de', log)).toBe('English only')
    expect(message(catalogues, 'only_en', {}, 'de', 'de', log)).toBe('English only')
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith({ locale: 'de', key: 'only_en' }, 'MESSAGE_FALLBACK')
    expect(() => message(catalogues, 'missing', {}, 'en', 'en', log)).toThrow('missing in the en catalogue')
  })
})
