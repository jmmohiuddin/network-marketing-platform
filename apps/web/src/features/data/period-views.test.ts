import { describe, expect, it } from 'vitest'
import { trendKeys, trendSummary } from './period-views'

describe('trend helpers', () => {
  const result = (period: string, value: string | null) => ({
    report: 'R1' as const, period, period_kind: 'month' as const, partial: false, notes: [], omitted: [],
    figures: [{ id: `R1.${period}.a`, key: 'a', unit: 'percent' as const, value, numerator: null, denominator: null, population: null, population_count: null, method: null, method_version: null, note: null }],
  })

  it('offer only figures stated in two periods or more', () => {
    expect(trendKeys([result('2025-01', '1'), result('2025-02', null)])).toEqual([])
    expect(trendKeys([result('2025-01', '1'), result('2025-02', '2')])).toEqual(['a'])
  })

  it('summarise lowest, highest and latest by exact comparison', () => {
    const point = (label: string, value: string) => ({ label, value, text: `${value} %`, short: value })
    expect(trendSummary([point('2025-01', '9.5'), point('2025-02', '10.25'), point('2025-03', '10.0')]))
      .toBe('Lowest 9.5 % (2025-01), highest 10.25 % (2025-02), latest 10.0 % (2025-03).')
  })
})
