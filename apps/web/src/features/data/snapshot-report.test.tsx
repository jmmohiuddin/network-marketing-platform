// @vitest-environment jsdom
import '../../test/dom'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { json } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { SnapshotReport } from './snapshot-report'
import { callsOf, fetchRoutes, withSession } from './test-support'
import { POLL_INTERVAL_MS } from '../../lib/use-resource'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const search = vi.hoisted(() => ({ value: '' }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/compliance/snapshots/s1', useSearchParams: () => new URLSearchParams(search.value) }))

const NOTICE = 'Indicator figures computed from loaded historical data. They describe past periods and are not income projections or potential earnings.'
const figure = (key: string, unit: string, value: string | null, extra: object = {}) => ({
  id: `R5.2025.${key}`, key, unit, value, numerator: null, denominator: null, population: 'All participants of an earning type, including those who earned nothing',
  population_count: 4, method: `Method of ${key}.`, method_version: 'cpl-method-1.0.0', note: null, rows: '', ...extra,
})
const SNAPSHOT = {
  id: 's1', state: 'ready', market_id: 'mk', market: { id: 'mk', code: 'DE', name: 'Germany' }, period_from: '2025-01', period_to: '2025-12', method_version: 'cpl-method-1.0.0', failure_reason: null,
  created_at: '2026-11-01T10:00:00Z', reports: ['R1', 'R5'], input_batch_ids: ['b1'], input_mapping_versions: [3],
  input_data_quality: [{ batch_id: 'b1', data_quality: { orders: 40, orders_unknown_purpose: 2, refunded_orders: 0, refunds_without_month: 0, payout_lines: 9, payout_lines_without_source_order: 0, payout_lines_unknown_source_kind: 0, unmapped: { purposes: [], source_kinds: [] } } }],
  results: [
    { report: 'R1', period: '2025-01', period_kind: 'month', partial: false, notes: [], figures: [{ ...figure('customer_share_pct', 'percent', '62.50', { numerator: '10000', denominator: '16000' }), id: 'R1.2025-01.customer_share_pct' }], omitted: [] },
    {
      report: 'R5', period: '2025', period_kind: 'year', partial: true, notes: ['Partial year: fewer than 12 months of payout data. Not publishable.'],
      figures: [figure('count', 'count', '4'), figure('median', 'currency', '14.30'), figure('bands.0 or less', 'count', '2')],
      omitted: [{ key: 'p99', reason: 'Not stated for so small a population.' }],
    },
  ],
}

describe('SnapshotReport', () => {
  afterEach(() => vi.useRealTimers())

  it('polls while the snapshot is computing, then shows R1 with its method and the notice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let polls = 0
    const fetchMock = fetchRoutes(['GET', /^\/v1\/compliance\/snapshots\/s1$/, () => json(200, {
      data: ++polls === 1 ? { ...SNAPSHOT, state: 'computing', results: [] } : SNAPSHOT, meta: { notice: NOTICE },
    })])
    renderWithProviders(withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read']), fetchMock)
    expect(await screen.findByText(/The reports are being computed/)).toBeTruthy()
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(await screen.findByRole('heading', { name: 'Customer share of net sales' })).toBeTruthy()
    expect(screen.getByText('62.50 %')).toBeTruthy()
    expect(screen.getByText(/^Indicator figures computed from loaded historical data/)).toBeTruthy()
    expect(screen.getByText('2 of 40 orders have an unknown purpose')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the rows behind this figure' }).getAttribute('href'))
      .toBe('/compliance/snapshots/s1/rows?figure=R1.2025-01.customer_share_pct')
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2))
    expect(callsOf(fetchMock)).toHaveLength(2)
  })

  it('states the whole R5 population, the partial year and indicators not computed', async () => {
    search.value = 'report=R5'
    renderWithProviders(withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read']), fetchRoutes(['GET', /snapshots\/s1$/, () => json(200, { data: SNAPSHOT, meta: { notice: NOTICE } })]))
    expect(await screen.findByText('Population: 4 participants of an earning type enrolled by the year end, including 2 whose earnings were zero or less.')).toBeTruthy()
    expect(screen.getByText('Partial year, not publishable')).toBeTruthy()
    // The unit sits beside the hero number, not inside it (BUG-036).
    const median = screen.getByRole('article', { name: 'Median earnings in the year' })
    expect(within(median).getByText('14.30').className).toContain('font-data-mono-lg')
    expect(within(median).getByText('currency units').className).not.toContain('font-data-mono-lg')
    expect(screen.getByText('99th percentile of earnings in the year: Not stated for so small a population.')).toBeTruthy()
  })

  it('marks an outdated snapshot and keeps the selected report in the URL', async () => {
    search.value = ''
    const user = userEvent.setup()
    renderWithProviders(withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read']), fetchRoutes(['GET', /snapshots\/s1$/, () => json(200, { data: { ...SNAPSHOT, state: 'outdated' }, meta: { notice: NOTICE } })]))
    expect(await screen.findByText(/Its figures are unchanged and still reproducible/)).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'R5 Earnings distribution' }))
    expect(router.replace).toHaveBeenCalledWith('/compliance/snapshots/s1?report=R5')
  })

  it('opens Create snapshot filled in with this snapshot\'s market and months', async () => {
    search.value = ''
    const user = userEvent.setup()
    renderWithProviders(withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read', 'snapshot.create']), fetchRoutes(
      ['GET', /snapshots\/s1$/, () => json(200, { data: { ...SNAPSHOT, state: 'outdated' }, meta: { notice: NOTICE } })],
      ['GET', /^\/v1\/markets$/, () => json(200, { data: [{ id: 'mk', code: 'DE', name: 'Germany', currency: 'EUR' }], meta: {} })],
    ))
    expect(within(await screen.findByRole('region', { name: 'Method and inputs' })).getByText('cpl-method-1.0.0')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }))
    const dialog = screen.getByRole('dialog', { name: 'Create snapshot' })
    await within(dialog).findByRole('option', { name: 'Germany (DE)' })
    expect((within(dialog).getByLabelText('Market') as HTMLSelectElement).value).toBe('DE')
    expect((within(dialog).getByLabelText('Last month') as HTMLInputElement).value).toBe('2025-12')
  })

  const r1 = (period: string, value: string) => ({
    report: 'R1', period, period_kind: 'month', partial: false, notes: [], omitted: [],
    figures: [{ ...figure('customer_share_pct', 'percent', value, { numerator: '600', denominator: '1000' }), id: `R1.${period}.customer_share_pct` }],
  })
  const threeMonths = { ...SNAPSHOT, results: [r1('2025-01', '62.50'), r1('2025-02', '58.00'), r1('2025-03', '60.00')] }
  const showThreeMonths = () => renderWithProviders(
    withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read']),
    fetchRoutes(['GET', /snapshots\/s1$/, () => json(200, { data: threeMonths, meta: {} })]),
  )

  it('names the market and charts the trend of a monthly figure, with its table one toggle away', async () => {
    search.value = ''
    const user = userEvent.setup()
    showThreeMonths()
    expect(await screen.findByRole('heading', { level: 1, name: 'Snapshot · Germany (DE) · 2025-01 to 2025-12' })).toBeTruthy()
    const chart = screen.getByRole('figure', { name: 'Customer share of net sales by period' })
    expect(within(chart).getByText('Lowest 58.00 % (2025-02), highest 62.50 % (2025-01), latest 60.00 % (2025-03).')).toBeTruthy()
    expect(within(chart).getByRole('group', { name: 'Customer share of net sales, by period' })).toBeTruthy()
    const point = within(chart).getByRole('img', { name: '2025-01: 62.50 %' })
    act(() => point.focus())
    expect(within(chart).getByText('62.50 % in 2025-01')).toBeTruthy()
    await user.click(within(chart).getByRole('button', { name: 'View as table' }))
    const table = within(chart).getByRole('table', { name: 'Customer share of net sales in each period' })
    const row = within(table).getByText('2025-02').closest('tr')!
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['58.00 %', '600', '1,000'])
    expect(within(chart).getByRole('button', { name: 'View as table' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens on the latest period only, with the trend for the history (BUG-033)', async () => {
    search.value = ''
    showThreeMonths()
    expect(await screen.findByRole('region', { name: 'R1 · 2025-03' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'R1 · 2025-01' })).toBeNull()
    expect(screen.getAllByRole('article', { name: 'Customer share of net sales' })).toHaveLength(1)
    expect((screen.getByLabelText('Period') as HTMLSelectElement).value).toBe('2025-03')
    expect(screen.queryByRole('option', { name: 'All periods' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Trend' })).toBeTruthy()
  })

  it('keeps the chosen period in the URL', async () => {
    search.value = ''
    const user = userEvent.setup()
    showThreeMonths()
    await user.selectOptions(await screen.findByLabelText('Period'), '2025-02')
    expect(router.replace).toHaveBeenCalledWith('/compliance/snapshots/s1?report=R1&period=2025-02')
  })

  it('compares two periods with the exact difference and shows only the chosen period', async () => {
    search.value = 'report=R1&period=2025-03&compare=2025-01'
    showThreeMonths()
    const section = await screen.findByRole('region', { name: 'Compare 2025-03 with 2025-01' })
    const table = within(section).getByRole('table', { name: '1 figure in 2025-03 and 2025-01' })
    const row = within(table).getByText('Customer share of net sales').closest('tr')!
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['60.00 %', '62.50 %', '\u22122.50 points'])
    expect(within(section).getByRole('group', { name: 'Percentages in 2025-03 and 2025-01' })).toBeTruthy()
    expect(within(section).getByText('60.00 % (2025-03)')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'R1 · 2025-03' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'R1 · 2025-01' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Trend' })).toBeNull()
  })

  const r = (report: string, period: string, kind: string, figures: object[]) => ({ report, period, period_kind: kind, partial: false, notes: [], omitted: [], figures })
  const at = (report: string, period: string, key: string, unit: string, value: string, extra: object = {}) =>
    ({ ...figure(key, unit, value, extra), id: `${report}.${period}.${key}` })
  const drawn = {
    ...SNAPSHOT, reports: ['R1', 'R3', 'R5'],
    results: [
      r('R1', '2025-12', 'month', [
        at('R1', '2025-12', 'net_sales_cents', 'minor', '1000', { numerator: '1000' }),
        at('R1', '2025-12', 'customer_share_pct', 'percent', '60.00', { numerator: '600', denominator: '1000' }),
        at('R1', '2025-12', 'customer_plus_declared_resale_pct', 'percent', '75.00', { numerator: '750', denominator: '1000' }),
      ]),
      r('R3', '2025-12', 'month', [
        at('R3', '2025-12', 'gross_cents', 'minor', '800', { numerator: '800' }),
        at('R3', '2025-12', 'share_pct.retail_sale', 'percent', '75.00', { numerator: '600', denominator: '800' }),
        at('R3', '2025-12', 'share_pct.downline_volume', 'percent', '25.00', { numerator: '200', denominator: '800' }),
      ]),
      r('R5', '2025', 'year', [
        at('R5', '2025', 'count', 'count', '3', { numerator: '3' }),
        at('R5', '2025', 'bands.0 or less', 'count', '2', { numerator: '2', denominator: '3' }),
        at('R5', '2025', 'bands.0.01-100', 'count', '1', { numerator: '1', denominator: '3' }),
      ]),
    ],
  }
  const showDrawn = (report: string) => {
    search.value = `report=${report}`
    renderWithProviders(withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read']), fetchRoutes(['GET', /snapshots\/s1$/, () => json(200, { data: drawn, meta: {} })]))
  }

  it('draws the R1 net sales split by buyer from the figures\' numerators (BUG-032)', async () => {
    showDrawn('R1')
    const card = await screen.findByRole('article', { name: 'Net sales by buyer' })
    expect(within(card).getByRole('img').getAttribute('aria-label'))
      .toBe('Net sales by buyer: End-customer buyers 60.00 %, Participant orders declared as resale 15.00 %, Other participant orders 25.00 %')
    expect(within(card).getByText(`${(150).toLocaleString()} minor units (15.00 %)`)).toBeTruthy()
    expect(card.querySelectorAll('rect')).toHaveLength(3)
  })

  it('lists R3 payouts by source kind in a table instead of one card per share (BUG-032)', async () => {
    showDrawn('R3')
    const table = await screen.findByRole('table', { name: 'Payouts by source kind, 2025-12' })
    const row = within(table).getByRole('link', { name: /^Retail sale: open the rows/ }).closest('tr')!
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['600', '75.00 %'])
    expect(within(table).getByRole('link', { name: /^Retail sale/ }).getAttribute('href')).toBe('/compliance/snapshots/s1/rows?figure=R3.2025-12.share_pct.retail_sale')
    expect(screen.queryByRole('article', { name: 'Share of payouts from retail sale' })).toBeNull()
    expect(screen.getByRole('article', { name: 'Payouts excluding clawbacks' })).toBeTruthy()
  })

  it('draws R5 participants per earnings band with their exact share (BUG-032)', async () => {
    showDrawn('R5')
    const card = await screen.findByRole('article', { name: 'Participants by yearly earnings' })
    expect(within(card).getByText('66.67 % (2)')).toBeTruthy()
    expect(within(card).getByRole('img', { name: 'Participants with earnings 0.01-100: 1, 33.33 %' })).toBeTruthy()
    expect(within(card).getByRole('link', { name: /^0 or less: open the rows/ }).getAttribute('href')).toBe('/compliance/snapshots/s1/rows?figure=R5.2025.bands.0%20or%20less')
    expect(screen.queryByRole('article', { name: 'Participants with earnings 0 or less' })).toBeNull()
  })
})
