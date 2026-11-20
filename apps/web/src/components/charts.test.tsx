// @vitest-environment jsdom
import '../test/dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { barPath, ChartCard, MeterBar, niceScale, PairedBarChart, Sparkline, xLabelIndices } from './charts'

describe('chart scales', () => {
  it('start at zero and end on a round number at or above the data', () => {
    expect(niceScale([58, 62.5])).toEqual({ min: 0, max: 80, ticks: [0, 20, 40, 60, 80] })
    expect(niceScale([0.3])).toEqual({ min: 0, max: 0.3, ticks: [0, 0.1, 0.2, 0.3] })
    expect(niceScale([-120, 300])).toEqual({ min: -200, max: 400, ticks: [-200, 0, 200, 400] })
    expect(niceScale([0])).toMatchObject({ min: 0, ticks: [0, 0.25] })
  })

  it('label the x axis back from the last period, so neighbours never print on top of each other (BUG-035)', () => {
    // 12 months on the default 416 px plot: room for 6 labels, every second one ending on the last.
    expect([...xLabelIndices(12, 416)]).toEqual([1, 3, 5, 7, 9, 11])
    // A phone-width plot: only every sixth label, still ending on the last.
    expect([...xLabelIndices(12, 182)]).toEqual([5, 11])
    expect([...xLabelIndices(3, 416)]).toEqual([0, 1, 2])
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
    expect(chart.querySelectorAll('path[data-series]')).toHaveLength(1)
  })

  it('hide the sparkline from assistive technology and draw it only for two or more values', () => {
    const { container, rerender } = render(<Sparkline values={['1', '2']} />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    rerender(<Sparkline values={['1']} />)
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('ChartCard', () => {
  it('switches between the chart and its table, the button naming the view it opens', async () => {
    const user = userEvent.setup()
    render(<ChartCard title="Customer share" summary="Latest 62.50 %." table={<table aria-label="Customer share values" />}><svg role="img" aria-label="Customer share chart" /></ChartCard>)
    expect(screen.getByRole('heading', { level: 3, name: 'Customer share' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Customer share chart' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'View as table' }))
    expect(screen.getByRole('table', { name: 'Customer share values' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Customer share chart' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'View as chart' }))
    expect(screen.getByRole('img', { name: 'Customer share chart' })).toBeTruthy()
  })
})

describe('MeterBar', () => {
  it('draws the share as an SVG width (no style attribute) and clamps it to 0..100', () => {
    const { container, rerender } = render(<MeterBar percent={62.5} label="Retail share 62.50 %" />)
    const bar = screen.getByRole('img', { name: 'Retail share 62.50 %' })
    expect(bar.querySelectorAll('rect')[1]?.getAttribute('width')).toBe('62.5%')
    expect(container.querySelector('[style]')).toBeNull()
    rerender(<MeterBar percent={140} label="Over" />)
    expect(screen.getByRole('img', { name: 'Over' }).querySelectorAll('rect')[1]?.getAttribute('width')).toBe('100%')
  })
})
