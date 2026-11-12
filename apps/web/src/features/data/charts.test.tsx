// @vitest-environment jsdom
import '../../test/dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { barPath, niceScale, PairedBarChart, Sparkline } from './charts'
import { trendKeys, trendSummary } from './period-views'

describe('chart scales', () => {
  it('start at zero and end on a round number at or above the data', () => {
    expect(niceScale([58, 62.5])).toEqual({ min: 0, max: 80, ticks: [0, 20, 40, 60, 80] })
    expect(niceScale([0.3])).toEqual({ min: 0, max: 0.3, ticks: [0, 0.1, 0.2, 0.3] })
    expect(niceScale([-120, 300])).toEqual({ min: -200, max: 400, ticks: [-200, 0, 200, 400] })
    expect(niceScale([0])).toMatchObject({ min: 0, ticks: [0, 0.25] })
  })

  it('draw bars square at the baseline and rounded at the data end, both ways', () => {
    expect(barPath(10, 100, 0, 14)).toBe('M10,0H96A4,4 0 0 1 100,4V10A4,4 0 0 1 96,14H10Z')
    expect(barPath(100, 10, 0, 14)).toBe('M100,0H14A4,4 0 0 0 10,4V10A4,4 0 0 0 14,14H100Z')
  })
})

describe('charts', () => {
  it('label each bar with its value and period, and leave out a bar with no value', () => {
    render(
      <PairedBarChart name="Shares" unit="Percent" series={{ a: '2025-02', b: '2025-01' }}
        rows={[{ key: 'k', label: 'Customer share', a: { value: '62.50', text: '62.50 %' }, b: null }]} />,
    )
    const chart = screen.getByRole('group', { name: 'Shares' })
    expect(chart.textContent).toContain('62.50 % (2025-02)')
    expect(chart.textContent).not.toContain('(2025-01)')
    expect(chart.querySelectorAll('path.chart-bar')).toHaveLength(1)
  })

  it('hide the sparkline from assistive technology and draw it only for two or more values', () => {
    const { container, rerender } = render(<Sparkline values={['1', '2']} />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    rerender(<Sparkline values={['1']} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})

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
