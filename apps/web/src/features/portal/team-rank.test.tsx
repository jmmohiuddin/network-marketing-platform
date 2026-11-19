// @vitest-environment jsdom
import '../../test/dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { callsTo, fetchByRoute } from '../admin/test-support'
import { CustomerPage, CustomersPage } from './customers'
import { EarningsPage } from './earnings'
import { PortalHome } from './home'
import { RankPage } from './rank'
import { StatementPage } from './statement'
import { TeamPage } from './team'
import { CHILD, CUSTOMER, page, portalMe, POSITION, renderPortal, RUN, statement, SUMMARY } from './test-support'
import type { RankStatus, TeamView } from './types'

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => '/portal/team',
  useSearchParams: () => nav.params,
}))

const PERIOD = { id: 'per-3', starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z' }
const OPEN_PERIOD = { id: 'per-4', starts_at: '2026-09-01T00:00:00.000Z', ends_at: '2026-10-01T00:00:00.000Z' }

const RANK: RankStatus = {
  position: { id: POSITION, position_ref: 'DE-A-1' },
  periods: [
    { period: OPEN_PERIOD, run_id: null, final: false, paid_as: [{ ladder: 'main', rank: 'Gold' }], titles: [{ ladder: 'main', rank: 'Gold' }], grace_used: null, measures: [{ measure: 'pv', value: '30000' }] },
    { period: PERIOD, run_id: RUN, final: true, paid_as: [{ ladder: 'main', rank: 'Silver' }], titles: [{ ladder: 'main', rank: 'Silver' }], grace_used: [], measures: [{ measure: 'pv', value: '46000' }] },
  ],
  requirements: [{
    ladder: 'main', rank: 'Silver', status: 'held',
    items: [
      { kind: 'measure', text: 'pv at least 200.00', measure: 'pv', required: '20000', measured: '46000', met: true },
      { kind: 'measure', text: 'gv at least 1000.00', measure: 'gv', required: '100000', measured: '50000', met: false },
      { kind: 'legs', text: '2 sponsor legs at main Bronze or higher', required: '2', met: null },
    ],
  }],
  transition_notice: { effective_from: '2027-01-01T00:00:00.000Z' },
}

const TEAM: TeamView = {
  viewer: { position_id: POSITION, position_ref: 'DE-A-1' },
  node: { position_id: POSITION, depth: 0, display_name: 'Dana Example', position_ref: 'DE-A-1', status: 'active' },
  children: [{ position_id: CHILD, depth: 1, display_name: 'Ben Example', position_ref: 'DE-B-1', status: 'active', enrolled_on: '2026-01-02' }],
  hidden_levels: [{ depth: 2, count: 1 }],
  policy: { named_depth: 1, contact_for_personally_sponsored: false, default: false },
}

const CUSTOMERS = [
  { customer_id: CUSTOMER, display_name: 'Kim Customer', serviced_by_position_ref: 'DE-C-1', since: '2026-03-01T00:00:00.000Z', until: null, last_order_at: '2026-08-20T10:00:00.000Z', order_count: 3, repeat: true, contact_masked: { email: 'k•••@example.test' } },
  { customer_id: '40000000-0000-4000-8000-000000000002', display_name: 'Lee Customer', serviced_by_position_ref: 'DE-C-1', since: '2026-03-01T00:00:00.000Z', until: null, last_order_at: null, order_count: 0, repeat: false },
]

describe('SC-19 rank', () => {
  it('shows paid-as, requirements as met / not met / —, a "Not final" row and the plan change notice', async () => {
    renderPortal(<RankPage />, fetchByRoute({ 'GET /v1/me/rank': () => ok(RANK) }))
    expect(await screen.findByText('What Silver requires')).toBeTruthy()
    expect(screen.getAllByText('Silver').length).toBeGreaterThan(0)
    expect(screen.getByText('Met')).toBeTruthy()
    expect(screen.getByText('Not met')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('Measured 460.00 · required 200.00')).toBeTruthy()
    expect(screen.getByText('Not final')).toBeTruthy()
    expect(screen.getByText('Plan change scheduled')).toBeTruthy()
  })

  it('switches between owned positions and refuses a closed account', async () => {
    const me = portalMe()
    const positions = [...me.participant!.positions, { id: CHILD, position_ref: 'DE-A-2', status: 'active', market_code: 'DE' }]
    const fetchMock = fetchByRoute({ 'GET /v1/me/rank': () => ok(RANK) })
    renderPortal(<RankPage />, fetchMock, { ...me, participant: { ...me.participant!, positions } })
    fireEvent.change(await screen.findByLabelText('Position'), { target: { value: CHILD } })
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/v1/me/rank').some(([url]) => url.includes(`position_id=${CHILD}`))).toBe(true))
  })

  it('shows the closed-account notice without asking the API', () => {
    const me = portalMe()
    const fetchMock = fetchByRoute({})
    renderPortal(<RankPage />, fetchMock, { ...me, participant: { ...me.participant!, terminated: true } })
    expect(screen.getByText('Your account is closed')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SC-20 team', () => {
  it('names the first level, counts deeper levels only and explains the policy', async () => {
    nav.params = new URLSearchParams()
    renderPortal(<TeamPage />, fetchByRoute({ 'GET /v1/me/team': () => page(TEAM) }))
    expect(await screen.findByText('Ben Example')).toBeTruthy()
    expect(screen.getByText('1 person (totals only)')).toBeTruthy()
    expect(screen.getByText(/You see names up to 1 level below you/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Ben Example (DE-B-1)' }).getAttribute('href')).toBe(`/portal/team?position=${POSITION}&node=${CHILD}`)
  })

  it('needs two characters to search, then searches within the named levels', async () => {
    nav.params = new URLSearchParams()
    const fetchMock = fetchByRoute({ 'GET /v1/me/team': (query) => (query.has('q') ? ok({ viewer: TEAM.viewer, matches: [], policy: TEAM.policy }) : page(TEAM)) })
    renderPortal(<TeamPage />, fetchMock)
    const input = await screen.findByLabelText('Search by name or position reference')
    fireEvent.change(input, { target: { value: 'D' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText('Enter at least 2 characters of a name or a position reference.')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'DE-C' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Nobody within your named levels matches “DE-C”.')).toBeTruthy()
  })

  it('reads a node outside the team like an unknown one', async () => {
    nav.params = new URLSearchParams(`node=${CHILD}`)
    renderPortal(<TeamPage />, fetchByRoute({ 'GET /v1/me/team': () => apiError(404, 'NOT_FOUND') }))
    expect(await screen.findByText('Not found or not available to you')).toBeTruthy()
  })
})

describe('SC-21 customers', () => {
  it('shows cards with last order or "No orders yet", the repeat chip and the masked contact; filters reload', async () => {
    const fetchMock = fetchByRoute({ 'GET /v1/me/customers': () => page(CUSTOMERS) })
    renderPortal(<CustomersPage />, fetchMock)
    expect(await screen.findByText('Kim Customer')).toBeTruthy()
    expect(screen.getByText('Repeat buyer')).toBeTruthy()
    expect(screen.getByText('No orders yet')).toBeTruthy()
    expect(screen.getByText('k•••@example.test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Past' }))
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/v1/me/customers').at(-1)![0]).toContain('state=past'))
  })

  it('shows a past servicing as reassigned on the detail page', async () => {
    renderPortal(<CustomerPage customerId={CUSTOMER} />, fetchByRoute({
      [`GET /v1/me/customers/${CUSTOMER}`]: () => ok({
        customer_id: CUSTOMER, display_name: 'Kim Customer',
        servicing: [{ position_ref: 'DE-C-1', since: '2026-03-01T00:00:00.000Z', until: '2026-09-15T00:00:00.000Z', order_count: 3 }],
        last_orders: [{ ordered_at: '2026-08-20T10:00:00.000Z', source_order_id: 'ORD-9' }],
      }),
    }))
    expect(await screen.findByText('Servicing changed')).toBeTruthy()
    expect(screen.getByText('Order ORD-9')).toBeTruthy()
  })
})

// TS-53 (UI): no projection, target, streak, leaderboard or wallet words on SC-37, SC-18, SC-19, SC-20, SC-21.
const REFUSED = /project|potential|could earn|estimate|target|streak|leaderboard|rank(ed)? among|wallet/i

describe('TS-53 refused words on distributor screens', () => {
  const routes = fetchByRoute({
    'GET /v1/me/statements': () => page([SUMMARY]),
    [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
    'GET /v1/me/bank-details': () => ok({ current: null, pending_review: null, history: [], owed: [] }),
    'GET /v1/me/notifications': () => page([]),
    'GET /v1/me/disputes': () => page([]),
    'GET /v1/me/rank': () => ok(RANK),
    'GET /v1/me/team': () => page(TEAM),
    'GET /v1/me/customers': () => page(CUSTOMERS),
  })
  const screens: readonly [string, () => ReactElement, string][] = [
    ['SC-37', () => <PortalHome />, 'Open statement'],
    ['SC-18 list', () => <EarningsPage />, 'Net 23.00 EUR'],
    ['SC-18 detail', () => <StatementPage runId={RUN} />, 'How the net amount adds up'],
    ['SC-19', () => <RankPage />, 'What Silver requires'],
    ['SC-20', () => <TeamPage />, 'Ben Example'],
    ['SC-21', () => <CustomersPage />, 'Kim Customer'],
  ]
  it.each(screens)('%s', async (_name, ui, ready) => {
    nav.params = new URLSearchParams()
    const { container } = renderPortal(ui(), routes)
    await screen.findAllByText(ready)
    expect(container.textContent ?? '').not.toMatch(REFUSED)
  })
})
