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
  id: 's1', state: 'ready', market_id: 'mk', period_from: '2025-01', period_to: '2025-12', method_version: 'cpl-method-1.0.0', failure_reason: null,
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
    expect(screen.getByText('14.30 currency units')).toBeTruthy()
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

  it('names the market in the title and compares the periods of a report side by side', async () => {
    search.value = ''
    const r1 = (period: string, value: string) => ({
      report: 'R1', period, period_kind: 'month', partial: false, notes: [], omitted: [],
      figures: [{ ...figure('customer_share_pct', 'percent', value), id: `R1.${period}.customer_share_pct` }],
    })
    const twoMonths = { ...SNAPSHOT, results: [r1('2025-01', '62.50'), r1('2025-02', '58.00')] }
    renderWithProviders(withSession(<SnapshotReport snapshotId="s1" />, ['compliance.read']), fetchRoutes(['GET', /snapshots\/s1$/, () => json(200, { data: twoMonths, meta: {} })]))
    expect(await screen.findByRole('heading', { level: 1, name: 'Snapshot · market mk · 2025-01 to 2025-12' })).toBeTruthy()
    const table = screen.getByRole('table', { name: '1 figures across 2 periods' })
    const row = within(table).getByText('Customer share of net sales').closest('tr')!
    expect([...row.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['62.50 %', '58.00 %'])
  })
})
