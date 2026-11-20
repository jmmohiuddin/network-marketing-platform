import type { Tx } from '@nmp/db'
import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { currentAuth } from './auth.js'

// D-BM-11 portal localisation: the platform catalogues that are complete (mirrored in
// apps/web/src/features/portal/i18n/index.ts, equality tested), negotiation and the catalogue lookup with fallback.

export const SUPPORTED_LOCALES = ['en', 'de'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
/** Endonyms for the language picker. */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = { en: 'English', de: 'Deutsch' }

export type Catalogue = Readonly<Record<string, string>>
export type Catalogues = Readonly<Record<Locale, Catalogue>>
export type MessageParams = Readonly<Record<string, string | number>>

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** The lowercase part of a BCP-47 tag before the first '-' (SQL twin: lower(split_part(tag, '-', 1))). */
export function primarySubtag(tag: string): string {
  return tag.split('-', 1)[0]!.toLowerCase()
}

/** The supported locales a market's languages offer, in market order, de-duplicated; none -> ['en']. */
export function offeredLocales(marketLanguages: readonly string[]): Locale[] {
  const offered = [...new Set(marketLanguages.map(primarySubtag))].filter(isLocale)
  return offered.length === 0 ? ['en'] : offered
}

/** The offered locale an Accept-Language header prefers most (q-values, primary-subtag match), else null. */
export function negotiate(acceptLanguage: string | undefined, offered: readonly Locale[]): Locale | null {
  const ranked = (acceptLanguage ?? '').split(',').flatMap((entry, index) => {
    const [tag = '', ...options] = entry.trim().split(';').map((part) => part.trim())
    const q = options.find((option) => option.startsWith('q='))
    const weight = q === undefined ? 1 : Number(q.slice(2))
    return tag === '' || !Number.isFinite(weight) || weight <= 0 ? [] : [{ subtag: primarySubtag(tag), weight, index }]
  })
  ranked.sort((left, right) => right.weight - left.weight || left.index - right.index)
  const match = ranked.find((entry) => (offered as readonly string[]).includes(entry.subtag))
  return match === undefined ? null : (match.subtag as Locale)
}

// shortcut: in-memory once-per-process log dedupe, a metric when an observability stack exists
const logged = new Set<string>()
function warnOnce(log: FastifyBaseLogger, event: string, fields: Readonly<Record<string, string>>): void {
  const key = `${event}:${Object.values(fields).join(':')}`
  if (logged.has(key)) return
  logged.add(key)
  log.warn(fields, event)
}

export interface PortalLocale {
  readonly locale: Locale
  readonly offered: Locale[]
  readonly defaultLocale: Locale
}

/**
 * The portal session's effective locale: its saved preference if offered, else the best Accept-Language match among
 * the offered locales, else the market default (the first market language if supported, else en). A market language
 * without a catalogue is logged once per process (LOCALE_FALLBACK).
 */
export async function portalLocale(tx: Tx, request: FastifyRequest): Promise<PortalLocale> {
  const auth = currentAuth(request)
  const { rows } = await tx.query<{ locale: string | null; tenant_id: string; market_id: string; languages: string[] }>(
    `SELECT u.locale, m.tenant_id, m.id AS market_id, m.languages
     FROM user_account u
     JOIN participant x ON x.tenant_id = u.tenant_id AND x.id = u.participant_id
     JOIN market m ON m.tenant_id = x.tenant_id AND m.id = x.market_id
     WHERE u.id = $1`,
    [auth.userId],
  )
  const row = rows[0]
  if (row === undefined) throw new Error('portal locale needs the portal session\'s own account')
  for (const language of row.languages) {
    if (!isLocale(primarySubtag(language))) {
      warnOnce(request.log, 'LOCALE_FALLBACK', { tenant_id: row.tenant_id, market_id: row.market_id, language })
    }
  }
  const offered = offeredLocales(row.languages)
  const first = primarySubtag(row.languages[0] ?? 'en')
  const defaultLocale: Locale = isLocale(first) ? first : 'en'
  const saved = row.locale !== null && (offered as readonly string[]).includes(row.locale) ? (row.locale as Locale) : null
  const header = request.headers['accept-language']
  const locale = saved ?? negotiate(typeof header === 'string' ? header : undefined, offered) ?? defaultLocale
  return { locale, offered, defaultLocale }
}

function lookup(catalogue: Catalogue, key: string, locale: Locale, count: number | undefined): string | undefined {
  if (count === undefined) return catalogue[key]
  return catalogue[`${key}_${new Intl.PluralRules(locale).select(count)}`] ?? catalogue[`${key}_other`] ?? catalogue[key]
}

/**
 * The text of key in locale with {param} interpolation; a numeric param `count` picks the `_one`/`_other` plural key.
 * A key missing in locale falls back to fallback (the market default), then en, and is logged once per process per
 * (locale, key) as MESSAGE_FALLBACK. A key missing in en too is a programming error.
 */
export function message(
  catalogues: Catalogues, key: string, params: MessageParams, locale: Locale, fallback: Locale, log: FastifyBaseLogger,
): string {
  const count = typeof params.count === 'number' ? params.count : undefined
  let text = lookup(catalogues[locale], key, locale, count)
  if (text === undefined) {
    warnOnce(log, 'MESSAGE_FALLBACK', { locale, key })
    text = lookup(catalogues[fallback], key, fallback, count) ?? lookup(catalogues.en, key, 'en', count)
  }
  if (text === undefined) throw new Error(`message key ${key} is missing in the en catalogue`)
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in params ? String(params[name]) : placeholder))
}
