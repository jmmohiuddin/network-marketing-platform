// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { moneyText } from '../orders/format'
import { blockerText, canCalculate, cutOffText, exceptionText, periodName, periodText, targetPeriod } from './format'
import { PeriodsPage } from './periods-page'
import type { Calendar, PeriodRow } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/periods',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const CAL = '00000000-0000-4000-8000-0000000ca1e0'
const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const CALENDAR: Calendar = { id: CAL, name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: 'm1', code: 'DE' }, plan: { id: 'pl1', name: 'DE core' }, provisional_for: null, provisional_calendars: [] }
const ZONE = 'Europe/Berlin'
const ANALYST = adminMe({ permissions: ['period.read', 'run.execute', 'run.review', 'late.manage', 'restatement.request'] })
const READER = adminMe({ permissions: ['period.read'] })

const SYNC = { code: 'SYNC_BEHIND', message: 'Order sync of this market is behind or failing.', details: { last_sync_at: null, sources: [{ source: 'api:e2e-de', name: 'e2e-de', state: 'failing', last_success_at: null }] } }

function period(id: string, month: number, overrides: Partial<PeriodRow> = {}): PeriodRow {
  const start = new Date(Date.UTC(2026, month, 1)).toISOString()
  const end = new Date(Date.UTC(2026, month + 1, 1)).toISOString()
  return { id, calendar_id: CAL, starts_at: start, ends_at: end, cut_off_passed: true, state: 'open', committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null, ...overrides }
}

const M3 = period('per-m3', 7, { state: 'committed', committed_run_id: 'run-m3', latest_run: { id: 'run-m3', state: 'committed', gross_minor: '4700', finished_at: '2026-09-02T10:00:00.000Z', true_up_runs: 0 }, late: { pending: 1, decided: 0 }, blockers: [{ code: 'PERIOD_COMMITTED', message: 'The period is already committed.', details: {} }] })
const M2 = period('per-m2', 8, { blockers: [SYNC] })
const M1 = period('per-m1', 9, { blockers: [{ code: 'PRIOR_PERIOD_OPEN', message: 'Commit the previous period of this calendar first.', details: {} }] })
const NOW = period('per-m0', 10, { cut_off_passed: false, blockers: [{ code: 'BEFORE_CUTOFF', message: 'The period has not reached its cut-off yet.', details: {} }] })

/** Opens a row's "More actions" menu and returns the named item (BUG-094: further row actions live there). */
async function rowMenuItem(row: PeriodRow, item: string) {
  const name = periodName(row.starts_at, row.ends_at, ZONE)
  await userEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }))
  return screen.getByRole('menuitem', { name: `${item} ${name}` })
}

const detail = (row: PeriodRow) => ok({ ...row, market_id: 'm1', runs: [], plan_version: null, sync: { state: 'failing', last_sync_at: null, sources: SYNC.details.sources }, late: { ...row.late, consumed: 0 }, restatements: [] })

function routes(periods: readonly PeriodRow[], extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/periods': () => json(200, { data: { calendars: [CALENDAR], periods }, meta: { next_cursor: null } }),
    'GET /v1/markets': () => ok([MARKET]),
    ...Object.fromEntries(periods.map((row) => [`GET /v1/periods/${row.id}`, () => detail(row)])),
    ...extra,
  })
}

describe('period format', () => {
  it('names periods in the calendar zone and picks the head of the chain as target', () => {
    expect(periodName(M3.starts_at, M3.ends_at, 'UTC')).toBe(`${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(M3.starts_at))} – ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-08-31T12:00:00Z'))}`)
    expect(targetPeriod([NOW, M1, M2, M3])?.id).toBe('per-m2')
    expect(targetPeriod([NOW, M3])?.id).toBe('per-m0')
    expect(canCalculate(M2)).toBe(true) // sync can recover at any moment: the server refusal explains it
    expect(canCalculate(M1)).toBe(false)
    expect(blockerText(SYNC)).toBe('Order sync failing for e2e-de — last successful sync never.')
  })
})

describe('zone and code words (BUG-091, BUG-092)', () => {
  it('names a period in its calendar zone, else its bounds with the zone named', () => {
    const berlin = { starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z' }
    expect(periodText(berlin, 'Europe/Berlin')).toBe(periodName(berlin.starts_at, berlin.ends_at, 'Europe/Berlin'))
    expect(periodText(berlin, 'Europe/Berlin')).toContain('31') // the last day is Aug 31, not Sep 1
    expect(periodText(berlin, undefined)).toMatch(/(GMT|UTC)/)
  })

  it('says an unset large-line check in words, without the settings key', () => {
    expect(exceptionText({ kind: 'large_line_check_unset', message: 'The large-line check is not configured (runs.exception_thresholds).' })).not.toContain('runs.')
    expect(exceptionText({ kind: 'sync_stale', message: 'Order sync is failing.' })).toBe('Order sync is failing.')
  })
})

describe('PeriodsPage (SC-01)', () => {
  beforeEach(() => {
    navigation.search = `calendar=${CAL}`
    navigation.router.replace.mockReset()
  })

  it('shows the first calendar when the URL names none', async () => {
    navigation.search = ''
    renderAs(ANALYST, <PeriodsPage />, routes([M3]))
    await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(`/periods?calendar=${CAL}`))
  })

  it('shows the target period lifecycle, KPIs and blockers in words, and calculates with one Run-Request-Id per click', async () => {
    const fetchMock = routes([NOW, M1, M2, M3], {
      'POST /v1/periods/per-m2/runs': () => apiError(422, 'SYNC_BEHIND', 'Order sync of this market is behind or failing.', SYNC.details),
    })
    renderAs(ANALYST, <PeriodsPage />, fetchMock)
    const name = periodName(M2.starts_at, M2.ends_at, ZONE)
    const timeline = await screen.findByRole('region', { name: /Lifecycle/ })
    expect(within(timeline).getAllByRole('listitem').find((item) => item.getAttribute('aria-current') === 'step')?.textContent).toContain('Cut-off')
    expect(screen.getByTestId('kpis').textContent).toContain('1 blocker')
    expect(screen.getAllByText('Order sync failing for e2e-de — last successful sync never.').length).toBeGreaterThan(0)
    // BUG-089/092: short blocker labels, no raw codes, no "already committed" blocker beside a committed period.
    const table = screen.getByRole('table', { name: /Periods of/ })
    expect(within(table).getByText('Order sync behind')).toBeTruthy()
    expect(within(table).getByText('Before cut-off')).toBeTruthy()
    expect(within(table).queryByText('The period is already committed.')).toBeNull()
    expect(document.body.textContent).not.toMatch(/SYNC_BEHIND|BEFORE_CUTOFF|PRIOR_PERIOD_OPEN/)
    const calculate = screen.getByRole('button', { name: `Calculate ${name}` })
    await userEvent.click(calculate)
    expect(await screen.findByText('The calculation was refused: Order sync behind')).toBeTruthy()
    await userEvent.click(calculate)
    const ids = callsTo(fetchMock, 'POST', '/v1/periods/per-m2/runs').map(([, init]) => headerOf(init, 'run-request-id'))
    expect(ids).toHaveLength(2)
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(ids[0]).not.toBe(ids[1])
    // M1 waits for M2: no Calculate offered for a structural blocker.
    expect(screen.queryByRole('button', { name: `Calculate ${periodName(M1.starts_at, M1.ends_at, ZONE)}` })).toBeNull()
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe('/periods/late?state=pending&market_id=m1')
  })

  it('replays a committed period and shows the verdict with its hashes', async () => {
    const fetchMock = routes([NOW, M3], {
      'POST /v1/runs/run-m3/replay': () => ok({ status: 'match', inputs_hash: 'aa11', result_hash: 'bb22', lines_hash: 'cc33', engine_version: '0.2.0' }),
    })
    renderAs(ANALYST, <PeriodsPage />, fetchMock)
    await userEvent.click(await rowMenuItem(M3, 'Replay'))
    expect(await screen.findByText(/: Match$/)).toBeTruthy()
    expect(screen.getByTestId('replay-hashes').textContent).toContain('cc33')
  })

  it('offers Request restatement on a committed period, prefilled with it', async () => {
    renderAs(ANALYST, <PeriodsPage />, routes([NOW, M3], { 'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }) }))
    const name = periodName(M3.starts_at, M3.ends_at, ZONE)
    await userEvent.click(await rowMenuItem(M3, 'Request restatement of'))
    const dialog = await screen.findByRole('dialog', { name: 'Request restatement' })
    expect(dialog.textContent).toContain(name)
    expect(screen.getByRole('cell', { name: '47.00' })).toBeTruthy()
  })

  it('treats a Paid period like a committed one: restatement offered, no re-run (D-B4-24)', async () => {
    const paid = { ...M3, state: 'paid' as const }
    renderAs(ANALYST, <PeriodsPage />, routes([NOW, paid]))
    expect(await rowMenuItem(paid, 'Request restatement of')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /^Re-run/ })).toBeNull()
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0)
  })

  it('keeps the gross on one line with the currency only in the header (BUG-097)', async () => {
    renderAs(ANALYST, <PeriodsPage />, routes([NOW, { ...M3, latest_run: { ...M3.latest_run!, gross_minor: '-2600' } }]))
    expect(await screen.findByRole('columnheader', { name: 'Gross (EUR)' })).toBeTruthy()
    const cell = screen.getByRole('cell', { name: '-26.00' })
    expect(cell.querySelector('.whitespace-nowrap')?.textContent).toBe('-26.00')
    expect(cell.textContent).not.toContain('EUR')
  })

  it('below the large breakpoint keeps Period, State, Gross and Actions with blockers under the period (BUG-098)', async () => {
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal('matchMedia', matchMedia)
    try {
      renderAs(ANALYST, <PeriodsPage />, routes([NOW, M1, M3]))
      const table = await screen.findByRole('table', { name: 'Periods of DE monthly' })
      const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent)
      expect(headers).toEqual(['Period · cut-off', 'State', 'Gross (EUR)', 'Actions'])
      const row = within(table).getByRole('rowheader', { name: new RegExp(periodName(M1.starts_at, M1.ends_at, ZONE)) })
      expect(within(row).getByText('Previous period not committed')).toBeTruthy()
      expect(matchMedia).toHaveBeenCalledWith('(min-width: 1024px)')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens the review of a calculated target as the one primary action', async () => {
    const calculated = period('per-m2', 8, { state: 'calculated', latest_run: { id: 'run-m2', state: 'calculated', gross_minor: '4700', finished_at: '2026-10-02T10:00:00.000Z', true_up_runs: 0 } })
    renderAs(ANALYST, <PeriodsPage />, routes([NOW, calculated, M3], { 'GET /v1/runs/run-m2': () => ok({ id: 'run-m2', period_id: 'per-m2', state: 'calculated', progress: null, totals: null, error: null, inputs_hash: 'h', lines_hash: 'l', engine_version: '0.2.0', prepared_by: { id: 'u', display_name: 'Ann Analyst' }, review_opened_at: null, commit_requested_at: null, commit_requested_by: null, finished_at: null, committed_at: null, plan_version: { id: 'v', plan: { id: 'pl1', name: 'DE core' }, version: 1 }, provisional: null, true_up: null, credit_awards_minor: '0', snapshot: null }) }))
    const primary = await screen.findByTestId('primary-action')
    expect(primary.textContent).toContain('Open review')
    expect(primary.getAttribute('href')).toBe('/periods/per-m2/runs/run-m2/review')
    expect(await screen.findByText('Ann Analyst')).toBeTruthy()
    expect(await rowMenuItem(calculated, 'Re-run')).toBeTruthy()
  })

  it('keeps the target from the newest page while the table pages', async () => {
    const fetchMock = routes([NOW, M2, M3], {
      'GET /v1/periods': (query) => json(200, query.get('cursor') === 'p2'
        ? { data: { calendars: [CALENDAR], periods: [M3] }, meta: { next_cursor: null } }
        : { data: { calendars: [CALENDAR], periods: [NOW, M2] }, meta: { next_cursor: 'p2' } }),
    })
    renderAs(ANALYST, <PeriodsPage />, fetchMock)
    const calculate = `Calculate ${periodName(M2.starts_at, M2.ends_at, ZONE)}`
    expect(await screen.findByTestId('primary-action')).toBe(screen.getByRole('button', { name: calculate }))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('button', { name: `More actions for ${periodName(M3.starts_at, M3.ends_at, ZONE)}` })).toBeTruthy()
    expect((await screen.findByTestId('primary-action')).textContent).toContain(calculate)
  })

  it('hides every run control from a reader without run.execute, run.review or restatement.request', async () => {
    renderAs(READER, <PeriodsPage />, routes([NOW, M2, M3]))
    expect(await screen.findByRole('table', { name: 'Periods of DE monthly' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^(Calculate|Re-run|Replay|Request restatement|More actions)/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Open review/ })).toBeNull()
    expect(screen.queryByTestId('primary-action')).toBeNull()
    expect(screen.queryByText(/Statement|Ledger|Dry run|Paid out/i)).toBeNull()
  })

  it('keeps each row to one line: cut-off under the period, one action button plus a More actions menu (BUG-094)', async () => {
    renderAs(ANALYST, <PeriodsPage />, routes([NOW, M1, M2, M3]))
    const table = await screen.findByRole('table', { name: /Periods of/ })
    const name = periodName(M3.starts_at, M3.ends_at, ZONE)
    expect(within(table).queryByRole('columnheader', { name: 'Cut-off' })).toBeNull()
    const row = within(table).getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!
    expect(row.querySelector('th')!.textContent).toContain(`Cut-off ${cutOffText(M3.ends_at, ZONE)}`)
    // Committed with review rights: Open review shown, Replay and Request restatement behind the menu.
    expect(within(row).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent)).toEqual(['1', `Open review of ${name}`])
    expect(within(row).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([`More actions for ${name}`])
    // Blocker chips may wrap in a narrow cell instead of being clipped.
    expect(within(table).getByText('Previous period not committed').className).not.toContain('whitespace-nowrap')
    const more = within(row).getByRole('button', { name: `More actions for ${name}` })
    await userEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([`Replay ${name}`, `Request restatement of ${name}`])
    expect(document.activeElement).toBe(items[0])
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[0])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('is not available without period.read', () => {
    renderAs(adminMe({ permissions: ['order.read'] }), <PeriodsPage />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})
