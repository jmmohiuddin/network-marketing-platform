// @vitest-environment jsdom
import '../../test/dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../components/api-provider'
import { ToastProvider } from '../../components/toast'
import { apiError, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf } from '../admin/test-support'
import { DisputePage } from './dispute'
import { EarningsPage } from './earnings'
import { PortalHome } from './home'
import { backPath, PortalShell, portalRedirect } from './shell'
import { StatementPage } from './statement'
import { CASE, ENGINE_RULE, LINE, page, POSITION, portalMe, renderPortal, RUN, statement, SUMMARY } from './test-support'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), pathname: '/portal' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}))

const EXPLANATION = {
  line_id: LINE, run_id: RUN, template: 'percent_by_level', rule: { key: 'unilevel', name: ENGINE_RULE, kind: 'pay.percent_by_level' },
  period: { starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z' }, amount_minor: '2300', currency: 'EUR',
  rank_used: [{ ladder: 'main', rank: 'Silver' }],
  parts: [{ level: 1, label: 'level 1', count: 3, base: '460.00', base_unit: 'volume', rate: '0.05', contribution: '23.00' }],
  steps: [], rounding: { mode: 'half_up', before: '23.004', after: '23.00' }, origin: null, reconciles: true,
  text: ['A percentage of the volume of each level of your team, at the rate of that level.', 'Rule: Unilevel bonus.'],
}

describe('portal shell', () => {
  it('goes one level up, and from a line back to its statement', () => {
    expect(backPath('/portal')).toBeNull()
    expect(backPath('/portal/earnings')).toBeNull()
    expect(backPath(`/portal/earnings/${RUN}`)).toBe('/portal/earnings')
    expect(backPath(`/portal/earnings/${RUN}/lines/${LINE}`)).toBe(`/portal/earnings/${RUN}`)
    expect(backPath(`/portal/earnings/${RUN}/lines/${LINE}/dispute`)).toBe(`/portal/earnings/${RUN}/lines/${LINE}`)
    expect(backPath('/portal/more/my-data')).toBe('/portal/more')
  })

  it('sends a staff session to the staff home and a pending second factor to the MFA step', () => {
    expect(portalRedirect({ ...portalMe(), realm: 'tenant' }, '/portal')).toBe('/')
    expect(portalRedirect({ ...portalMe(), participant: null, mfa: { required: false, enrolled: true, verified: false } }, '/portal/rank')).toBe('/signin/mfa?next=%2Fportal%2Frank')
    expect(portalRedirect(portalMe(), '/portal')).toBeNull()
  })

  it('shows the bottom navigation with labels, Team in place of Customers, and the unread bell', async () => {
    nav.pathname = '/portal/rank'
    const fetchMock = fetchByRoute({
      'GET /v1/me': () => ok(portalMe({}, true)),
      'GET /v1/me/notifications': () => page([], { unread_count: 2 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ToastProvider><ApiProvider><PortalShell><p>Rank page</p></PortalShell></ApiProvider></ToastProvider>)
    await screen.findByText('Rank page')
    const bars = screen.getAllByRole('navigation', { name: 'Portal sections' })
    const labels = within(bars[1]!).getAllByRole('link').map((link) => link.querySelector('span:last-child')?.textContent)
    expect(labels).toEqual(['Home', 'Earnings', 'Rank', 'Team', 'More'])
    expect(within(bars[1]!).getByRole('link', { name: /Rank/ }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull()
  })

  it('marks More, not Home, as current on Customers when Team holds its place in the bar', async () => {
    nav.pathname = '/portal/customers'
    vi.stubGlobal('fetch', fetchByRoute({
      'GET /v1/me': () => ok(portalMe({}, true)),
      'GET /v1/me/notifications': () => page([], { unread_count: 0 }),
    }))
    render(<ToastProvider><ApiProvider><PortalShell><p>Customers page</p></PortalShell></ApiProvider></ToastProvider>)
    await screen.findByText('Customers page')
    const bar = screen.getAllByRole('navigation', { name: 'Portal sections' })[1]!
    expect(within(bar).getByRole('link', { name: /More/ }).getAttribute('aria-current')).toBe('page')
    expect(within(bar).getByRole('link', { name: /Home/ }).getAttribute('aria-current')).toBeNull()
  })

  it('sends a staff user away instead of rendering the portal', async () => {
    nav.pathname = '/portal'
    nav.replace.mockClear()
    vi.stubGlobal('fetch', fetchByRoute({ 'GET /v1/me': () => ok({ ...portalMe(), realm: 'tenant' }) }))
    render(<ToastProvider><ApiProvider><PortalShell><p>Home</p></PortalShell></ApiProvider></ToastProvider>)
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByText('Home')).toBeNull()
  })
})

describe('SC-37 home', () => {
  it('shows the latest net as the largest element, the paid-as rank, the cooling-off alert and module links', async () => {
    const until = new Date(Date.now() + 72 * 3600_000).toISOString()
    renderPortal(<PortalHome />, fetchByRoute({
      'GET /v1/me/statements': () => page([SUMMARY]),
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
      'GET /v1/me/bank-details': () => ok({ current: { masked: 'DE•• 3000', scheme: 'iban', created_via: 'self', created_at: until, cooling_off_until: until }, pending_review: null, history: [], owed: [] }),
      'GET /v1/me/notifications': () => page([{ id: 'n1', template: 'dispute.updated', topic: 'dispute', mandatory: false, params: { case_id: CASE, outcome: 'upheld' }, created_at: until, read_at: null }]),
    }))
    expect(await screen.findByText('23.00 EUR')).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
    expect(await screen.findByText('Paid as Silver')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open statement' }).getAttribute('href')).toBe(`/portal/earnings/${RUN}`)
    expect(await screen.findByText('New bank details in their waiting period')).toBeTruthy()
    expect(screen.getByText('Your dispute was upheld.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Customers/ }).getAttribute('href')).toBe('/portal/customers')
  })

  it('shows at most seven notices with a link to the inbox, and the paid-as rank of the position named in the strip', async () => {
    const notices = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, template: 'dispute.updated', topic: 'dispute', mandatory: false, params: { case_id: CASE, outcome: 'upheld' }, created_at: '2026-09-02T08:00:00.000Z', read_at: null }))
    const other = { position_id: 'other', position_ref: 'DE-A-2', paid_as: [{ ladder: 'main', rank: 'Gold' }], bonuses: [], total_minor: '0' }
    renderPortal(<PortalHome />, fetchByRoute({
      'GET /v1/me/statements': () => page([SUMMARY]),
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement({ positions: [other, { ...statement().positions[0]!, position_id: POSITION }] })),
      'GET /v1/me/bank-details': () => ok({ current: null, pending_review: null, history: [], owed: [] }),
      'GET /v1/me/notifications': () => page(notices),
    }))
    expect(await screen.findByText('Paid as Silver')).toBeTruthy()
    expect(screen.queryByText('Paid as Gold')).toBeNull()
    await waitFor(() => expect(screen.getAllByText('Your dispute was upheld.')).toHaveLength(7))
    expect(screen.getByRole('link', { name: /See all in your inbox/ }).getAttribute('href')).toBe('/portal/more/notifications')
  })

  it('says there is no statement yet and hides closed modules for a terminated participant', async () => {
    const me = portalMe()
    renderPortal(<PortalHome />, fetchByRoute({
      'GET /v1/me/statements': () => page([]),
      'GET /v1/me/bank-details': () => ok({ current: null, pending_review: null, history: [], owed: [] }),
      'GET /v1/me/notifications': () => page([]),
    }), { ...me, participant: { ...me.participant!, terminated: true } })
    expect(await screen.findByText('No statement yet')).toBeTruthy()
    expect(screen.getByText('Your account is closed')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Rank/ })).toBeNull()
  })
})

describe('SC-18 earnings', () => {
  it('lists committed statements seven at a time and appends the next page on Show more', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/me/statements': (query) => (query.get('cursor') === null
        ? page(Array.from({ length: 7 }, (_, i) => ({ ...SUMMARY, run_id: `10000000-0000-4000-8000-00000000000${i}` })), { next_cursor: 'c2' })
        : page([{ ...SUMMARY, run_id: '10000000-0000-4000-8000-000000000099' }])),
      'GET /v1/me/disputes': () => page([]),
    })
    renderPortal(<EarningsPage />, fetchMock)
    expect(await screen.findAllByText('Net 23.00 EUR')).toHaveLength(7)
    expect(callsTo(fetchMock, 'GET', '/v1/me/statements')[0]![0]).toContain('limit=7')
    fireEvent.click(screen.getByRole('button', { name: 'Show more statements' }))
    await waitFor(() => expect(screen.getAllByText('Net 23.00 EUR')).toHaveLength(8))
    expect(screen.queryByRole('button', { name: 'Show more statements' })).toBeNull()
  })

  it('scrolls to the disputes once loaded when opened from the inbox link', async () => {
    window.location.hash = '#disputes'
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    renderPortal(<EarningsPage />, fetchByRoute({
      'GET /v1/me/statements': () => page([SUMMARY]),
      'GET /v1/me/disputes': () => page([{ case_id: CASE, line_id: LINE, run_id: RUN, period: SUMMARY.period, amount_minor: '2300', state: 'opened', opened_at: '2026-09-03T08:00:00.000Z', due_at: null, overdue: false, explanation: null }]),
    }))
    await screen.findByText('Dispute opened')
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1))
    window.location.hash = ''
  })

  it('shows disputes with their state and the company explanation', async () => {
    renderPortal(<EarningsPage />, fetchByRoute({
      'GET /v1/me/statements': () => page([SUMMARY]),
      'GET /v1/me/disputes': () => page([{ case_id: CASE, line_id: LINE, run_id: RUN, period: SUMMARY.period, amount_minor: '2300', state: 'upheld', opened_at: '2026-09-03T08:00:00.000Z', due_at: null, overdue: false, explanation: 'Volume added.' }]),
    }))
    expect(await screen.findByText('Dispute upheld')).toBeTruthy()
    expect(screen.getByText('Volume added.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open the line/ }).getAttribute('href')).toBe(`/portal/earnings/${RUN}/lines/${LINE}`)
  })
})

describe('SC-18 statement', () => {
  it('adds up gross, adjustments and the amount carried to what you owe; lines link to their explanation', async () => {
    const refund = statement({
      positions: [{
        position_id: 'x', position_ref: 'DE-A-1', paid_as: [], total_minor: '-1000',
        bonuses: [{ rule_key: 'retail', rule_name: null, total_minor: '-1000', lines: [{ id: LINE, amount_minor: '-1000', origin_kind: 'refund', original_period_id: 'p-2' }] }],
      }],
      summary: { gross_minor: '0', adjustment_minor: '-1000', clawback_minor: '-1000', withheld_minor: '0', net_minor: '0' },
      payout: { instructions: [], blockers: [{ reason: 'bank_detail_cooling_off', until: '2026-09-10T10:00:00.000Z' }] },
    })
    renderPortal(<StatementPage runId={RUN} />, fetchByRoute({
      [`GET /v1/me/statements/${RUN}`]: () => ok(refund),
      'GET /v1/me/disputes': () => page([]),
    }))
    expect(await screen.findByText('Carried to the amount you owe')).toBeTruthy()
    expect(screen.getByText('+10.00 EUR')).toBeTruthy()
    // One fact, one number: no second caption with the opposite sign.
    expect(screen.queryByText(/carried to the amount you owe\./)).toBeNull()
    expect(screen.getByText('Refund of an earlier period')).toBeTruthy()
    expect(screen.getByText(/Your new bank details can be used after/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /How calculated: Retail/ }).getAttribute('href')).toBe(`/portal/earnings/${RUN}/lines/${LINE}`)
  })

  it('downloads the CSV named after the period’s first day in the market zone (BUG-112)', async () => {
    const saved = vi.fn()
    URL.createObjectURL = saved.mockReturnValue('blob:x')
    URL.revokeObjectURL = vi.fn()
    const names: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    // Aug 1 00:00 Europe/Berlin is Jul 31 in UTC (the day the API's own file name carries).
    const august = { id: 'per-8', starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z', state: 'paid' as const }
    const fetchMock = fetchByRoute({
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement({ period: august })),
      'GET /v1/me/disputes': () => page([]),
      [`GET /v1/me/statements/${RUN}/download`]: () => new Response('record,amount', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="statement-2026-07-31.csv"' } }),
    })
    renderPortal(<StatementPage runId={RUN} />, fetchMock)
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(names).toEqual(['statement-2026-08-01.csv'])
    click.mockRestore()
    expect(headerOf(callsTo(fetchMock, 'GET', `/v1/me/statements/${RUN}/download`)[0]![1], 'Accept')).toBe('text/csv')
  })

  it('opens the line explanation as a sheet with sources per level, rounding and the dispute link', async () => {
    nav.push.mockClear()
    renderPortal(<StatementPage runId={RUN} lineId={LINE} />, fetchByRoute({
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
      'GET /v1/me/disputes': () => page([]),
      [`GET /v1/me/statement-lines/${LINE}/explanation`]: () => ok(EXPLANATION),
    }))
    const sheet = await screen.findByRole('dialog', { name: 'Line explanation' })
    expect(await within(sheet).findByText('Level 1')).toBeTruthy()
    expect(within(sheet).getByText('A percentage of the volume of each level of your team, at the rate of that level.')).toBeTruthy()
    expect(within(sheet).getByText('3 sources · base 460.00 volume · rate 5 %')).toBeTruthy()
    expect(within(sheet).getByText('Rounded half up: 23.004 to 23.00.')).toBeTruthy()
    // BUG-119: the bonus is named in words, never by the engine's rule description.
    expect(within(sheet).getByRole('heading', { name: 'Unilevel' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('compression')
    expect(within(sheet).getByRole('link', { name: 'Dispute this line' }).getAttribute('href')).toBe(`/portal/earnings/${RUN}/lines/${LINE}/dispute`)
    nav.replace.mockClear()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close the explanation' }))
    expect(nav.replace).toHaveBeenCalledWith(`/portal/earnings/${RUN}`)
    expect(nav.push).not.toHaveBeenCalled()
  })

  const dispute = (state: string) => ({ case_id: CASE, line_id: LINE, run_id: RUN, period: SUMMARY.period, amount_minor: '2300', state, opened_at: '2026-09-03T08:00:00.000Z', due_at: null, overdue: false, explanation: null })
  const explain = (disputes: () => Response) => renderPortal(<StatementPage runId={RUN} lineId={LINE} />, fetchByRoute({
    [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
    'GET /v1/me/disputes': disputes,
    [`GET /v1/me/statement-lines/${LINE}/explanation`]: () => ok(EXPLANATION),
  }))

  it('offers a new dispute after a decided one, never while one is open', async () => {
    const decided = explain(() => page([dispute('not_upheld')]))
    let sheet = await screen.findByRole('dialog', { name: 'Line explanation' })
    expect(await within(sheet).findByText('Dispute not upheld')).toBeTruthy()
    expect(within(sheet).getByRole('link', { name: 'Dispute this line' })).toBeTruthy()
    decided.unmount()
    explain(() => page([dispute('under_review')]))
    sheet = await screen.findByRole('dialog', { name: 'Line explanation' })
    expect(await within(sheet).findByText('Dispute under review')).toBeTruthy()
    expect(within(sheet).queryByRole('link', { name: 'Dispute this line' })).toBeNull()
  })

  it('hides the dispute link and says so when the dispute states could not be loaded', async () => {
    explain(() => apiError(500, 'INTERNAL', 'boom'))
    const sheet = await screen.findByRole('dialog', { name: 'Line explanation' })
    expect(await within(sheet).findByText(/Dispute states could not be loaded/)).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(within(sheet).queryByRole('link', { name: 'Dispute this line' })).toBeNull()
  })

  it('says "Not found or not available to you" for another person’s statement', async () => {
    renderPortal(<StatementPage runId={RUN} />, fetchByRoute({
      [`GET /v1/me/statements/${RUN}`]: () => apiError(404, 'NOT_FOUND'),
      'GET /v1/me/disputes': () => page([]),
    }))
    expect(await screen.findByText('Not found or not available to you')).toBeTruthy()
  })
})

describe('dispute this line', () => {
  const routes = (post: () => Response) => fetchByRoute({
    [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
    [`GET /v1/me/statement-lines/${LINE}/explanation`]: () => ok(EXPLANATION),
    'POST /v1/me/disputes': post,
  })

  it('asks for a message, then opens the dispute once with an Idempotency-Key', async () => {
    const fetchMock = routes(() => ok({ case_id: CASE, state: 'opened', due_at: '2026-09-13T08:00:00.000Z' }, 201))
    renderPortal(<DisputePage runId={RUN} lineId={LINE} />, fetchMock)
    fireEvent.click(await screen.findByRole('button', { name: 'Send dispute' }))
    expect(screen.getByText('Say what you think is wrong with this line.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('What is wrong with this line?'), { target: { value: ' Volume missing ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send dispute' }))
    expect(await screen.findByText('Your dispute was sent to the company')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/me/disputes')[0]!
    expect(bodyOf(init)).toEqual({ line_id: LINE, message: 'Volume missing' })
    expect(headerOf(init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('explains a closed dispute window and an open dispute', async () => {
    renderPortal(<DisputePage runId={RUN} lineId={LINE} />, routes(() => apiError(422, 'DISPUTE_WINDOW_CLOSED', 'closed', { closed_at: '2026-10-01T00:00:00.000Z' })))
    fireEvent.change(await screen.findByLabelText('What is wrong with this line?'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send dispute' }))
    expect(await screen.findByText(/Disputes of this statement closed on/)).toBeTruthy()
  })
})
