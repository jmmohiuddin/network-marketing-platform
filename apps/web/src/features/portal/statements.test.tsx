// @vitest-environment jsdom
import '../../test/dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../components/api-provider'
import { ToastProvider } from '../../components/toast'
import { apiError, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf } from '../admin/test-support'
import NotFound from '../../app/not-found'
import { DisputePage } from './dispute'
import { EarningsPage } from './earnings'
import { PortalHome } from './home'
import { CATALOGUES } from './i18n'
import { backPath, PortalShell } from './shell'
import { StatementPage } from './statement'
import { CASE, ENGINE_RULE, LINE, page, POSITION, portalMe, renderPortal, renderServer, requestHeaders, RUN, serverRoutes, statement, SUMMARY } from './test-support'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), pathname: '/portal' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error(`redirect ${path}`) },
}))
vi.mock('next/headers', async () => ({ headers: async () => (await import('./test-support')).requestHeaders.current }))

const EXPLANATION = {
  line_id: LINE, run_id: RUN, template: 'percent_by_level', rule: { key: 'unilevel', name: ENGINE_RULE, kind: 'pay.percent_by_level' },
  period: { starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z' }, amount_minor: '2300', currency: 'EUR',
  rank_used: [{ ladder: 'main', rank: 'Silver' }],
  parts: [{ level: 1, label: 'level 1', count: 3, base: '460.00', base_unit: 'volume', rate: '0.05', contribution: '23.00' }],
  steps: [], rounding: { mode: 'half_up', before: '23.004', after: '23.00' }, origin: null, reconciles: true,
  text: ['A percentage of the volume of each level of your team, at the rate of that level.', 'Rule: Unilevel bonus.'],
}
const NO_BANK = { current: null, pending_review: null, history: [], owed: [] }
const NBSP = ' '

describe('portal shell', () => {
  it('goes one level up, and from a line back to its statement', () => {
    expect(backPath('/portal')).toBeNull()
    expect(backPath('/portal/earnings')).toBeNull()
    expect(backPath(`/portal/earnings/${RUN}`)).toBe('/portal/earnings')
    expect(backPath(`/portal/earnings/${RUN}/lines/${LINE}`)).toBe(`/portal/earnings/${RUN}`)
    expect(backPath(`/portal/earnings/${RUN}/lines/${LINE}/dispute`)).toBe(`/portal/earnings/${RUN}/lines/${LINE}`)
    expect(backPath('/portal/more/my-data')).toBe('/portal/more')
  })

  it('labels the bottom navigation by key from the catalogue, Team in place of Customers, and the unread bell', () => {
    nav.pathname = '/portal/rank'
    const me = portalMe({ navigation: portalMe({}, true).navigation.map((entry) => ({ ...entry, label: `API ${entry.label}` })) }, true)
    render(<ToastProvider><ApiProvider><PortalShell me={me} locale="en" catalogue={CATALOGUES.en} unread={2}><p>Rank page</p></PortalShell></ApiProvider></ToastProvider>)
    const bars = screen.getAllByRole('navigation', { name: 'Portal sections' })
    const labels = within(bars[1]!).getAllByRole('link').map((link) => link.querySelector('span:last-child')?.textContent)
    expect(labels).toEqual(['Home', 'Earnings', 'Rank', 'Team', 'More'])
    expect(within(bars[1]!).getByRole('link', { name: /Rank/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull()
  })

  it('renders in German with lang="de" for a German session', () => {
    nav.pathname = '/portal/earnings'
    const { container } = render(<ToastProvider><ApiProvider><PortalShell me={portalMe({ locale: 'de' })} locale="de" catalogue={CATALOGUES.de} unread={1}><p>x</p></PortalShell></ApiProvider></ToastProvider>)
    expect(container.querySelector('[lang="de"]')).toBeTruthy()
    const bar = screen.getAllByRole('navigation', { name: 'Bereiche des Portals' })[1]!
    expect(within(bar).getAllByRole('link').map((link) => link.querySelector('span:last-child')?.textContent)).toEqual(['Start', 'Provisionen', 'Rang', 'Kunden', 'Mehr'])
    expect(screen.getByRole('link', { name: 'Mitteilungen, 1 ungelesen' })).toBeTruthy()
  })

  it('marks More, not Home, as current on Customers when Team holds its place in the bar', () => {
    nav.pathname = '/portal/customers'
    render(<ToastProvider><ApiProvider><PortalShell me={portalMe({}, true)} locale="en" catalogue={CATALOGUES.en} unread={0}><p>Customers page</p></PortalShell></ApiProvider></ToastProvider>)
    const bar = screen.getAllByRole('navigation', { name: 'Portal sections' })[1]!
    expect(within(bar).getByRole('link', { name: /More/ }).getAttribute('aria-current')).toBe('page')
    expect(within(bar).getByRole('link', { name: /Home/ }).getAttribute('aria-current')).toBeNull()
  })
})

describe('server session', () => {
  it('sends a staff session to the staff home, a pending second factor to the MFA step and no session to sign-in', async () => {
    await expect(renderServer(() => PortalHome(), serverRoutes({}, { ...portalMe(), realm: 'tenant' }))).rejects.toThrow('redirect /')
    const pending = { ...portalMe(), participant: null, mfa: { required: false, enrolled: true, verified: false } }
    await expect(renderServer(() => PortalHome(), serverRoutes({}, pending))).rejects.toThrow('redirect /signin/mfa?next=%2Fportal')
    const signedOut = fetchByRoute({ 'GET http://127.0.0.1:4000/v1/me': () => apiError(401, 'UNAUTHENTICATED') })
    await expect(renderServer(() => PortalHome(), signedOut)).rejects.toThrow('redirect /portal/signin')
  })

  it('forwards cookie, user agent, language and address to the API', async () => {
    requestHeaders.current = new Headers({ cookie: 'nmp_session=s', 'user-agent': 'UA', 'accept-language': 'de', 'x-forwarded-for': '10.0.0.1', host: 'x' })
    const fetchMock = serverRoutes({ 'GET /v1/me/statements': () => page([]), 'GET /v1/me/bank-details': () => ok(NO_BANK), 'GET /v1/me/notifications': () => page([]) })
    await renderServer(() => PortalHome(), fetchMock)
    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers)
    expect([headers.get('cookie'), headers.get('user-agent'), headers.get('accept-language'), headers.get('x-forwarded-for'), headers.get('host')]).toEqual(['nmp_session=s', 'UA', 'de', '10.0.0.1', null])
    requestHeaders.current = new Headers({ cookie: 'nmp_session=s', 'accept-language': 'en' })
  })
})

describe('not-found page (BUG-136)', () => {
  it('speaks the portal user’s language under /portal and English elsewhere', async () => {
    vi.stubGlobal('fetch', serverRoutes({}, portalMe({ locale: 'de' })))
    requestHeaders.current = new Headers({ cookie: 'nmp_session=s', 'accept-language': 'en', 'x-nmp-surface': 'portal' })
    try {
      const { unmount } = render(await NotFound())
      expect(screen.getByRole('heading', { name: 'Nicht gefunden oder für Sie nicht verfügbar' })).toBeTruthy()
      expect(screen.getByRole('link', { name: /Startseite/ }).getAttribute('href')).toBe('/portal')
      unmount()
    } finally {
      requestHeaders.current = new Headers({ cookie: 'nmp_session=s', 'accept-language': 'en' })
    }
    render(await NotFound())
    expect(screen.getByRole('heading', { name: 'Not found or not available to you' })).toBeTruthy()
  })
})

describe('SC-37 home (server-rendered)', () => {
  it('shows the latest net as the largest element, the paid-as rank, the cooling-off alert and module links', async () => {
    const until = new Date(Date.now() + 72 * 3600_000).toISOString()
    await renderServer(() => PortalHome(), serverRoutes({
      'GET /v1/me/statements': () => page([SUMMARY]),
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
      'GET /v1/me/bank-details': () => ok({ current: { masked: 'DE•• 3000', scheme: 'iban', created_via: 'self', created_at: until, cooling_off_until: until }, pending_review: null, history: [], owed: [] }),
      'GET /v1/me/notifications': () => page([{ id: 'n1', template: 'dispute.updated', topic: 'dispute', mandatory: false, params: { case_id: CASE, outcome: 'upheld' }, created_at: until, read_at: null }]),
    }))
    expect(screen.getByText('€23.00')).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
    expect(screen.getByText('Paid as Silver')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open statement' }).getAttribute('href')).toBe(`/portal/earnings/${RUN}`)
    expect(screen.getByText('New bank details in their waiting period')).toBeTruthy()
    expect(screen.getByText('Your dispute was upheld.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Customers/ }).getAttribute('href')).toBe('/portal/customers')
  })

  it('shows at most seven notices with a link to the inbox, and the paid-as rank of the position named in the strip', async () => {
    const notices = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, template: 'dispute.updated', topic: 'dispute', mandatory: false, params: { case_id: CASE, outcome: 'upheld' }, created_at: '2026-09-02T08:00:00.000Z', read_at: null }))
    const other = { position_id: 'other', position_ref: 'DE-A-2', paid_as: [{ ladder: 'main', rank: 'Gold' }], bonuses: [], total_minor: '0' }
    await renderServer(() => PortalHome(), serverRoutes({
      'GET /v1/me/statements': () => page([SUMMARY]),
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement({ positions: [other, { ...statement().positions[0]!, position_id: POSITION }] })),
      'GET /v1/me/bank-details': () => ok(NO_BANK),
      'GET /v1/me/notifications': () => page(notices),
    }))
    expect(screen.getByText('Paid as Silver')).toBeTruthy()
    expect(screen.queryByText('Paid as Gold')).toBeNull()
    expect(screen.getAllByText('Your dispute was upheld.')).toHaveLength(7)
    expect(screen.getByRole('link', { name: /See all in your inbox/ }).getAttribute('href')).toBe('/portal/more/notifications')
  })

  it('says there is no statement yet and hides closed modules for a terminated participant', async () => {
    const me = portalMe()
    await renderServer(() => PortalHome(), serverRoutes({
      'GET /v1/me/statements': () => page([]),
      'GET /v1/me/bank-details': () => ok(NO_BANK),
      'GET /v1/me/notifications': () => page([]),
    }, { ...me, participant: { ...me.participant!, terminated: true } }))
    expect(screen.getByText('No statement yet')).toBeTruthy()
    expect(screen.getByText('Your account is closed')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Rank/ })).toBeNull()
  })

  it('greets a participant without a name without the e-mail address (BUG-138)', async () => {
    const me = portalMe({ locale: 'de', user: { id: 'u-a', email: 'at-a@example.test', display_name: null } })
    await renderServer(() => PortalHome(), serverRoutes({
      'GET /v1/me/statements': () => page([]),
      'GET /v1/me/bank-details': () => ok(NO_BANK),
      'GET /v1/me/notifications': () => page([]),
    }, { ...me, participant: { ...me.participant!, display_name: null } }))
    expect(screen.getByRole('heading', { level: 1, name: 'Willkommen zurück' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('at-a@example.test')
  })
})

describe('SC-18 earnings (server-rendered)', () => {
  it('lists committed statements seven at a time; Show more is a link that asks for seven more', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...SUMMARY, run_id: `10000000-0000-4000-8000-00000000000${i}` }))
    const fetchMock = serverRoutes({
      'GET /v1/me/statements': (query) => (query.get('cursor') === null ? page(seven, { next_cursor: 'c2' }) : page([{ ...SUMMARY, run_id: '10000000-0000-4000-8000-000000000099' }])),
      'GET /v1/me/disputes': () => page([]),
    })
    await renderServer(() => EarningsPage({ query: {} }), fetchMock)
    expect(screen.getAllByText('Net €23.00')).toHaveLength(7)
    expect(String(fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/me/statements'))![0])).toContain('limit=7')
    expect(screen.getByRole('link', { name: 'Show more statements' }).getAttribute('href')).toBe('/portal/earnings?statements=14&disputes=7')
    await renderServer(() => EarningsPage({ query: { statements: '14' } }), fetchMock)
    expect(screen.getAllByText('Net €23.00')).toHaveLength(8)
    expect(screen.queryByRole('link', { name: 'Show more statements' })).toBeNull()
  })

  it('shows disputes with their state and the company explanation', async () => {
    await renderServer(() => EarningsPage({ query: {} }), serverRoutes({
      'GET /v1/me/statements': () => page([SUMMARY]),
      'GET /v1/me/disputes': () => page([{ case_id: CASE, line_id: LINE, run_id: RUN, period: SUMMARY.period, amount_minor: '2300', state: 'upheld', opened_at: '2026-09-03T08:00:00.000Z', due_at: null, overdue: false, explanation: 'Volume added.' }]),
    }))
    expect(screen.getByText('Dispute upheld')).toBeTruthy()
    expect(screen.getByText('Volume added.')).toBeTruthy()
    expect(document.getElementById('disputes')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open the line/ }).getAttribute('href')).toBe(`/portal/earnings/${RUN}/lines/${LINE}`)
  })
})

describe('SC-18 statement (server-rendered, T-BM-35)', () => {
  it('adds up gross, adjustments and the amount carried to what you owe; lines link to their explanation', async () => {
    const refund = statement({
      positions: [{
        position_id: 'x', position_ref: 'DE-A-1', paid_as: [], total_minor: '-1000',
        bonuses: [{ rule_key: 'retail', rule_name: null, total_minor: '-1000', lines: [{ id: LINE, amount_minor: '-1000', origin_kind: 'refund', original_period_id: 'p-2' }] }],
      }],
      summary: { gross_minor: '0', adjustment_minor: '-1000', clawback_minor: '-1000', withheld_minor: '0', withholding: null, net_minor: '0' },
      payout: { instructions: [], blockers: [{ reason: 'bank_detail_cooling_off', until: '2026-09-10T10:00:00.000Z' }] },
    })
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(refund), 'GET /v1/me/disputes': () => page([]) }))
    expect(screen.getByText('Carried to the amount you owe')).toBeTruthy()
    expect(screen.getByText('+€10.00')).toBeTruthy()
    expect(screen.getByText('Withheld')).toBeTruthy()
    expect(screen.getByText('Refund of an earlier period')).toBeTruthy()
    expect(screen.getByText(/Your new bank details can be used after/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /How calculated: Retail/ }).getAttribute('href')).toBe(`/portal/earnings/${RUN}/lines/${LINE}`)
  })

  it('renders the statement core as static German HTML: net, gross, withholding with rate and basis, lines, payout, CSV link', async () => {
    const german = statement({
      summary: { gross_minor: '520000', adjustment_minor: '0', clawback_minor: '0', withheld_minor: '0', withholding: { rule_id: 'r', rate: '0.000000', rate_basis: 'no_duty' }, net_minor: '520000' },
      positions: [{ ...statement().positions[0]!, total_minor: '520000', bonuses: [{ rule_key: 'unilevel', rule_name: null, total_minor: '520000', lines: [{ id: LINE, amount_minor: '520000', origin_kind: 'none', original_period_id: null }] }] }],
    })
    const container = await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({
      [`GET /v1/me/statements/${RUN}`]: () => ok(german), 'GET /v1/me/disputes': () => page([]),
    }, portalMe({ locale: 'de' })))
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Abrechnung 01.08.2026 – 01.09.2026')
    expect(screen.getAllByText('5.200,00 €').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('Bruttoprovisionen')).toBeTruthy()
    const withholding = screen.getByTestId('withholding')
    // BUG-138: no withholding duty names no rate.
    expect(withholding.textContent).toContain('Einbehaltene Steuer')
    expect(withholding.textContent).not.toContain('%')
    expect(withholding.textContent).toContain('Keine Steuerabzugspflicht')
    expect(within(withholding).getByText('0,00 €')).toBeTruthy()
    expect(screen.getByText(/Ausgezahlt · 05\.09\.2026/)).toBeTruthy()
    expect(screen.getByText(/02\.09\.2026, 10:00/)).toBeTruthy()
    const csv = screen.getByRole('link', { name: 'CSV herunterladen' })
    expect([csv.getAttribute('href'), csv.getAttribute('download')]).toEqual([`/v1/me/statements/${RUN}/download`, 'statement-2026-08-01.csv'])
    expect(screen.getByRole('link', { name: /So berechnet: Unilevel/ })).toBeTruthy()
  })

  it('names the withholding rate and why it applies', async () => {
    const withholding = (rate: string, basis: string) => statement({
      summary: { gross_minor: '10000', adjustment_minor: '0', clawback_minor: '0', withheld_minor: '200', withholding: { rule_id: 'r', rate, rate_basis: basis }, net_minor: '9800' },
    })
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(withholding('0.020000', 'rate')), 'GET /v1/me/disputes': () => page([]) }))
    expect(screen.getByTestId('withholding').textContent).toBe(`Withholding (2${NBSP}%)-€2.00`)
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(withholding('0.200000', 'missing_id_rate')), 'GET /v1/me/disputes': () => page([]) }))
    expect(screen.getByTestId('withholding').textContent).toContain('No tax id: higher rate')
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({ [`GET /v1/me/statements/${RUN}`]: () => ok(withholding('0.000000', 'below_threshold')), 'GET /v1/me/disputes': () => page([]) }))
    expect(screen.getByTestId('withholding').textContent).toContain('Below threshold')
  })

  it('renders the line explanation beside the statement with sources per level, rounding and the dispute link', async () => {
    await renderServer(() => StatementPage({ runId: RUN, lineId: LINE }), serverRoutes({
      [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
      'GET /v1/me/disputes': () => page([]),
      [`GET /v1/me/statement-lines/${LINE}/explanation`]: () => ok(EXPLANATION),
    }))
    const panel = screen.getByRole('complementary', { name: 'Line explanation' })
    expect(within(panel).getByText('Level 1')).toBeTruthy()
    expect(within(panel).getByText('A percentage of the volume of each level of your team, at the rate of that level.')).toBeTruthy()
    expect(within(panel).getByText('3 sources · base 460.00 volume · rate 5 %')).toBeTruthy()
    expect(within(panel).getByText('Rounded half up: 23.004 to 23.00.')).toBeTruthy()
    // BUG-138: the source contribution in the currency's style, like the line amount above it.
    expect(within(panel).getAllByText('€23.00')).toHaveLength(2)
    expect(panel.textContent).not.toContain('EUR')
    // BUG-119: the bonus is named in words, never by the engine's rule description.
    expect(within(panel).getByRole('heading', { name: 'Unilevel' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('compression')
    expect(within(panel).getByRole('link', { name: 'Dispute this line' }).getAttribute('href')).toBe(`/portal/earnings/${RUN}/lines/${LINE}/dispute`)
    expect(within(panel).getByRole('link', { name: 'Close the explanation' }).getAttribute('href')).toBe(`/portal/earnings/${RUN}`)
  })

  const dispute = (state: string) => ({ case_id: CASE, line_id: LINE, run_id: RUN, period: SUMMARY.period, amount_minor: '2300', state, opened_at: '2026-09-03T08:00:00.000Z', due_at: null, overdue: false, explanation: null })
  const explain = (disputes: () => Response) => renderServer(() => StatementPage({ runId: RUN, lineId: LINE }), serverRoutes({
    [`GET /v1/me/statements/${RUN}`]: () => ok(statement()),
    'GET /v1/me/disputes': disputes,
    [`GET /v1/me/statement-lines/${LINE}/explanation`]: () => ok(EXPLANATION),
  }))

  it('offers a new dispute after a decided one, never while one is open', async () => {
    await explain(() => page([dispute('not_upheld')]))
    let panel = screen.getByRole('complementary', { name: 'Line explanation' })
    expect(within(panel).getByText('Dispute not upheld')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Dispute this line' })).toBeTruthy()
    await explain(() => page([dispute('under_review')]))
    panel = screen.getByRole('complementary', { name: 'Line explanation' })
    expect(within(panel).getByText('Dispute under review')).toBeTruthy()
    expect(within(panel).queryByRole('link', { name: 'Dispute this line' })).toBeNull()
  })

  it('hides the dispute link and says so when the dispute states could not be loaded', async () => {
    await explain(() => apiError(500, 'INTERNAL', 'boom'))
    const panel = screen.getByRole('complementary', { name: 'Line explanation' })
    expect(within(panel).getByText('This section could not be loaded')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Try again' })).toBeTruthy()
    expect(within(panel).queryByRole('link', { name: 'Dispute this line' })).toBeNull()
  })

  it('opens the explanation as a bottom sheet on phones once scripts run', async () => {
    nav.replace.mockClear()
    const element = await (async () => {
      vi.stubGlobal('fetch', serverRoutes({
        [`GET /v1/me/statements/${RUN}`]: () => ok(statement()), 'GET /v1/me/disputes': () => page([]),
        [`GET /v1/me/statement-lines/${LINE}/explanation`]: () => ok(EXPLANATION),
      }))
      return StatementPage({ runId: RUN, lineId: LINE })
    })()
    render(<ToastProvider><ApiProvider>{element}</ApiProvider></ToastProvider>)
    const sheet = await screen.findByRole('dialog', { name: 'Line explanation' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close the explanation' }))
    expect(nav.replace).toHaveBeenCalledWith(`/portal/earnings/${RUN}`)
  })

  it('says "Not found or not available to you" for another person’s statement', async () => {
    await renderServer(() => StatementPage({ runId: RUN }), serverRoutes({
      [`GET /v1/me/statements/${RUN}`]: () => apiError(404, 'NOT_FOUND'),
      'GET /v1/me/disputes': () => page([]),
    }))
    expect(screen.getByText('Not found or not available to you')).toBeTruthy()
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

  it('explains a closed dispute window and an open dispute by code, never the API message', async () => {
    renderPortal(<DisputePage runId={RUN} lineId={LINE} />, routes(() => apiError(422, 'DISPUTE_WINDOW_CLOSED', 'closed', { closed_at: '2026-10-01T00:00:00.000Z' })))
    fireEvent.change(await screen.findByLabelText('What is wrong with this line?'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send dispute' }))
    expect(await screen.findByText(/Disputes of this statement closed on/)).toBeTruthy()
  })

  it('reads in German with the line amount German-formatted', async () => {
    renderPortal(<DisputePage runId={RUN} lineId={LINE} />, routes(() => apiError(409, 'DISPUTE_OPEN', 'API words')), portalMe({ locale: 'de' }))
    expect(await screen.findByText('23,00 €')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Was ist an dieser Zeile falsch?'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reklamation senden' }))
    expect(await screen.findByText(/Zu dieser Zeile läuft bereits eine Reklamation/)).toBeTruthy()
    expect(screen.queryByText('API words')).toBeNull()
  })
})
