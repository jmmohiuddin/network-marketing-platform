// The catalogue lookup without the catalogues: client code gets the one catalogue of the session's locale from the
// server (BUG-132: shipping every catalogue cost ~19 KB gzip on every portal page). {param} interpolation with numbers
// in the locale and _one/_other plurals (Intl.PluralRules).
import type { Catalogue, Locale, MessageKey, MessageParams, Translate } from '.'

function interpolate(text: string, locale: Locale, params: MessageParams | undefined): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params?.[name]
    if (value === undefined) return whole
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value
  })
}

/** The words of `catalogue` in `locale`: a numeric `count` param picks the _one/_other form; an unknown key is returned as is. */
export function translate(catalogue: Catalogue, locale: Locale): Translate {
  const messages: Readonly<Record<string, string>> = catalogue
  return (key, params) => {
    const count = params?.count
    const plural = typeof count === 'number' ? `${key}_${new Intl.PluralRules(locale).select(count)}` : null
    const text = (plural === null ? undefined : messages[plural] ?? messages[`${key}_other`]) ?? messages[key] ?? key
    return interpolate(text, locale, params)
  }
}

/** The message of a dynamic key (`errors.${code}`, `nav.${key}`), null when the catalogue has none. */
export function knownMessage(t: Translate, key: string): string | null {
  const text = t(key as MessageKey)
  return text === key ? null : text
}
