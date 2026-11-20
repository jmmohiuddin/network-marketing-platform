// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { LedgerPage } from '../ledger/ledger-page'
import { OverviewPage } from './overview-page'
import type { Definition, ExecutiveDashboard, ExecutiveRow, FinanceDashboard } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/overview',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const M = '00000000-0000-4000-8000-0000000000d1'
const AT = '00000000-0000-4000-8000-0000000000d2'
const P1 = '00000000-0000-4000-8000-0000000000a1'
const P2 = '00000000-0000-4000-8000-0000000000a2'
const MARKET = { id: M, code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const CAL = { id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: M, code: 'DE' }, plan: null }
const period = (id: string, starts: string, ends: string, state: string) => ({
  id, calendar_id: 'cal1', starts_at: starts, ends_at: ends, cut_off_passed: true, state, committed_run_id: 'r1', latest_run: null, blockers: [], late: { pending: 0, decided: 0 },
})
const PERIODS = [period(P2, '2026-08-31T22:00:00.000Z', '2026-09-30T22:00:00.000Z', 'committed'), period(P1, '2026-07-31T22:00:00.000Z', '2026-08-31T22:00:00.000Z', 'paid')]
const EXEC = adminMe({ permissions: ['dashboard.exec', 'period.read', 'compliance.read', 'plan.read'], roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Executive read-only', market_ids: null }] })

const ROW: ExecutiveRow = {
  market: { id: M, code: 'DE', currency: 'EUR', minor_unit: 2 }, calendar_id: 'cal1',
  period: { id: P2, starts_at: PERIODS[0]!.starts_at, ends_at: PERIODS[0]!.ends_at, state: 'committed' }, run_id: 'r1',
  net_sales_minor: '1000000', payout_minor: '250000', payout_share_pct: '25.00', active_earners: 14,
  retail_share_pct: null, retail_share_reason: 'no_snapshot', retail_snapshot_id: null, partial: false, partial_reasons: [],
}
// The API's catalogue words (rpt/definitions.ts), so the TS-53 scan reads what users read.
const DEFINITIONS: Definition[] = [
  { key: 'net_sales_minor', label: 'Net sales', definition: 'Order amounts credited in the period, minus money returned to buyers by refunds, returns, chargebacks, cancellations and exchanges that occurred in it, plus chargebacks reversed in it. Minor units.', source: 'sales_order.amount_minor by credited_at; order_event.refund_minor by occurred_at' },
  { key: 'payout_minor', label: 'Commission payout', definition: 'Gross of the period\'s committed run. Committed data only: the period is committed, paid or closed.', source: 'run.totals.gross_minor' },
  { key: 'payout_share_pct', label: 'Payout as share of sales', definition: 'Commission payout over net sales, in percent, rounded half up to 2 decimals; empty when net sales are zero or less.', source: 'payout_minor / net_sales_minor' },
  { key: 'active_earners', label: 'Active earners', definition: 'Payees of the committed run with a gross amount above zero.', source: 'run_settlement.gross_minor > 0' },
  { key: 'retail_share_pct', label: 'Retail share', definition: 'Net sales to end customers over net sales, from the newest ready compliance snapshot that covers the month the period starts in.', source: 'compliance figure R1 customer_share_pct' },
  { key: 'partial', label: 'Order sync behind', definition: 'An order source of the market is behind or failing, so the period may lack orders.', source: 'integrations sync health (the run gate\'s evaluation)' },
]
const TREND: ExecutiveDashboard['trend'] = [
  { period: { id: P1, starts_at: PERIODS[1]!.starts_at, ends_at: PERIODS[1]!.ends_at }, net_sales_minor: '800000', payout_minor: '200000', payout_share_pct: '25.00', active_earners: 12 },
  { period: { id: P2, starts_at: PERIODS[0]!.starts_at, ends_at: PERIODS[0]!.ends_at }, net_sales_minor: '1000000', payout_minor: '250000', payout_share_pct: '25.00', active_earners: 14 },
]

function routes(dashboard: (query: URLSearchParams) => Response) {
  return fetchByRoute({
    'GET /v1/markets': () => ok([MARKET, { ...MARKET, id: AT, code: 'AT', name: 'Austria' }]),
    'GET /v1/periods': () => json(200, { data: { calendars: [CAL], periods: PERIODS }, meta: { next_cursor: null } }),
    'GET /v1/dashboards/executive': dashboard,
  })
}
const answer = (data: ExecutiveDashboard) => json(200, { data, meta: { definitions: DEFINITIONS } })


beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockReset()
})

describe('OverviewPage (SC-35)', () => {
  it('shows the five figures of one market with keyboard-opened definitions and the no-snapshot retail share', async () => {
    renderAs(EXEC, <OverviewPage />, routes(() => answer({ rows: [ROW] })))
    const kpis = await screen.findByTestId('kpis')
    expect(kpis.textContent).toContain('Net sales10,000.00 EUR')
    expect(kpis.textContent).toContain('Commission paid2,500.00 EUR')
    expect(kpis.textContent).toContain('Payout share of sales25.00 %')
    expect(kpis.textContent).toContain('Active earners14')
    expect(kpis.textContent).toContain('No compliance snapshot for this period')
    expect(within(kpis).getByRole('link', { name: 'Open compliance reports' }).getAttribute('href')).toBe('/compliance')
    const button = within(kpis).getByRole('button', { name: 'Definition of Active earners' })
    const note = within(kpis).getByText(/Payees of the committed run/).closest('[role="note"]')!
    expect(note.hasAttribute('hidden')).toBe(true)
    await userEvent.tab()
    while (document.activeElement !== button) await userEvent.tab()
    expect(note.hasAttribute('hidden')).toBe(false)
    await userEvent.keyboard('{Escape}')
    expect(note.hasAttribute('hidden')).toBe(true)
    const table = screen.getByRole('table', { name: 'Markets and their finished period' })
    expect(table.textContent).toContain('DE')
    expect(table.textContent).toContain('No snapshot')
    expect(screen.queryByText(/Last .* finished period/)).toBeNull() // the trend needs one market chosen
  })

  it('shows the trend of a chosen market with its table twin and offers its finished periods', async () => {
    navigation.search = `market=${M}`
    const fetchMock = routes(() => answer({ rows: [ROW], trend: TREND }))
    renderAs(EXEC, <OverviewPage />, fetchMock)
    const chart = await screen.findByRole('figure', { name: 'Last 2 finished periods of DE' })
    expect(within(chart).getByRole('img', { name: /net sales in EUR as bars, payout share of sales in percent as a line/ })).toBeTruthy()
    await userEvent.click(within(chart).getByRole('button', { name: 'View as table' }))
    const twin = within(chart).getByRole('table', { name: 'Finished periods of DE' })
    expect(within(chart).getByRole('button', { name: 'View as chart' })).toBeTruthy() // BUG-127
    expect(screen.getAllByRole('heading').map((h) => h.tagName)).toEqual(['H1', 'H2', 'H2'])
    expect(twin.textContent).toContain('8,000.00')
    expect(twin.textContent).toContain('2,500.00')
    expect(callsTo(fetchMock, 'GET', '/v1/dashboards/executive')[0]![0]).toContain(`market_id=${M}`)
    const select = screen.getByLabelText('Period')
    expect(within(select).getAllByRole('option')).toHaveLength(3)
    await userEvent.selectOptions(select, P1)
    expect(navigation.router.replace).toHaveBeenCalledWith(`/overview?market=${M}&period=${P1}`)
  })

  it('labels each trend period by its month in the calendar zone, not the UTC month of its start', async () => {
    navigation.search = `market=${M}`
    renderAs(EXEC, <OverviewPage />, routes(() => answer({ rows: [ROW], trend: TREND })))
    const chart = await screen.findByRole('figure', { name: 'Last 2 finished periods of DE' })
    const labels = [...chart.querySelectorAll('svg text')].map((text) => text.textContent)
    // P2 starts 2026-08-31T22:00Z, which is 1 September in Berlin.
    expect(labels).toContain('Sep 2026')
    expect(labels).toContain('Aug 2026')
    expect(labels).not.toContain('2026-08')
  })

  it('sends the linked period at once, also without read access to periods', async () => {
    navigation.search = `market=${M}&period=${P1}`
    const fetchMock = routes(() => answer({ rows: [{ ...ROW, period: { ...ROW.period, id: P1 } }] }))
    renderAs(adminMe({ permissions: ['dashboard.exec'] }), <OverviewPage />, fetchMock)
    await screen.findByTestId('kpis')
    const calls = callsTo(fetchMock, 'GET', '/v1/dashboards/executive')
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toContain(`period_id=${P1}`)
  })

  it('closes a definition opened by mouse on a second click and on a click outside', async () => {
    renderAs(EXEC, <OverviewPage />, routes(() => answer({ rows: [ROW] })))
    const kpis = await screen.findByTestId('kpis')
    const button = within(kpis).getByRole('button', { name: 'Definition of Net sales' })
    const note = document.getElementById(button.getAttribute('aria-controls')!)!
    await userEvent.click(button)
    expect(note.hasAttribute('hidden')).toBe(false)
    await userEvent.click(button)
    expect(note.hasAttribute('hidden')).toBe(true)
    await userEvent.click(button)
    expect(note.hasAttribute('hidden')).toBe(false)
    await userEvent.click(screen.getByRole('heading', { name: 'Executive overview' }))
    expect(note.hasAttribute('hidden')).toBe(true)
  })

  it('names the markets whose order sync is behind in a partial-data banner', async () => {
    const partial = { ...ROW, partial: true, partial_reasons: [{ source: 'api:shop', name: 'Web shop', state: 'behind' }] }
    renderAs(EXEC, <OverviewPage />, routes(() => answer({ rows: [partial, { ...ROW, market: { ...ROW.market, id: AT, code: 'AT' } }] })))
    const banner = await screen.findByText('Some figures may lack orders')
    expect(banner.closest('[role="status"]')!.textContent).toContain('DE: Web shop is behind.')
    expect(screen.queryByTestId('kpis')).toBeNull() // several markets: no figure is summed across currencies
    expect(screen.getByText(/Choose a market to see its figures/)).toBeTruthy()
  })

  it('says when no period is committed yet, and shows a load failure with Try again', async () => {
    renderAs(EXEC, <OverviewPage />, routes(() => answer({ rows: [] })))
    expect(await screen.findByText('No committed period yet')).toBeTruthy()
    renderAs(EXEC, <OverviewPage />, routes(() => apiError(500, 'INTERNAL', 'Something went wrong.')))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('is not available without dashboard.exec', () => {
    renderAs(adminMe({ permissions: ['period.read'] }), <OverviewPage />, routes(() => answer({ rows: [] })))
    expect(screen.getByText('Not found or not available to you')).toBeTruthy()
  })
})

// TS-53 (UI) extended by PLAN B6 §5: no projection, target, ranking, leaderboard or wallet wording on SC-35 and the SC-33 KPI row.
const REFUSED = /project|potential|could earn|estimate|target|streak|leaderboard|top earner|rank(ed)? among|wallet/i

describe('TS-53 refused words on SC-35 and the SC-33 KPI row', () => {
  it('SC-35 with every definition open', async () => {
    navigation.search = `market=${M}`
    const partial = { ...ROW, partial: true, partial_reasons: [{ source: 'api:shop', name: 'Web shop', state: 'failing' }] }
    renderAs(EXEC, <OverviewPage />, routes(() => answer({ rows: [partial], trend: TREND })))
    await screen.findByTestId('kpis')
    // textContent includes the closed popovers' definitions: the scan reads every word a user can open.
    expect(document.body.textContent).not.toMatch(REFUSED)
  })

  it('SC-33 KPI row with every definition open', async () => {
    navigation.search = `market=${M}`
    const finance: FinanceDashboard = {
      market: { id: M, code: 'DE', currency: 'EUR', minor_unit: 2 }, payables_minor: '2900', in_transit_minor: '0', receivables_minor: '0',
      withholding_minor: '0', failed_payouts: { count: 1, amount_minor: '500' },
    }
    const balance = (key: string, label: string, type: string) => ({ key, label, definition: `Balance of every ${type} account of the market (normal side). Minor units.`, source: `ledger accounts of type ${type}` })
    const definitions = [
      balance('payables_minor', 'Payables', 'payee_payable'), balance('in_transit_minor', 'In transit', 'payout_in_transit'),
      balance('receivables_minor', 'Receivables', 'clawback_receivable'), balance('withholding_minor', 'Withholding', 'withholding_payable'),
      { key: 'failed_payouts', label: 'Failed payouts', definition: 'Payout instructions that failed and that no later instruction retries; count and amount in minor units.', source: 'payout_instruction state failed, retry_of' },
    ]
    const financeReader = adminMe({ permissions: ['ledger.read'], roles: [{ assignment_id: 'a1', role_id: 'r1', name: 'Finance approver', market_ids: null }] })
    renderAs(financeReader, <LedgerPage />, fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/ledger/summary': () => ok({ market: { id: M, code: 'DE', currency: 'EUR', minor_digits: 2 }, by_type: [], balanced: true, entry_count: 0 }),
      'GET /v1/dashboards/finance': () => json(200, { data: finance, meta: { definitions } }),
      'GET /v1/ledger/entries': () => json(200, { data: [], meta: { next_cursor: null } }),
      'GET /v1/saved-views': () => ok([]),
    }))
    const kpis = await screen.findByTestId('kpis')
    await vi.waitFor(() => expect(kpis.textContent).toContain('1 payout not retried'))
    expect(kpis.textContent).toContain('no later instruction retries')
    expect(kpis.textContent).not.toMatch(REFUSED)
  })
})
