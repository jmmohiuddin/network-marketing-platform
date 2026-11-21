// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/api'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { asFieldIssue, normalRate, parseRatesCsv, rateRowOf, validFromOf } from './format'
import { LedgerPage } from './ledger-page'
import type { CreditBalance, CreditType, FxBatch, LedgerSummary } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('../../lib/leave-page', () => ({ leavePage: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/ledger',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const M = '00000000-0000-4000-8000-0000000000be'
const PAYEE = '00000000-0000-4000-8000-0000000000a1'
const TYPE_ID = '00000000-0000-4000-8000-0000000000c1'
const MARKET = { id: M, code: 'BE', name: 'Belgium', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Brussels', languages: ['en'], minor_unit: 2 }
const ALL_MARKETS = { assignment_id: 'a1', role_id: 'r1', name: 'Finance approver', market_ids: null }
const FINANCE = adminMe({ permissions: ['ledger.read', 'credit.read', 'credit.manage', 'fx.manage', 'fx.approve', 'participant.read'], roles: [ALL_MARKETS] })
const ANALYST = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000a9', email: 'ann@acme.example', display_name: 'Ann Analyst' },
  permissions: ['ledger.read', 'credit.read', 'fx.manage'], roles: [{ ...ALL_MARKETS, name: 'Commission analyst' }],
})
const SUMMARY: LedgerSummary = { market: { id: M, code: 'BE', currency: 'EUR', minor_digits: 2 }, by_type: [], balanced: true, entry_count: 0 }
const PRODUCT_CREDIT: CreditType = {
  id: TYPE_ID, code: 'PRODUCT_CREDIT', name: 'Product credit', unit_value_minor: '100', expiry_days: 30, expiry_notice_days: 7,
  redemption_scope: { markets: [M] }, taxable: false, active: true, updated_at: '2026-11-01T10:00:00.000Z',
}
const BALANCE: CreditBalance = {
  participant: { id: PAYEE, external_ref: 'BE-A' }, credit_type: { id: TYPE_ID, code: 'PRODUCT_CREDIT', name: 'Product credit' }, market_id: M,
  currency: 'EUR', balance_minor: '900', available_minor: '900', next_expiry: { on: '2026-12-31', amount_minor: '900' },
}
const BATCH: FxBatch = {
  id: '00000000-0000-4000-8000-0000000000f1', source: 'ECB reference', rows: [{ base: 'USD', quote: 'EUR', rate: '0.9300000000', valid_from: '2026-11-15T00:00:00.000Z' }],
  state: 'proposed', proposed_by: { id: ANALYST.user.id, name: 'Ann Analyst' }, proposed_at: '2026-11-20T10:00:00.000Z', decided_at: null, approver: null,
}

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/ledger/summary': () => ok(SUMMARY),
    'GET /v1/dashboards/finance': () => json(200, { data: null, meta: {} }),
    'GET /v1/credit-types': () => ok([PRODUCT_CREDIT]),
    'GET /v1/credits/balances': () => json(200, { data: [BALANCE], meta: { next_cursor: null, totals: [{ currency: 'EUR', balance_minor: '900', available_minor: '900' }] } }),
    'GET /v1/credits/redemptions': () => json(200, { data: [], meta: { next_cursor: null } }),
    'GET /v1/fx-rates': () => json(200, { data: [{ id: 'x1', base: 'CHF', quote: 'EUR', rate: '1.0412000000', source: 'ECB', valid_from: '2026-11-01T00:00:00.000Z', batch_id: 'b0', in_force: true }], meta: { next_cursor: null } }),
    'GET /v1/fx-rate-batches': () => json(200, { data: [BATCH], meta: { next_cursor: null } }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.router.replace.mockReset()
})

describe('FX and credit helpers', () => {
  it('pads rates to 10 decimals by string and refuses zero, signs and long fractions', () => {
    expect(normalRate('0.93')).toBe('0.9300000000')
    expect(normalRate('1')).toBe('1.0000000000')
    expect(normalRate('0')).toBeNull()
    expect(normalRate('-1.2')).toBeNull()
    expect(normalRate('0.12345678901')).toBeNull()
  })

  it('reads a day as 00:00 UTC and requires an offset on instants', () => {
    expect(validFromOf('2026-11-15')).toBe('2026-11-15T00:00:00Z')
    expect(validFromOf('2026-11-15T08:00:00+01:00')).toBe('2026-11-15T08:00:00+01:00')
    expect(validFromOf('2026-11-15T08:00:00')).toBeNull()
    expect(validFromOf('2026-01-01T00:00Z')).toBeNull()
    expect(validFromOf('2026-01-01T00:00+02:00')).toBeNull()
    expect(rateRowOf({ base: 'usd', quote: 'EUR', rate: '0.93', valid_from: '2026-11-15' })).toEqual({ row: { base: 'USD', quote: 'EUR', rate: '0.9300000000', valid_from: '2026-11-15T00:00:00Z' } })
    expect(rateRowOf({ base: 'EUR', quote: 'EUR', rate: '1', valid_from: '2026-11-15' })).toEqual({ issue: 'Base and quote must differ.' })
  })

  it('parses a rates CSV with its header and refuses other shapes', () => {
    expect(parseRatesCsv('base,quote,rate,valid_from\r\nUSD,EUR,0.93,2026-11-15\n')).toEqual({ rows: [{ base: 'USD', quote: 'EUR', rate: '0.93', valid_from: '2026-11-15' }] })
    expect(parseRatesCsv('pair,rate\nUSD/EUR,0.93')).toEqual({ error: 'The first line must be the header base,quote,rate,valid_from.' })
    expect(parseRatesCsv('base,quote,rate,valid_from\nUSD,EUR,0.93')).toEqual({ error: 'Line 2 has 3 values; each line needs base, quote, rate and valid_from.' })
    expect(parseRatesCsv('base,quote,rate,valid_from\n')).toEqual({ error: 'The file has no rate rows.' })
  })

  it('links a {field} refusal to its field', () => {
    const linked = asFieldIssue(new ApiError(422, 'VALIDATION_FAILED', 'Give the expiry and its notice days together, or neither.', { field: 'expiry_days' })) as ApiError
    expect(linked.details).toEqual({ issues: [{ path: 'expiry_days', message: 'Give the expiry and its notice days together, or neither.' }] })
  })
})

describe('SC-33 Credits tab (FR-FIN-006)', () => {
  it('lists credit types, balances with the lots drawer and redemptions, and never says "wallet"', async () => {
    navigation.search = `market=${M}&tab=credits&lots=${PAYEE}.${TYPE_ID}`
    const fetchMock = routes({
      'GET /v1/credits/lots': () => ok([{ award_id: 'aw1', run_id: 'r1', committed_at: '2026-12-01T10:00:00.000Z', expires_on: '2026-12-31', amount_minor: '900', remaining_minor: '900', notified_at: null, expired_at: null }]),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    const types = await screen.findByTestId('credit-types')
    expect(await within(types).findByText('Product credit')).toBeTruthy()
    expect(types.textContent).toContain('30 days · notice 7 days before')
    expect(types.textContent).toContain('BE · any item')
    expect(await screen.findByText(/Credits owed in this market: 9\.00 EUR, of which 9\.00 EUR not yet expired\./)).toBeTruthy()
    const drawer = await screen.findByRole('dialog', { name: 'Credits of BE-A' })
    expect(await within(drawer).findByText('No notice sent')).toBeTruthy()
    const [lotsUrl] = callsTo(fetchMock, 'GET', '/v1/credits/lots')[0]!
    expect(Object.fromEntries(new URL(lotsUrl, 'http://x').searchParams)).toEqual({ participant_id: PAYEE, credit_type_id: TYPE_ID, market_id: M })
    expect(screen.getByText('No redemption recorded')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/wallet|top up|buy credits/i)
  })

  it('creates a credit type with every term stated and an Idempotency-Key, refusing a missing taxable answer first', async () => {
    navigation.search = `market=${M}&tab=credits`
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/credit-types': () => json(201, { data: { ...PRODUCT_CREDIT, id: 'n', code: 'EVENT_VOUCHER' }, meta: {} }) })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Add credit type' }))
    const dialog = screen.getByRole('dialog', { name: 'Add credit type' })
    await user.type(within(dialog).getByLabelText('Code'), 'event_voucher')
    await user.type(within(dialog).getByLabelText('Name'), 'Event voucher')
    await user.type(within(dialog).getByLabelText(/Expires after/), '30')
    await user.click(within(dialog).getByRole('button', { name: 'Add credit type' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Give the expiry and the notice together, or neither.')
    expect(within(dialog).getByRole('alert').textContent).toContain('Say whether the credits are taxable.')
    await user.clear(within(dialog).getByLabelText(/Expires after/))
    await user.selectOptions(within(dialog).getByLabelText('Taxable'), 'yes')
    await user.click(within(dialog).getByRole('button', { name: 'Add credit type' }))
    expect(await screen.findByText('Credit type EVENT_VOUCHER created.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/credit-types')[0]!
    expect(bodyOf(init)).toEqual({ code: 'EVENT_VOUCHER', name: 'Event voucher', unit_value_minor: null, expiry_days: null, expiry_notice_days: null, redemption_scope: null, taxable: true })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('edits a type with expected_updated_at and hides writes from credit readers', async () => {
    navigation.search = `market=${M}&tab=credits`
    const user = userEvent.setup()
    const fetchMock = routes({ [`PATCH /v1/credit-types/${TYPE_ID}`]: () => ok({ ...PRODUCT_CREDIT, name: 'Product credit 2' }) })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Edit credit type PRODUCT_CREDIT' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit credit type PRODUCT_CREDIT' })
    await user.click(within(dialog).getByRole('button', { name: 'Save credit type' }))
    expect(await screen.findByText('Credit type PRODUCT_CREDIT saved.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PATCH', `/v1/credit-types/${TYPE_ID}`)[0]![1])).toMatchObject({ expected_updated_at: PRODUCT_CREDIT.updated_at, expiry_days: 30, expiry_notice_days: 7, redemption_scope: { markets: [M] }, taxable: false, active: true })
  })

  it('shows no credit type controls to a credit reader', async () => {
    navigation.search = `market=${M}&tab=credits`
    renderAs(ANALYST, <LedgerPage />, routes())
    expect(await screen.findByText('Product credit')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add credit type' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit credit type/ })).toBeNull()
  })
})

describe('SC-33 without ledger.read (PLAN V1-A section 3)', () => {
  it('opens only the Credits tab to a Support agent (credit.read) and loads no ledger figures', async () => {
    navigation.search = `market=${M}`
    const support = adminMe({ permissions: ['credit.read'], roles: [{ ...ALL_MARKETS, name: 'Support agent' }] })
    const fetchMock = routes()
    renderAs(support, <LedgerPage />, fetchMock)
    expect(await screen.findByTestId('credit-types')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Credits'])
    expect(callsTo(fetchMock, 'GET', '/v1/ledger/summary')).toHaveLength(0)
    expect(callsTo(fetchMock, 'GET', '/v1/dashboards/finance')).toHaveLength(0)
  })

  it('opens only the Exchange rates tab to an fx.approve holder', async () => {
    navigation.search = `market=${M}`
    renderAs(adminMe({ permissions: ['fx.approve'], roles: [ALL_MARKETS] }), <LedgerPage />, routes())
    expect(await screen.findByTestId('fx-batches')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Exchange rates'])
  })

  it('shows Not available without any of the permissions', async () => {
    renderAs(adminMe({ permissions: ['period.read'] }), <LedgerPage />, routes())
    expect(await screen.findByRole('heading', { name: /not available/i })).toBeTruthy()
  })
})

describe('SC-33 Exchange rates tab (FR-FIN-007)', () => {
  it('shows the rate in force trimmed for display and the proposer cannot decide their own batch', async () => {
    navigation.search = `market=${M}&tab=fx`
    renderAs(ANALYST, <LedgerPage />, routes())
    const rates = await screen.findByTestId('fx-rates')
    expect(await within(rates).findByText('1.0412')).toBeTruthy()
    expect(within(rates).getByText('In force')).toBeTruthy()
    const batches = screen.getByTestId('fx-batches')
    expect(await within(batches).findByText('ECB reference')).toBeTruthy()
    expect(within(batches).queryByRole('button', { name: /Approve batch/ })).toBeNull()
  })

  it('proposes rates read from a CSV file with an Idempotency-Key, and names a refused row', async () => {
    navigation.search = `market=${M}&tab=fx`
    const user = userEvent.setup()
    let refuse = true
    const fetchMock = routes({
      'POST /v1/fx-rate-batches': () => {
        if (!refuse) return json(201, { data: BATCH, meta: {} })
        refuse = false
        return apiError(409, 'RATE_EXISTS', 'A rate for this pair and validity start exists already.', { row: 0 })
      },
    })
    renderAs(ANALYST, <LedgerPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Propose rates' }))
    const dialog = screen.getByRole('dialog', { name: 'Propose exchange rates' })
    await user.upload(within(dialog).getByLabelText(/Rates file/), new File(['base,quote,rate,valid_from\nUSD,EUR,0.93,2026-11-15\n'], 'ecb.csv', { type: 'text/csv' }))
    await vi.waitFor(() => expect((within(dialog).getByLabelText('Base') as HTMLInputElement).value).toBe('USD'))
    expect((within(dialog).getByLabelText('Source') as HTMLInputElement).value).toBe('ecb.csv')
    await user.click(within(dialog).getByRole('button', { name: 'Propose 1 rate' }))
    expect(await within(dialog).findByText('Row 1: A rate for this pair and validity start exists already.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Propose 1 rate' }))
    expect(await screen.findByText('1 rate proposed. Another person must approve the batch.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/fx-rate-batches')[1]!
    expect(bodyOf(init)).toEqual({ source: 'ecb.csv', rows: [{ base: 'USD', quote: 'EUR', rate: '0.9300000000', valid_from: '2026-11-15T00:00:00Z' }] })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
  })

  it('says when the file cannot be read and drops row errors when the rows change', async () => {
    navigation.search = `market=${M}&tab=fx`
    const user = userEvent.setup()
    renderAs(ANALYST, <LedgerPage />, routes())
    await user.click(await screen.findByRole('button', { name: 'Propose rates' }))
    const dialog = screen.getByRole('dialog', { name: 'Propose exchange rates' })
    const unreadable = new File(['x'], 'broken.csv', { type: 'text/csv' })
    Object.defineProperty(unreadable, 'text', { value: () => Promise.reject(new Error('NotReadableError')) })
    await user.upload(within(dialog).getByLabelText(/Rates file/), unreadable)
    expect(await within(dialog).findByText('The file could not be read.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Add rate' }))
    await user.type(within(dialog).getAllByLabelText('Base')[0]!, 'USD')
    await user.click(within(dialog).getByRole('button', { name: 'Propose 2 rates' }))
    const invalid = () => within(dialog).getAllByLabelText('Base').map((input) => input.getAttribute('aria-invalid'))
    expect(invalid()).toEqual(['true', 'true'])
    await user.click(within(dialog).getByRole('button', { name: 'Remove rate 1' }))
    // The error of the removed row does not move onto the row left.
    expect(invalid()).toEqual([null])
  })

  it('approves a batch and shows a separation-of-duties refusal with the eligible approvers', async () => {
    navigation.search = `market=${M}&tab=fx`
    const user = userEvent.setup()
    let refuse = true
    const fetchMock = routes({
      [`POST /v1/fx-rate-batches/${BATCH.id}/decision`]: () => {
        if (!refuse) return ok({ ...BATCH, state: 'approved', released_orders: 1 })
        refuse = false
        return apiError(422, 'SOD_SELF_APPROVAL', 'You prepared or contributed to this, so someone else must decide it.', { eligible_approvers: [{ user_id: 'u2', display_name: 'Fred Finance', email: 'fred@acme.example' }] })
      },
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Approve batch from ECB reference' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve exchange rates' })
    await user.click(within(dialog).getByRole('button', { name: 'Approve 1 rate' }))
    expect(await within(dialog).findByText(/someone else must decide it\. Who can decide it: Fred Finance/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Approve 1 rate' }))
    expect(await screen.findByText('1 rate approved; 1 held order released.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/fx-rate-batches/${BATCH.id}/decision`)[1]![1])).toEqual({ decision: 'approve' })
  })
})
