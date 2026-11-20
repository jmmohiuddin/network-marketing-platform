// D-BM-11 portal localisation: the platform catalogues (mirror of apps/api/src/lib/locale.ts SUPPORTED_LOCALES, equality
// tested), language-tag normalisation, Accept-Language negotiation and the catalogue lookup with {param} interpolation
// and _one/_other plurals (Intl.PluralRules). No dependency.
import { de } from './de'
import { en } from './en'
import { translate } from './translate'

export const SUPPORTED_LOCALES = ['en', 'de'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

type CatalogueKey = keyof typeof en
/** Every key of en; a de catalogue typed with it must have every key and no other (the release check adds empties and placeholders). */
export type Catalogue = Readonly<Record<CatalogueKey, string>>
/** A message key; plural messages are asked for by their base key ("rank.sources", not "rank.sources_one"). */
export type MessageKey = CatalogueKey extends infer K ? K extends `${infer Base}_${'one' | 'other'}` ? Base : K : never
export type MessageParams = Readonly<Record<string, string | number>>
export type Translate = (key: MessageKey, params?: MessageParams) => string

export const CATALOGUES: Readonly<Record<Locale, Catalogue>> = { en, de }

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** The lowercase part of a BCP-47 tag before the first '-' ("de-AT" -> "de"); API twin in lib/locale. */
export function primarySubtag(tag: string): string {
  return tag.split('-', 1)[0]!.toLowerCase()
}

/** The supported locale an Accept-Language header prefers most (q-values, primary-subtag match), else en. */
export function negotiate(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? '').split(',').flatMap((entry, index) => {
    const [tag = '', ...options] = entry.trim().split(';').map((part) => part.trim())
    const q = options.find((option) => option.startsWith('q='))
    const weight = q === undefined ? 1 : Number(q.slice(2))
    return tag === '' || !Number.isFinite(weight) || weight <= 0 ? [] : [{ subtag: primarySubtag(tag), weight, index }]
  })
  ranked.sort((left, right) => right.weight - left.weight || left.index - right.index)
  return ranked.map((entry) => entry.subtag).find(isLocale) ?? DEFAULT_LOCALE
}

/** The words of `locale` (server side and sign-in; portal client code builds them from the catalogue it is handed). */
export function translator(locale: Locale): Translate {
  return translate(CATALOGUES[locale], locale)
}
