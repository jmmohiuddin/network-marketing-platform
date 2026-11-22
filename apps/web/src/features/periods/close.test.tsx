// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { periodName } from './format'
import { PeriodsPage } from './periods-page'
import type { Calendar, CloseCheck, PeriodRow } from './types'

const navigation = vi.hoisted(() => ({ router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/periods',
  useSearchParams: () => new URLSearchParams('calendar=00000000-0000-4000-8000-0000000ca1e0'),
}))

const CAL = '00000000-0000-4000-8000-0000000ca1e0'
const ZONE = 'Europe/Berlin'
const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: ZONE, languages: ['de'], minor_unit: 2 }
const CALENDAR: Calendar = { id: CAL, name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: ZONE, market: { id: 'm1', code: 'DE' }, plan: { id: 'pl1', name: 'DE core' }, provisional_for: null, provisional_calendars: [] }
const FINANCE = adminMe({ permissions: ['period.read', 'period.close'] })
const READER = adminMe({ permissions: ['period.read'] })

function period(id: string, month: number, overrides: Partial<PeriodRow> = {}): PeriodRow {
  return {
    id, calendar_id: CAL, starts_at: new Date(Date.UTC(2026, month, 1)).toISOString(), ends_at: new Date(Date.UTC(2026, month + 1, 1)).toISOString(),
    cut_off_passed: true, state: 'open', committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 }, closed_at: null, closed_by: null, ...overrides,
  }
}

const PAID = period('per-paid', 6, { state: 'paid' })
const CLOSED = period('per-closed', 5, { state: 'closed', closed_at: '2026-08-02T09:00:00.000Z', closed_by: FINANCE.user.id })
const OPEN = period('per-open', 7)
const name = (row: PeriodRow) => periodName(row.starts_at, row.ends_at, ZONE)

function routes(check: CloseCheck, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  const periods = [OPEN, PAID, CLOSED]
  return fetchByRoute({
    'GET /v1/periods': () => json(200, { data: { calendars: [CALENDAR], periods }, meta: { next_cursor: null } }),
    'GET /v1/markets': () => ok([MARKET]),
    ...Object.fromEntries(periods.map((row) => [`GET /v1/periods/${row.id}`, () => ok({ ...row, market_id: 'm1', runs: [], plan_version: null, sync: { state: 'healthy', last_sync_at: null, sources: [] }, late: { ...row.late, consumed: 0 }, restatements: [] })])),
    [`GET /v1/periods/${PAID.id}/close-check`]: () => ok(check),
    ...extra,
  })
}

describe('SC-01 Close period (D-B6-04)', () => {
  it('shows the Closed chip with who closed it and when', async () => {
    renderAs(READER, <PeriodsPage />, routes({ state: 'paid', closable: true, blockers: [], gl_unmapped: [] }))
    expect(await screen.findByText(/Closed .* by you/)).toBeTruthy()
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: `Close ${name(PAID)}` })).toBeNull()
  })

  it('lists the blockers by kind with links and the GL mapping gaps, and refuses to close', async () => {
    const check: CloseCheck = {
      state: 'paid', closable: false,
      blockers: [{ kind: 'returned_payment_case', id: 'case-1' }, { kind: 'late_item_pending', id: 'late-1' }, { kind: 'payout_in_transit', id: 'ins-1' }],
      gl_unmapped: ['migration_clearing'],
    }
    const fetchMock = routes(check)
    renderAs(FINANCE, <PeriodsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: `Close ${name(PAID)}` }))
    const dialog = await screen.findByRole('dialog')
    const blockers = await within(dialog).findByTestId('close-blockers')
    expect(within(blockers).getByRole('link', { name: 'Open the case case-1' }).getAttribute('href')).toBe('/cases/case-1')
    expect(within(blockers).getByRole('link', { name: 'Open the late-transaction queue late-1' }).getAttribute('href')).toBe('/periods/late?state=pending&market_id=m1')
    expect(within(blockers).getByRole('link', { name: 'Open the payout instruction ins-1' }).getAttribute('href')).toBe('/payouts/reconciliation?item=ins-1')
    expect(within(blockers).getByRole('link', { name: 'Open the GL mapping' }).getAttribute('href')).toContain('tab=mapping')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'All exceptions resolved')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close period' }))
    expect(await within(dialog).findByText('Resolve every listed item before closing the period.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', `/v1/periods/${PAID.id}/close`)).toHaveLength(0)
  })

  it('says the close check could not be loaded instead of asking to resolve listed items', async () => {
    const fetchMock = routes({ state: 'paid', closable: true, blockers: [], gl_unmapped: [] }, {
      [`GET /v1/periods/${PAID.id}/close-check`]: () => apiError(409, 'PERIOD_STATE', 'The service is unavailable.'),
    })
    renderAs(FINANCE, <PeriodsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: `Close ${name(PAID)}` }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/The close check could not be loaded\. The service is unavailable/)).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText('Note'), 'All exceptions resolved')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close period' }))
    expect(await within(dialog).findByText('The close check could not be loaded; try again.')).toBeTruthy()
    expect(within(dialog).queryByText('Resolve every listed item before closing the period.')).toBeNull()
    expect(callsTo(fetchMock, 'POST', `/v1/periods/${PAID.id}/close`)).toHaveLength(0)
  })

  it('closes a period without blockers with the note and an Idempotency-Key', async () => {
    const fetchMock = routes({ state: 'paid', closable: true, blockers: [], gl_unmapped: [] }, {
      [`POST /v1/periods/${PAID.id}/close`]: () => ok({ period: { id: PAID.id, state: 'closed', closed_at: '2026-11-20T10:00:00.000Z', closed_by: FINANCE.user.id }, journal_export_id: 'je-1' }),
    })
    renderAs(FINANCE, <PeriodsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: `Close ${name(PAID)}` }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Nothing stops the close.')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close period' }))
    expect((await within(dialog).findAllByText('Enter a note on why the period can be closed.')).length).toBeGreaterThan(0)
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Reconciled')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close period' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `/v1/periods/${PAID.id}/close`)).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'POST', `/v1/periods/${PAID.id}/close`)[0]!
    expect(bodyOf(init)).toEqual({ note: 'Reconciled' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('shows a refusal that names new blockers', async () => {
    const fetchMock = routes({ state: 'paid', closable: true, blockers: [], gl_unmapped: [] }, {
      [`POST /v1/periods/${PAID.id}/close`]: () => apiError(422, 'GL_MAPPING_MISSING', 'Map every account type of the period to a GL account first.'),
    })
    renderAs(FINANCE, <PeriodsPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: `Close ${name(PAID)}` }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Nothing stops the close.')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Reconciled')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close period' }))
    expect(await within(dialog).findByText('Map every account type of the period to a GL account first.')).toBeTruthy()
  })
})
