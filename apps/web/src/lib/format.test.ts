import { describe, expect, it } from 'vitest'
import { countLabel, formatDateTime } from './format'
import { marketName } from './markets'

describe('shared formatting (BUG-018)', () => {
  it('puts the noun of a count in the right number', () => {
    expect(countLabel(1, 'market')).toBe('1 market')
    expect(countLabel(0, 'market')).toBe('0 markets')
    expect(countLabel(2, 'loaded batch', 'loaded batches')).toBe('2 loaded batches')
    expect(countLabel(1200, 'validation error')).toBe(`${(1200).toLocaleString()} validation errors`)
  })

  it('formats every timestamp the same way', () => {
    const iso = '2026-11-12T06:55:00.000Z'
    expect(formatDateTime(iso)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)))
    expect(formatDateTime(null)).toBe('—')
  })

  it('names a market by country and code, and a code without a country once', () => {
    expect(marketName({ code: 'DE', name: 'Germany' })).toBe('Germany (DE)')
    expect(marketName({ code: 'DEMO', name: 'DEMO' })).toBe('DEMO')
  })
})
