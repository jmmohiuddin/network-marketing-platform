import type { RoundingMode, TraceStep } from '@nmp/engine'
import { describe, expect, test } from 'vitest'
import { SUPPORTED_LOCALES } from '../../lib/locale.js'
import { COMP_MESSAGES } from './messages.js'
import type { OriginKind } from './statements.js'

// AC-DIST7-3 release check for the COMP catalogues: every key of en in every supported locale (and no other), the same
// placeholders, no empty value.

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('T-BM-33 COMP catalogue completeness (AC-DIST7-3)', () => {
  const en: Readonly<Record<string, string>> = COMP_MESSAGES.en

  test.each(SUPPORTED_LOCALES.map((locale) => [locale]))('%s has every key of en, the same placeholders and no empty value', (locale) => {
    const catalogue: Readonly<Record<string, string>> = COMP_MESSAGES[locale]
    expect(Object.keys(catalogue).sort()).toEqual(Object.keys(en).sort())
    for (const [key, text] of Object.entries(catalogue)) {
      expect(text.trim(), `${locale} ${key}`).not.toBe('')
      expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(en[key]!))
    }
  })

  test('every key explanation.ts builds at run time from an engine or origin code exists (a missing one is a 500)', () => {
    // Records over the unions: a new cap method, rounding mode or origin kind fails the typecheck until it is listed here.
    const methods: Record<Extract<TraceStep, { step: 'cap' }>['method'], true> = { proportional: true, priority: true, per_person: true }
    const modes: Record<RoundingMode, true> = { half_up: true, half_even: true }
    const origins: Record<Exclude<OriginKind, 'none'>, true> = { late_order: true, refund: true, manual: true, restatement: true, provisional: true }
    const built = [
      ...Object.keys(methods).map((k) => `explanation.cap_method.${k}`),
      ...Object.keys(modes).map((k) => `explanation.rounding.${k}`),
      ...Object.keys(origins).map((k) => `explanation.origin_kind.${k}`),
    ]
    expect(built.filter((key) => !(key in en))).toEqual([])
  })

  test('plural keys come in _one/_other pairs', () => {
    for (const key of Object.keys(en).filter((k) => /_(one|other)$/.test(k))) {
      const base = key.replace(/_(one|other)$/, '')
      expect([`${base}_one`, `${base}_other`].every((k) => k in en), key).toBe(true)
    }
  })
})
