// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, noContent, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { LedgerPage } from '../ledger/ledger-page'
import { OrdersPage } from '../orders/orders-page'
import { csvRowCount } from './list-tools'
import type { SavedView } from './saved-views'

const navigation = vi.hoisted(() => ({ search: '', pathname: '/orders', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
const saved = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../data/transfer', () => ({ saveFile: saved.saveFile }))

const M = '00000000-0000-4000-8000-0000000000d1'
const VIEW_ID = '00000000-0000-4000-8000-0000000000e1'
const ROLE = { assignment_id: 'a1', role_id: '00000000-0000-4000-8000-0000000000c1', name: 'Commission analyst', market_ids: null }
const ANALYST = adminMe({ permissions: ['order.read', 'ledger.read'], roles: [ROLE] })
const MARKET = { id: M, code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const VIEW: SavedView = {
  id: VIEW_ID, list: 'orders', name: 'DE customer orders', filters: { market_id: M, purpose: 'customer' }, columns: ['source_order_id', 'credited_at', 'buyer_ref', 'amount'],
  sort: 'amount_desc', is_default: true, shared_role: { id: ROLE.role_id, name: ROLE.name }, owner: { id: 'u1', display_name: 'Ada Admin' }, mine: true,
}
const csv = (text: string) => new Response(text, { status: 200, headers: { 'content-type': 'text/csv' } })

function orderRoutes(views: readonly SavedView[], extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/orders/summary': () => ok({ orders: 0, held: 0, late_pending: 0, purpose_missing: 0, attribution_conflict: 0 }),
    'GET /v1/orders': () => json(200, { data: [], meta: { next_cursor: null } }),
    'GET /v1/saved-views': () => ok(views),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.pathname = '/orders'
  navigation.router.replace.mockReset()
  saved.saveFile.mockReset()
})

describe('csvRowCount', () => {
  it('counts data records, not the header, and keeps quoted line breaks inside their record', () => {
    expect(csvRowCount('a,b\r\n1,x\r\n2,"y\r\nz"\r\n')).toBe(2)
    expect(csvRowCount('a,b\r\n')).toBe(0)
    expect(csvRowCount('a,b\r\n1,x')).toBe(1)
    expect(csvRowCount('')).toBe(0)
  })
})

/** Opens the sc_31 "Saved views" menu once the views have (re)loaded. */
async function openViews() {
  const button = await screen.findByRole('button', { name: 'Saved views' })
  await vi.waitFor(() => expect(button.getAttribute('aria-busy')).toBeNull())
  await userEvent.click(button)
}

describe('Saved views on SC-31 orders', () => {
  it('opens with the default view: its filters, sort and columns go to the URL', async () => {
    renderAs(ANALYST, <OrdersPage />, orderRoutes([VIEW]))
    await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledTimes(1))
    const url = new URL(String(navigation.router.replace.mock.calls[0]![0]), 'http://x')
    expect(url.searchParams.get('market_id')).toBe(M)
    expect(url.searchParams.get('purpose')).toBe('customer')
    expect(url.searchParams.get('sort')).toBe('amount_desc')
    expect(url.searchParams.get('columns')).toBe('source_order_id,credited_at,buyer_ref,amount')
    expect(url.searchParams.get('view')).toBe(VIEW_ID)
  })

  it('keeps a shared ?order= link and its inspector when a default view exists', async () => {
    navigation.search = 'order=o1'
    renderAs(ANALYST, <OrdersPage />, orderRoutes([VIEW], { 'GET /v1/orders/o1': () => apiError(404, 'NOT_FOUND', 'Not found.') }))
    await screen.findByText('No view applied')
    expect(navigation.router.replace).not.toHaveBeenCalled()
  })

  it('does not replace list state the URL already names', async () => {
    navigation.search = 'purpose=resale'
    const fetchMock = orderRoutes([VIEW])
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await screen.findByText('No view applied')
    expect(navigation.router.replace).not.toHaveBeenCalled()
  })

  it('saves the current filters, columns and sort as a default view shared with a role, with an Idempotency-Key', async () => {
    navigation.search = `market_id=${M}&purpose=customer&sort=amount_desc&columns=credited_at,amount`
    const fetchMock = orderRoutes([], { 'POST /v1/saved-views': () => ok(VIEW, 201) })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await openViews()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save current view' }))
    const dialog = screen.getByRole('dialog', { name: 'Save view' })
    await userEvent.type(within(dialog).getByLabelText('Name'), 'DE customer orders')
    await userEvent.click(within(dialog).getByLabelText('Open the list with this view'))
    await userEvent.selectOptions(within(dialog).getByLabelText('Share with a role'), ROLE.role_id)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save view' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/saved-views')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/saved-views')[0]!
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
    expect(bodyOf(init)).toEqual({
      list: 'orders', name: 'DE customer orders', filters: { market_id: M, purpose: 'customer' }, columns: ['source_order_id', 'credited_at', 'amount'],
      sort: 'amount_desc', is_default: true, shared_role_id: ROLE.role_id,
    })
  })

  it('renames, shares, unsets as default and deletes the applied own view; a shared view has no actions', async () => {
    navigation.search = `view=${VIEW_ID}&purpose=customer`
    const fetchMock = orderRoutes([VIEW, { ...VIEW, id: 'v2', name: 'Shared', mine: false, owner: { id: 'u2', display_name: 'Cal' } }], {
      [`PUT /v1/saved-views/${VIEW_ID}`]: () => ok({ ...VIEW, name: 'Renamed' }),
      [`DELETE /v1/saved-views/${VIEW_ID}`]: () => noContent(),
    })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await openViews()
    expect(screen.getByRole('menuitem', { name: 'Apply Shared · from Cal' })).toBeTruthy()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename DE customer orders' }))
    const rename = screen.getByRole('dialog', { name: 'Rename DE customer orders' })
    await userEvent.clear(within(rename).getByLabelText('Name'))
    await userEvent.type(within(rename).getByLabelText('Name'), 'Renamed')
    await userEvent.click(within(rename).getByRole('button', { name: 'Rename view' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', `/v1/saved-views/${VIEW_ID}`)).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'PUT', `/v1/saved-views/${VIEW_ID}`)[0]![1])).toMatchObject({ name: 'Renamed', is_default: true, shared_role_id: ROLE.role_id, sort: 'amount_desc' })

    await openViews()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop opening with DE customer orders' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', `/v1/saved-views/${VIEW_ID}`)).toHaveLength(2))
    expect(bodyOf(callsTo(fetchMock, 'PUT', `/v1/saved-views/${VIEW_ID}`)[1]![1])).toMatchObject({ is_default: false })

    await openViews()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share DE customer orders with a role' }))
    const share = screen.getByRole('dialog', { name: 'Share DE customer orders' })
    await userEvent.selectOptions(within(share).getByLabelText('Share with a role'), '')
    await userEvent.click(within(share).getByRole('button', { name: 'Save sharing' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'PUT', `/v1/saved-views/${VIEW_ID}`)).toHaveLength(3))
    expect(bodyOf(callsTo(fetchMock, 'PUT', `/v1/saved-views/${VIEW_ID}`)[2]![1])).toMatchObject({ shared_role_id: null })

    await openViews()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete DE customer orders' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete DE customer orders' })).getByRole('button', { name: 'Delete view' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'DELETE', `/v1/saved-views/${VIEW_ID}`)).toHaveLength(1))
  })

  it('marks the role field when the API refuses to share with a role that cannot read the list', async () => {
    const fetchMock = orderRoutes([], { 'POST /v1/saved-views': () => apiError(422, 'ROLE_NOT_SHAREABLE', 'Share a view only within a role you hold that can read this list.') })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await openViews()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save current view' }))
    const dialog = screen.getByRole('dialog', { name: 'Save view' })
    expect(within(dialog).getByText(/The role must be able to read this list/)).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Mine')
    const role = within(dialog).getByLabelText('Share with a role')
    await userEvent.selectOptions(role, ROLE.role_id)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save view' }))
    await vi.waitFor(() => expect(role.getAttribute('aria-invalid')).toBe('true'))
  })

  it('sorts, chooses columns (the order stays) and lists rows in the chosen sort', async () => {
    navigation.search = 'sort=amount_asc&columns=credited_at'
    const fetchMock = orderRoutes([])
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await screen.findByRole('table', { name: 'Orders' })
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual(['Order', 'Credited'])
    expect(callsTo(fetchMock, 'GET', '/v1/orders')[0]![0]).toContain('sort=amount_asc')
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'credited_at_asc')
    expect(navigation.router.replace).toHaveBeenLastCalledWith('/orders?sort=credited_at_asc&columns=credited_at', { scroll: false })
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose columns' })
    expect((within(dialog).getByLabelText('Order') as HTMLInputElement).disabled).toBe(true)
    await userEvent.click(within(dialog).getByLabelText('Credited'))
    await userEvent.click(within(dialog).getByLabelText('Tax'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply columns' }))
    expect(navigation.router.replace).toHaveBeenLastCalledWith('/orders?sort=amount_asc&columns=source_order_id%2Ctax', { scroll: false })
  })

  it('exports the orders with the list filters, sort and columns, names the row count, then saves the file', async () => {
    navigation.search = 'purpose=customer&sort=amount_desc&columns=credited_at,amount'
    const fetchMock = orderRoutes([], { 'GET /v1/orders/export': () => csv('source_order_id,credited_at,amount\r\nA,2026,1.00\r\nB,2026,2.00\r\n') })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Export orders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export orders' })
    expect(within(dialog).getByTestId('export-count').textContent).toBe('2 rows, with the columns and sort shown. The export is recorded in the audit log.')
    const url = callsTo(fetchMock, 'GET', '/v1/orders/export')[0]![0]
    expect(url).toContain('purpose=customer')
    expect(url).toContain('sort=amount_desc')
    expect(url).toContain('columns=source_order_id%2Ccredited_at%2Camount')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save CSV file' }))
    expect(saved.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'orders.csv')
  })

  it('words a refusal over the row cap with the counts', async () => {
    const fetchMock = orderRoutes([], { 'GET /v1/orders/export': () => apiError(422, 'EXPORT_ROW_CAP_EXCEEDED', 'Too many', { row_count: 120000, row_cap: 100000 }) })
    renderAs(ANALYST, <OrdersPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Export orders' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export orders' })
    expect(dialog.textContent).toContain('120,000 rows match, more than the 100,000 rows an export may hold.')
    expect(within(dialog).queryByRole('button', { name: 'Save CSV file' })).toBeNull()
  })
})

describe('Saved views and export on the SC-33 journal', () => {
  const FINANCE = adminMe({ permissions: ['ledger.read', 'ledger.export'], roles: [ROLE] })
  function ledgerRoutes(views: readonly SavedView[], extra: Record<string, (query: URLSearchParams) => Response> = {}) {
    return fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/ledger/summary': () => ok({ market: { id: M, code: 'DE', currency: 'EUR', minor_digits: 2 }, by_type: [], balanced: true, entry_count: 0 }),
      'GET /v1/dashboards/finance': () => json(200, { data: { market: MARKET, payables_minor: '0', in_transit_minor: '0', receivables_minor: '0', withholding_minor: '0', failed_payouts: { count: 0, amount_minor: '0' } }, meta: { definitions: [] } }),
      'GET /v1/ledger/entries': () => json(200, { data: [], meta: { next_cursor: null } }),
      'GET /v1/saved-views': () => ok(views),
      ...extra,
    })
  }
  beforeEach(() => {
    navigation.pathname = '/ledger'
  })

  it('applies a journal view: market, origin, sort and columns go to the URL', async () => {
    navigation.search = `market=${M}`
    const view: SavedView = { ...VIEW, list: 'ledger_entries', name: 'Journal oldest', filters: { market_id: M, origin_type: 'migration' }, columns: ['entry_id', 'posted_at'], sort: 'posted_at_asc', is_default: false }
    renderAs(FINANCE, <LedgerPage />, ledgerRoutes([view]))
    await openViews()
    await userEvent.click(screen.getByRole('menuitem', { name: /^Apply Journal oldest/ }))
    const url = new URL(String(navigation.router.replace.mock.calls.at(-1)![0]), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ market: M, origin: 'migration', sort: 'posted_at_asc', columns: 'entry_id,posted_at', view: VIEW_ID })
  })

  it('keeps an SC-02/SC-16 link to an entry (market and drawer) when a default journal view names another market', async () => {
    const ENTRY_ID = '00000000-0000-4000-8000-0000000000f1'
    navigation.search = `market=${M}&entry=${ENTRY_ID}`
    const view: SavedView = { ...VIEW, list: 'ledger_entries', name: 'AT journal', filters: { market_id: '00000000-0000-4000-8000-0000000000d2' }, columns: ['entry_id'], sort: 'posted_at_asc' }
    renderAs(FINANCE, <LedgerPage />, ledgerRoutes([view], { [`GET /v1/ledger/entries/${ENTRY_ID}`]: () => apiError(404, 'NOT_FOUND', 'Not found.') }))
    await screen.findByText('No view applied')
    expect(navigation.router.replace).not.toHaveBeenCalled()
  })

  it('filters by a view period outside the loaded period list instead of dropping it', async () => {
    const PERIOD = '00000000-0000-4000-8000-0000000000a9'
    navigation.search = `market=${M}&period=${PERIOD}&view=${VIEW_ID}`
    const fetchMock = ledgerRoutes([])
    renderAs(FINANCE, <LedgerPage />, fetchMock) // no period.read: the period list is empty
    await screen.findByRole('table', { name: /journal/i })
    expect(callsTo(fetchMock, 'GET', '/v1/ledger/entries')[0]![0]).toContain(`period_id=${PERIOD}`)
    expect(screen.getByText(/Period: Period/)).toBeTruthy()
  })

  it('exports the entries in the chosen sort; without ledger.export there is no export', async () => {
    navigation.search = `market=${M}&origin=migration&sort=posted_at_asc`
    const fetchMock = ledgerRoutes([], { 'GET /v1/ledger/entries/export': () => csv('entry_id\r\ne1\r\n') })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
    expect((await screen.findByTestId('export-count')).textContent).toContain('1 row,')
    const url = callsTo(fetchMock, 'GET', '/v1/ledger/entries/export')[0]![0]
    expect(url).toContain('origin_type=migration')
    expect(url).toContain('sort=posted_at_asc')
    expect(callsTo(fetchMock, 'GET', '/v1/ledger/entries')[0]![0]).toContain('sort=posted_at_asc')
    renderAs(ANALYST, <LedgerPage />, ledgerRoutes([]))
    await screen.findAllByLabelText('Sort')
    expect(screen.getAllByRole('button', { name: 'Export CSV' })).toHaveLength(1)
  })
})
