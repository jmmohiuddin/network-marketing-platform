// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json, noContent, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { calendarErrors } from './calendar-dialogs'
import { localBound, referencesText } from './format'
import { MarketsPage } from './markets-page'
import { marketErrors } from './structure-dialogs'
import type { Market } from '../../lib/markets'
import type { Calendar } from './types'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings/markets', useSearchParams: () => router.params }))

const FR: Market = { id: '0a000000-0000-4000-8000-000000000001', code: 'FR', name: 'France', currency: 'EUR', state: 'draft', market_pack: 'e2e-fixture', time_zone: 'Europe/Paris', languages: ['fr'], minor_unit: 2 }
const CAL: Calendar = {
  id: '0c000000-0000-4000-8000-000000000001', market: { id: FR.id, code: 'FR' }, name: 'FR monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Paris',
  first_period_start: '2027-01-01', periods: { count: 12, first_starts_at: '2026-12-31T23:00:00.000Z', last_ends_at: '2027-12-31T23:00:00.000Z', open: 12 },
  provisional_for: null, provisional_calendars: [],
}
const DE: Market = { ...FR, id: '0a000000-0000-4000-8000-000000000002', code: 'DE', name: 'Germany', time_zone: 'Europe/Berlin', languages: ['de'] }
const TENANT_ADMIN = { assignment_id: 'a1', role_id: 'r1', name: 'Tenant admin' }
const ADMIN = adminMe({ permissions: ['settings.manage', 'market.manage'], roles: [{ ...TENANT_ADMIN, market_ids: null }] })

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/markets': () => json(200, { data: [FR], meta: {} }),
    'GET /v1/brands': () => json(200, { data: [{ id: 'b1', name: 'Acme Nutrition' }], meta: {} }),
    'GET /v1/calendars': () => json(200, { data: [CAL], meta: {} }),
    ...extra,
  })
}

function onTab(tab: string) {
  router.params = new URLSearchParams(tab === 'markets' ? '' : `tab=${tab}`)
}

describe('MarketsPage', () => {
  it('lists markets with their state and a link to the launch checklist', async () => {
    onTab('markets')
    renderAs(ADMIN, <MarketsPage />, routes())
    const table = await screen.findByRole('table', { name: 'Markets' })
    expect(within(table).getByText('Draft')).toBeTruthy()
    expect(within(table).getByRole('link', { name: 'Launch checklist of FR' }).getAttribute('href')).toBe(`/settings/markets/${FR.id}`)
    expect(screen.getByTestId('primary-action').textContent).toContain('Add market')
  })

  it('creates a draft market with a reason and an Idempotency-Key', async () => {
    onTab('markets')
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/markets': () => json(201, { data: FR, meta: {} }) })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Add market' })
    await user.click(within(dialog).getByRole('button', { name: 'Add market' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Enter the reason for this change.')
    await user.type(within(dialog).getByLabelText('Country code'), 'fr')
    await user.type(within(dialog).getByLabelText('Currency'), 'eur')
    await user.type(within(dialog).getByLabelText('Time zone'), 'Europe/Paris')
    await user.type(within(dialog).getByLabelText('Languages'), 'fr')
    await user.type(within(dialog).getByLabelText('Market pack'), 'e2e-fixture')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Launch France')
    await user.click(within(dialog).getByRole('button', { name: 'Add market' }))
    expect(await screen.findByText('Market FR created as a draft.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/markets')[0]!
    expect(bodyOf(init)).toEqual({ code: 'FR', currency: 'EUR', time_zone: 'Europe/Paris', languages: ['fr'], market_pack: 'e2e-fixture', reason: 'Launch France' })
    expect(headerOf(init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('edits only the changed fields with PATCH', async () => {
    onTab('markets')
    const user = userEvent.setup()
    const fetchMock = routes({ 'PATCH /v1/markets/0a000000-0000-4000-8000-000000000001': () => json(200, { data: { ...FR, languages: ['fr', 'en'] }, meta: {} }) })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Edit market FR' }))
    const dialog = screen.getByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Languages'))
    await user.type(within(dialog).getByLabelText('Languages'), 'fr, en')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'English too')
    await user.click(within(dialog).getByRole('button', { name: 'Save market' }))
    expect(await screen.findByText('Market FR saved.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PATCH', `/v1/markets/${FR.id}`)[0]!
    expect(bodyOf(init)).toEqual({ languages: ['fr', 'en'], reason: 'English too' })
    expect(headerOf(init, 'X-Requested-With')).toBe('fetch')
  })

  it('names what references a market it refuses to delete', async () => {
    onTab('markets')
    const user = userEvent.setup()
    const fetchMock = routes({
      [`DELETE /v1/markets/${FR.id}`]: () => apiError(409, 'MARKET_REFERENCED', 'The market is referenced and cannot be deleted.', { references: { calendars: 1, grants: 0 } }),
    })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Delete market FR' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Not launching')
    await user.click(within(dialog).getByRole('button', { name: 'Delete market FR' }))
    expect(await within(dialog).findByText('The market is referenced and cannot be deleted. It is referenced by 1 calendar.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'DELETE', `/v1/markets/${FR.id}`)[0]![1])).toEqual({ reason: 'Not launching' })
  })

  it('creates a calendar only with a stated number of periods ahead', async () => {
    onTab('calendars')
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/calendars': () => json(201, { data: { calendar: CAL, generated: 12 }, meta: {} }) })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Add calendar' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), FR.id)
    await user.type(within(dialog).getByLabelText('Name'), 'FR monthly')
    await user.selectOptions(within(dialog).getByLabelText('Cadence'), 'monthly')
    await user.type(within(dialog).getByLabelText('Cut-off time zone'), 'Europe/Paris')
    await user.type(within(dialog).getByLabelText('First period starts'), '2027-01-01')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Monthly runs')
    await user.click(within(dialog).getByRole('button', { name: 'Add calendar' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Enter how many periods to generate, from 1 to 120.')
    await user.type(within(dialog).getByLabelText('Periods to generate'), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Add calendar' }))
    expect(await screen.findByText('Calendar FR monthly created with 12 periods.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/calendars')[0]![1])).toMatchObject({ periods_ahead: 12, cadence: 'monthly', first_period_start: '2027-01-01' })
  })

  it('creates a provisional calendar for a final calendar of the market and words a target refusal (D-V1A-02)', async () => {
    onTab('calendars')
    const user = userEvent.setup()
    const WEEKLY: Calendar = { ...CAL, id: '0c000000-0000-4000-8000-000000000002', name: 'FR weekly', cadence: 'weekly', provisional_for: { id: CAL.id, name: CAL.name } }
    let refused = true
    const fetchMock = routes({
      'GET /v1/calendars': () => ok([{ ...CAL, provisional_calendars: [{ id: WEEKLY.id, name: WEEKLY.name }] }, WEEKLY]),
      'POST /v1/calendars': () => {
        if (!refused) return json(201, { data: { calendar: WEEKLY, generated: 5 }, meta: {} })
        refused = false
        return apiError(422, 'PROVISIONAL_TARGET_INVALID', 'invalid', { reason: 'periods_not_nested' })
      },
    })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    expect(await screen.findByText('Provisional for FR monthly')).toBeTruthy()
    expect(screen.getByText('Final for: FR weekly')).toBeTruthy()
    await user.click(screen.getByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Add calendar' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), FR.id)
    const target = within(dialog).getByLabelText('Provisional for')
    expect(within(target).getAllByRole('option').map((option) => option.textContent)).toEqual(['None: a final calendar', 'FR monthly'])
    await user.selectOptions(target, CAL.id)
    await user.type(within(dialog).getByLabelText('Name'), 'FR advances')
    await user.selectOptions(within(dialog).getByLabelText('Cadence'), 'weekly')
    await user.type(within(dialog).getByLabelText('Cut-off time zone'), 'Europe/Paris')
    await user.type(within(dialog).getByLabelText('First period starts'), '2026-12-07')
    await user.type(within(dialog).getByLabelText('Periods to generate'), '5')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Weekly advances')
    await user.click(within(dialog).getByRole('button', { name: 'Add calendar' }))
    expect((await within(dialog).findAllByText(/periods would not fall inside final periods/)).length).toBeGreaterThan(0)
    await user.click(within(dialog).getByRole('button', { name: 'Add calendar' }))
    expect(await screen.findByText('Calendar FR weekly created with 5 periods.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/calendars')[1]![1])).toMatchObject({ provisional_for_calendar_id: CAL.id, cadence: 'weekly' })
  })

  it('shows a calendar’s periods with local-time bounds and explains a committed-period refusal', async () => {
    onTab('calendars')
    const user = userEvent.setup()
    const fetchMock = routes({
      [`GET /v1/calendars/${CAL.id}/periods`]: () => json(200, { data: [{ id: 'p1', starts_at: '2026-12-31T23:00:00.000Z', ends_at: '2027-01-31T23:00:00.000Z', state: 'open' }], meta: {} }),
      [`DELETE /v1/calendars/${CAL.id}`]: () => apiError(409, 'PERIOD_COMMITTED', 'The calendar has periods past open and cannot be deleted.', { periods_not_open: 2 }),
    })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    // Generated through is the last period end in the calendar's cut-off zone: Paris midnight, whatever the viewer's zone (BUG-054).
    const through = await screen.findByText(localBound('2027-12-31T23:00:00.000Z', 'Europe/Paris'))
    expect(through.textContent).toMatch(/00:00$/)
    await user.click(await screen.findByRole('button', { name: 'Periods of FR monthly' }))
    const drawer = screen.getByRole('dialog', { name: 'Periods of FR monthly' })
    expect(await within(drawer).findByText(localBound('2026-12-31T23:00:00.000Z', 'Europe/Paris'))).toBeTruthy()
    await user.click(within(drawer).getByRole('button', { name: 'Close panel' }))
    await user.click(screen.getByRole('button', { name: 'Delete calendar FR monthly' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong zone')
    await user.click(within(dialog).getByRole('button', { name: 'Delete calendar FR monthly' }))
    expect(await within(dialog).findByText('The calendar cannot be deleted: 2 periods are past open.')).toBeTruthy()
  })

  it('deletes a brand and reloads', async () => {
    onTab('brands')
    const user = userEvent.setup()
    const fetchMock = routes({ 'DELETE /v1/brands/b1': () => noContent() })
    renderAs(ADMIN, <MarketsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Delete brand Acme Nutrition' }))
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Reason'), 'Retired')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete brand Acme Nutrition' }))
    expect(await screen.findByText('Brand Acme Nutrition deleted.')).toBeTruthy()
  })

  it('shows no write control to a reader', async () => {
    onTab('markets')
    renderAs(adminMe({ permissions: ['market.signoff'] }), <MarketsPage />, routes())
    expect(await screen.findByRole('link', { name: 'Launch checklist of FR' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Add|Edit|Delete/ })).toBeNull()
  })

  it('offers market writes only within the user’s market scope', async () => {
    onTab('markets')
    const user = userEvent.setup()
    const scoped = adminMe({ permissions: ['settings.manage'], roles: [{ ...TENANT_ADMIN, market_ids: [FR.id] }] })
    const calendarOfDe: Calendar = { ...CAL, id: '0c000000-0000-4000-8000-000000000002', name: 'DE monthly', market: { id: DE.id, code: 'DE' } }
    const fetchMock = routes({
      'GET /v1/markets': () => json(200, { data: [DE, FR], meta: {} }),
      'GET /v1/calendars': () => json(200, { data: [calendarOfDe, CAL], meta: {} }),
    })
    const view = renderAs(scoped, <MarketsPage />, fetchMock)
    expect(await screen.findByRole('button', { name: 'Edit market FR' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit market DE' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete market DE' })).toBeNull()
    expect(screen.queryByTestId('primary-action')).toBeNull()
    view.unmount()
    onTab('calendars')
    renderAs(scoped, <MarketsPage />, fetchMock)
    expect(await screen.findByRole('button', { name: 'Rename calendar FR monthly' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rename calendar DE monthly' })).toBeNull()
    await user.click(screen.getByTestId('primary-action'))
    const options = within(screen.getByRole('dialog', { name: 'Add calendar' })).getAllByRole('option').map((option) => option.getAttribute('value'))
    expect(options).toContain(FR.id)
    expect(options).not.toContain(DE.id)
  })

  it('hides write controls in a support session', async () => {
    onTab('markets')
    const me = adminMe({ permissions: ['settings.manage'], support_session: { id: 's1', tenant_slug: 'acme', ends_at: '2026-11-17T12:00:00.000Z', scope: { permissions: ['settings.manage'] } } })
    renderAs(me, <MarketsPage />, routes())
    await screen.findByRole('table', { name: 'Markets' })
    expect(screen.queryByRole('button', { name: /Add|Edit|Delete/ })).toBeNull()
  })
})

describe('structure helpers', () => {
  it('counts references in words', () => {
    expect(referencesText({ calendars: 2, grants: 1, cases: 0 })).toBe('2 calendars, 1 role grant')
  })

  it('checks market and calendar forms', () => {
    expect(marketErrors({ code: 'XXX', currency: 'EU', time_zone: '', languages: ' , ', market_pack: 'p' }, true)).toMatchObject({
      'market-code': 'Enter the two-letter country code, for example FR.',
      'market-currency': 'Enter the three-letter currency code, for example EUR.',
      'market-languages': 'Enter at least one language, for example fr.',
    })
    expect(calendarErrors({ market_id: 'm', name: 'n', cadence: 'monthly', cutoff_time_zone: 'Europe/Paris', first_period_start: '2027-01-15', periods_ahead: '0', provisional_for: '' })).toMatchObject({
      'calendar-start': 'A monthly calendar starts on the first day of a month.',
      'calendar-ahead': 'Enter how many periods to generate, from 1 to 120.',
    })
  })
})
