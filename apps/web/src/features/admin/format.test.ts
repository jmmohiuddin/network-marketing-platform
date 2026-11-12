import { describe, expect, it } from 'vitest'
import { durationLabel, fromLocalInput, isUuid, marketScopeLabel, remainingLabel, toLocalInput } from './format'

describe('admin format helpers', () => {
  it('writes durations in hours and minutes', () => {
    expect(durationLabel(45)).toBe('45 min')
    expect(durationLabel(240)).toBe('4 h')
    expect(durationLabel(90)).toBe('1 h 30 min')
  })

  it('counts down to the end of a session, rounding up to the minute', () => {
    const now = Date.parse('2026-11-12T10:00:00Z')
    expect(remainingLabel('2026-11-12T12:41:00Z', now, null)).toBe('2 h 41 min')
    expect(remainingLabel('2026-11-12T10:00:30Z', now, null)).toBe('1 min')
    expect(remainingLabel('2026-11-12T09:59:00Z', now, null)).toBe('Ended')
  })

  it('never states more time left than the session window, even with a clock that lags (BUG-038)', () => {
    // A 60-minute session approved 19 s after the page's clock last ticked.
    const now = Date.parse('2026-11-12T03:33:00.000Z')
    expect(remainingLabel('2026-11-12T04:33:19.885Z', now, '2026-11-12T03:33:19.885Z')).toBe('1 h')
    expect(remainingLabel('2026-11-12T04:33:19.885Z', Date.parse('2026-11-12T03:43:19.885Z'), '2026-11-12T03:33:19.885Z')).toBe('50 min')
  })

  it('round-trips datetime-local values through ISO timestamps', () => {
    const iso = fromLocalInput('2026-11-12T09:30')
    expect(iso).not.toBeNull()
    expect(toLocalInput(iso!)).toBe('2026-11-12T09:30')
    expect(fromLocalInput('')).toBeNull()
    expect(toLocalInput('not a date')).toBe('')
  })

  it('names market scopes without inventing market names', () => {
    expect(marketScopeLabel(null)).toBe('All markets')
    expect(marketScopeLabel(['a'])).toBe('1 market')
    expect(marketScopeLabel(['a', 'b'])).toBe('2 markets')
    const markets = [{ id: 'a', code: 'DE' }, { id: 'b', code: 'FR' }]
    expect(marketScopeLabel(['a', 'b'], markets)).toBe('DE, FR')
    expect(marketScopeLabel(['a', 'c'], markets)).toBe('2 markets')
  })

  it('recognises ids', () => {
    expect(isUuid('0b9e6c1a-1f2d-4c3b-9a8e-7d6c5b4a3f21')).toBe(true)
    expect(isUuid('0b9e6c1a')).toBe(false)
  })
})
