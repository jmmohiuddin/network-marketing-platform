import { describe, expect, test } from 'vitest'
import { changedKeys, rebaseTimeline, valueSince, type ChainRow } from './timeline.js'

const at = (iso: string) => new Date(iso)
const row = (version: number, iso: string, settings: Record<string, unknown>, approvalId: string | null = null): ChainRow =>
  ({ id: `v${version}`, version, effectiveFrom: at(iso), settings, approvalId, reason: `r${version}` })

describe('rebaseTimeline (T-B1-05)', () => {
  test('an empty chain: the change becomes the first version on an empty base', () => {
    const rows = rebaseTimeline([], { effectiveFrom: at('2026-11-17T00:00:00Z'), patch: { t: 1 }, reason: 'first', approvalId: null }, 1)

    expect(rows).toEqual([{ version: 1, effectiveFrom: at('2026-11-17T00:00:00Z'), settings: { t: 1 }, approvalId: null, reason: 'first', rebases: null }])
  })

  test('a change after every row applies to the latest row and rebases nothing', () => {
    const chain = [row(1, '2026-01-01T00:00:00Z', { t: 1, m: 'half_up' })]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-17T00:00:00Z'), patch: { t: 2 }, reason: 'raise', approvalId: null }, 2)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.settings).toEqual({ t: 2, m: 'half_up' })
  })

  test('AC-TEN3-4: an immediate change keeps a scheduled later version, which now carries the new value too', () => {
    const chain = [row(1, '2026-01-01T00:00:00Z', { t: 1 }), row(2, '2026-12-01T00:00:00Z', { t: 1, m: 'half_even' }, 'ap-1')]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-17T00:00:00Z'), patch: { t: 5 }, reason: 'now', approvalId: null }, 3)

    expect(rows).toEqual([
      { version: 3, effectiveFrom: at('2026-11-17T00:00:00Z'), settings: { t: 5 }, approvalId: null, reason: 'now', rebases: null },
      { version: 4, effectiveFrom: at('2026-12-01T00:00:00Z'), settings: { t: 5, m: 'half_even' }, approvalId: 'ap-1', reason: 'Rebased v2 onto v3: r2', rebases: 'v2' },
    ])
  })

  test('a later row that set the same key keeps its own value (its delta wins from its date)', () => {
    const chain = [row(1, '2026-01-01T00:00:00Z', { t: 1 }), row(2, '2026-12-01T00:00:00Z', { t: 9 })]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-17T00:00:00Z'), patch: { t: 5, u: 1 }, reason: 'now', approvalId: null }, 3)

    expect(rows.map((r) => r.settings)).toEqual([{ t: 5, u: 1 }, { t: 9, u: 1 }])
  })

  test('several later rows rebase in order, each on the previous new row', () => {
    const chain = [
      row(1, '2026-01-01T00:00:00Z', { a: 1 }),
      row(2, '2026-12-01T00:00:00Z', { a: 1, b: 2 }),
      row(3, '2027-01-01T00:00:00Z', { a: 3, b: 2 }),
    ]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-20T00:00:00Z'), patch: { c: 7 }, reason: 'c', approvalId: null }, 4)

    expect(rows.map((r) => [r.version, r.settings, r.rebases])).toEqual([
      [4, { a: 1, c: 7 }, null],
      [5, { a: 1, b: 2, c: 7 }, 'v2'],
      [6, { a: 3, b: 2, c: 7 }, 'v3'],
    ])
  })

  test('a later row that already holds the rebased settings is not appended again', () => {
    const chain = [row(1, '2026-01-01T00:00:00Z', { a: 1 }), row(2, '2026-12-01T00:00:00Z', { a: 2 })]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-20T00:00:00Z'), patch: { a: 2 }, reason: 'a', approvalId: null }, 3)

    expect(rows).toHaveLength(1)
  })

  test('a no-op later row is still rebased when the new values differ from it (it must not undo the change)', () => {
    const chain = [row(1, '2026-01-01T00:00:00Z', { a: 1 }), row(2, '2026-12-01T00:00:00Z', { a: 1 })]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-20T00:00:00Z'), patch: { a: 2 }, reason: 'a', approvalId: null }, 3)

    expect(rows.map((r) => [r.effectiveFrom.toISOString(), r.settings])).toEqual([
      ['2026-11-20T00:00:00.000Z', { a: 2 }],
      ['2026-12-01T00:00:00.000Z', { a: 2 }],
    ])
  })

  test('a change at the same instant as a chain row supersedes it and rebases only the rows after', () => {
    const chain = [row(1, '2026-12-01T00:00:00Z', { a: 1 }), row(2, '2027-01-01T00:00:00Z', { a: 1, b: 1 })]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-12-01T00:00:00Z'), patch: { a: 2 }, reason: 'a', approvalId: 'ap' }, 3)

    expect(rows.map((r) => [r.version, r.settings, r.approvalId])).toEqual([[3, { a: 2 }, 'ap'], [4, { a: 2, b: 1 }, null]])
  })

  test('a key a later row removed stays removed after the rebase', () => {
    const chain = [row(1, '2026-01-01T00:00:00Z', { a: 1, gone: true }), row(2, '2026-12-01T00:00:00Z', { a: 1 })]

    const rows = rebaseTimeline(chain, { effectiveFrom: at('2026-11-20T00:00:00Z'), patch: { c: 1 }, reason: 'c', approvalId: null }, 3)

    expect(rows.map((r) => r.settings)).toEqual([{ a: 1, gone: true, c: 1 }, { a: 1, c: 1 }])
  })
})

describe('valueSince (BUG-025)', () => {
  const chain = [
    row(1, '2026-01-01T00:00:00Z', { t: 1 }),
    row(2, '2026-02-01T00:00:00Z', { t: 1, u: 1 }),
    row(3, '2026-03-01T00:00:00Z', { t: 2, u: 1 }),
    row(4, '2026-12-01T00:00:00Z', { t: 2, u: 2 }),
  ]

  test('the start of the uninterrupted run of the current value, not the latest version', () => {
    expect(valueSince(chain, 't', at('2026-11-17T00:00:00Z'))).toEqual({ version: 3, effective_from: at('2026-03-01T00:00:00Z') })
    expect(valueSince(chain, 'u', at('2026-11-17T00:00:00Z'))).toEqual({ version: 2, effective_from: at('2026-02-01T00:00:00Z') })
    expect(valueSince(chain, 'u', at('2026-12-02T00:00:00Z'))).toEqual({ version: 4, effective_from: at('2026-12-01T00:00:00Z') })
  })

  test('null when the key is unset or nothing is in force yet', () => {
    expect(valueSince(chain, 'missing', at('2026-11-17T00:00:00Z'))).toBeNull()
    expect(valueSince(chain, 't', at('2025-01-01T00:00:00Z'))).toBeNull()
  })

  test('changedKeys compares deeply and counts added and removed keys', () => {
    expect(changedKeys({ a: { x: 1 }, b: 1 }, { a: { x: 1 }, c: 1 })).toEqual(['b', 'c'])
  })
})
