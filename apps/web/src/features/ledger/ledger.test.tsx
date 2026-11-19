// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { periodText } from '../periods/format'
import { decimalToMinor } from './format'
import { LedgerPage } from './ledger-page'
import type { GlMapping, JournalEntry, LedgerSummary, Receivable } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() }, leavePage: vi.fn() }))
vi.mock('../../lib/leave-page', () => ({ leavePage: navigation.leavePage }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/ledger',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const M = '00000000-0000-4000-8000-0000000000d1'
const MARKET = { id: M, code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const CAL = { id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: M, code: 'DE' }, plan: null }
const PERIOD = { id: '00000000-0000-4000-8000-0000000000a3', calendar_id: 'cal1', starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z', cut_off_passed: true, state: 'paid', committed_run_id: 'r1', latest_run: null, blockers: [], late: { pending: 0, decided: 0 } }
const FINANCE_ROLE = { assignment_id: 'a1', role_id: 'r1', name: 'Finance approver', market_ids: null }
const FINANCE = adminMe({ permissions: ['ledger.read', 'ledger.export', 'period.read', 'run.review', 'case.write_off.create', 'case.write_off.read'], roles: [FINANCE_ROLE] })
const READER = adminMe({ permissions: ['ledger.read'], roles: [FINANCE_ROLE] })

const SUMMARY: LedgerSummary = {
  market: { id: M, code: 'DE', currency: 'EUR', minor_digits: 2 },
  by_type: [
    { type: 'commission_expense', normal: 'debit', debit_minor: '5200', credit_minor: '0', balance_minor: '5200' },
    { type: 'payee_payable', normal: 'credit', debit_minor: '2300', credit_minor: '5200', balance_minor: '2900' },
    { type: 'payout_in_transit', normal: 'credit', debit_minor: '0', credit_minor: '2300', balance_minor: '2300' },
    { type: 'clawback_receivable', normal: 'debit', debit_minor: '700', credit_minor: '0', balance_minor: '700' },
    { type: 'settled_clearing', normal: 'credit', debit_minor: '0', credit_minor: '700', balance_minor: '700' },
  ],
  balanced: true,
  entry_count: 3,
}
const ENTRY: JournalEntry = {
  id: '00000000-0000-4000-8000-00000000e001', event_type: 'run_committed', origin_type: 'run', origin_id: '00000000-0000-4000-8000-0000000000f1',
  idempotency_key: 'run:x', period: { id: PERIOD.id, starts_at: PERIOD.starts_at, ends_at: PERIOD.ends_at }, posted_at: '2026-09-02T10:00:00.000Z',
  approved_by: { id: 'u9', display_name: 'Fay Finance' }, debit_total_minor: '5200', posting_count: 3,
}
const RECEIVABLE = (participant: string, account: string, balance: string, overrides: Partial<Receivable> = {}): Receivable => ({
  participant: { id: participant, external_ref: participant.toUpperCase(), display_name: null }, market: { id: M, code: 'DE' }, account_id: account,
  balance_minor: balance, outstanding_since: '2026-09-02T10:00:00.000Z', age_days: 40, bucket: '31_60', write_off_eligible: true, open_write_off_case_id: null, ...overrides,
})
const MAPPINGS: GlMapping[] = [
  { account_type: 'commission_expense', gl_code: '5010', updated_by: { id: 'u9', display_name: 'Fay Finance' }, updated_at: '2026-09-01T10:00:00.000Z' },
  { account_type: 'payout_in_transit', gl_code: null, updated_by: null, updated_at: null },
]

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/ledger/summary': () => ok(SUMMARY),
    'GET /v1/periods': () => json(200, { data: { calendars: [CAL], periods: [PERIOD] }, meta: { next_cursor: null } }),
    'GET /v1/ledger/entries': () => json(200, { data: [ENTRY], meta: { next_cursor: null } }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = `market=${M}`
  navigation.router.replace.mockReset()
})

describe('decimalToMinor', () => {
  it('converts decimal text to minor units exactly and refuses extra decimals', () => {
    expect(decimalToMinor('12.5', 2)).toBe('1250')
    expect(decimalToMinor('-5.00', 2)).toBe('-500')
    expect(decimalToMinor('0', 2)).toBe('0')
    expect(decimalToMinor('1.234', 2)).toBeNull()
    expect(decimalToMinor('abc', 2)).toBeNull()
    expect(decimalToMinor('7', 0)).toBe('7')
  })
})

describe('LedgerPage (SC-33)', () => {
  it('shows the balance check, the four balances and the journal, with the payable label', async () => {
    renderAs(FINANCE, <LedgerPage />, routes())
    const banner = await screen.findByTestId('invariant')
    expect(banner.textContent).toContain('Balanced: debits = credits')
    expect(banner.textContent).toContain('Debits 82.00 EUR = Credits 82.00 EUR')
    const kpis = screen.getByTestId('kpis')
    expect(kpis.textContent).toContain('29.00 EUR')
    expect(kpis.textContent).toContain('Earnings balance owed by the tenant')
    expect(kpis.textContent).toContain('23.00 EUR')
    expect(kpis.textContent).toContain('7.00 EUR')
    const table = await screen.findByRole('table', { name: 'Journal entries' })
    expect(table.textContent).toContain('Run committed')
    expect(table.textContent).toContain('Fay Finance')
    expect(document.body.textContent).not.toMatch(/wallet|verified|ERP target/i)
  })

  it('redirects to the first market when none is chosen', async () => {
    navigation.search = 'tab=exports'
    renderAs(FINANCE, <LedgerPage />, routes())
    await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(`/ledger?tab=exports&market=${M}`))
  })

  it('offers and opens only the markets of the ledger.read scope', async () => {
    const at = '00000000-0000-4000-8000-0000000000d0'
    const scoped = adminMe({ permissions: FINANCE.permissions, roles: [{ ...FINANCE_ROLE, market_ids: [M] }] })
    const markets = () => ok([{ ...MARKET, id: at, code: 'AT', name: 'Austria' }, MARKET])
    navigation.search = ''
    renderAs(scoped, <LedgerPage />, routes({ 'GET /v1/markets': markets }))
    await vi.waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(`/ledger?market=${M}`))
    navigation.search = `market=${M}`
    renderAs(scoped, <LedgerPage />, routes({ 'GET /v1/markets': markets }))
    const select = await screen.findByLabelText('Market')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Germany (DE)'])
  })

  it('opens an entry in a drawer from ?entry= with its postings and approver', async () => {
    navigation.search = `market=${M}&entry=${ENTRY.id}`
    renderAs(FINANCE, <LedgerPage />, routes({
      [`GET /v1/ledger/entries/${ENTRY.id}`]: () => json(200, {
        data: { ...ENTRY, postings: [
          { id: 'x1', account: { id: 'a1', type: 'commission_expense' }, payee: null, debit_minor: '5200', credit_minor: '0' },
          { id: 'x2', account: { id: 'a2', type: 'payee_payable' }, payee: { id: 'p1', external_ref: 'DE-A', display_name: null }, debit_minor: '0', credit_minor: '5200' },
        ] },
        meta: { next_cursor: null },
      }),
    }))
    const drawer = await screen.findByRole('dialog', { name: /Journal entry/ })
    const postings = await within(drawer).findByRole('table', { name: 'Postings of the entry' })
    expect(postings.textContent).toContain('Commission expense')
    expect(postings.textContent).toContain('DE-A')
    expect(within(drawer).getByText('Fay Finance')).toBeTruthy()
  })

  it('opens ?account= from the id alone when the account is not on the loaded page', async () => {
    const account = '00000000-0000-4000-8000-0000000000c9'
    navigation.search = `market=${M}&tab=accounts&account=${account}`
    renderAs(FINANCE, <LedgerPage />, routes({
      'GET /v1/ledger/accounts': () => json(200, { data: [], meta: { next_cursor: null } }),
      [`GET /v1/ledger/accounts/${account}/postings`]: () => json(200, {
        data: [{ id: 'x9', debit_minor: '0', credit_minor: '700', entry: { id: ENTRY.id, event_type: 'run_committed', origin_type: 'run', origin_id: ENTRY.origin_id, period_id: PERIOD.id, posted_at: ENTRY.posted_at, approved_by: null } }],
        meta: { next_cursor: null },
      }),
    }))
    const drawer = await screen.findByRole('dialog', { name: /Ledger account/ })
    const postings = await within(drawer).findByRole('table', { name: /Postings of Ledger account/ })
    expect(await within(postings).findByText('7.00')).toBeTruthy()
  })

  it('filters accounts by ?payee= and names the payee in a chip', async () => {
    const payee = '00000000-0000-4000-8000-0000000000b7'
    navigation.search = `market=${M}&tab=accounts&payee=${payee}`
    const fetchMock = routes({
      'GET /v1/ledger/accounts': () => json(200, { data: [], meta: { next_cursor: null } }),
      [`GET /v1/participants/${payee}`]: () => ok({ id: payee, external_ref: 'DE-B', display_name: 'Bea' }),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    expect(await screen.findByText('Payee: DE-B · Bea')).toBeTruthy()
    const [url] = callsTo(fetchMock, 'GET', '/v1/ledger/accounts')[0]!
    expect(new URL(url, 'http://x').searchParams.get('payee_participant_id')).toBe(payee)
  })

  it('names entry periods from their bounds without period.read and says why there is no period filter', async () => {
    renderAs(READER, <LedgerPage />, routes())
    const table = await screen.findByRole('table', { name: 'Journal entries' })
    expect(await within(table).findByText(periodText(PERIOD, undefined))).toBeTruthy()
    expect(screen.queryByLabelText('Period')).toBeNull()
    expect(screen.getByText('Filtering by period needs read access to periods.')).toBeTruthy()
  })

  it('proposes a write-off: preview of count and total, then one case per payee opened and submitted', async () => {
    navigation.search = `market=${M}&tab=receivables`
    const fetchMock = routes({
      'GET /v1/ledger/receivables': () => json(200, {
        data: [RECEIVABLE('pa', 'acc-a', '700'), RECEIVABLE('pb', 'acc-b', '300'), RECEIVABLE('pc', 'acc-c', '100', { open_write_off_case_id: 'case-open' })],
        meta: { next_cursor: null, totals_by_bucket: [{ bucket: '0_30', count: 0, amount_minor: '0' }, { bucket: '31_60', count: 3, amount_minor: '1100' }] },
      }),
      'POST /v1/cases': () => ok({ id: `case-${callsTo(fetchMock, 'POST', '/v1/cases').length}`, state: 'open' }, 201),
      'POST /v1/cases/case-1/submit': () => ok({ id: 'case-1', state: 'submitted' }),
      'POST /v1/cases/case-2/submit': () => ok({ id: 'case-2', state: 'submitted' }),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    expect(await screen.findByText('31–60 days · 3')).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Select PC' })).toBeNull() // already has an open write-off
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PA' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PB' }))
    await userEvent.click(screen.getByRole('button', { name: 'Propose write-off' }))
    const dialog = await screen.findByRole('dialog', { name: 'Propose write-off' })
    const preview = within(dialog).getByTestId('write-off-preview')
    expect(preview.textContent).toContain('2')
    expect(preview.textContent).toContain('10.00 EUR')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open and submit 2 cases' }))
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(0)
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'UNRECOVERABLE')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Left the business')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open and submit 2 cases' }))
    expect(await screen.findByText('2 write-off cases submitted for a decision.')).toBeTruthy()
    const creates = callsTo(fetchMock, 'POST', '/v1/cases')
    expect(creates.map(([, init]) => bodyOf(init))).toEqual([
      { type: 'write_off', subject_type: 'ledger_account', subject_id: 'acc-a', reason_code: 'UNRECOVERABLE', payload: { amount_minor: '700', note: 'Left the business' } },
      { type: 'write_off', subject_type: 'ledger_account', subject_id: 'acc-b', reason_code: 'UNRECOVERABLE', payload: { amount_minor: '300', note: 'Left the business' } },
    ])
    expect(creates.every(([, init]) => headerOf(init, 'idempotency-key') !== null)).toBe(true)
    expect(callsTo(fetchMock, 'POST', '/v1/cases/case-1/submit')).toHaveLength(1)
  })

  it('shows a payee whose case opened but did not submit, and retries only the submit', async () => {
    navigation.search = `market=${M}&tab=receivables`
    let refuse = true
    const fetchMock = routes({
      'GET /v1/ledger/receivables': () => json(200, { data: [RECEIVABLE('pa', 'acc-a', '700')], meta: { next_cursor: null, totals_by_bucket: [] } }),
      'POST /v1/cases': () => ok({ id: 'case-1', state: 'open' }, 201),
      'POST /v1/cases/case-1/submit': () => (refuse ? apiError(422, 'SETTING_NOT_CONFIGURED', 'Set the write-off policy before writing off receivables.') : ok({ id: 'case-1', state: 'submitted' })),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select PA' }))
    await userEvent.click(screen.getByRole('button', { name: 'Propose write-off' }))
    const dialog = await screen.findByRole('dialog', { name: 'Propose write-off' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'OTHER')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'n')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open and submit one case' }))
    expect(await within(dialog).findByText(/opened, not submitted: Set the write-off policy/)).toBeTruthy()
    refuse = false
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try the failed ones again' }))
    expect(await screen.findByText('One write-off case submitted for a decision.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(1)
  })

  it('counts a retried submit whose first answer was lost as submitted', async () => {
    navigation.search = `market=${M}&tab=receivables`
    let lost = true
    const fetchMock = routes({
      'GET /v1/ledger/receivables': () => json(200, { data: [RECEIVABLE('pa', 'acc-a', '700')], meta: { next_cursor: null, totals_by_bucket: [] } }),
      'POST /v1/cases': () => ok({ id: 'case-1', state: 'open' }, 201),
      'POST /v1/cases/case-1/submit': () => (lost ? apiError(503, 'UNAVAILABLE', 'The service did not answer.') : apiError(409, 'CASE_STATE_CONFLICT', 'The case is submitted: this action is not possible now.', { state: 'submitted' })),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select PA' }))
    await userEvent.click(screen.getByRole('button', { name: 'Propose write-off' }))
    const dialog = await screen.findByRole('dialog', { name: 'Propose write-off' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'OTHER')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'n')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open and submit one case' }))
    expect(await within(dialog).findByText(/opened, not submitted/)).toBeTruthy()
    lost = false
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try the failed ones again' }))
    expect(await screen.findByText('One write-off case submitted for a decision.')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(1)
  })

  it('edits a GL code and generates an export, naming unmapped account types in words', async () => {
    navigation.search = `market=${M}&tab=mapping`
    const fetchMock = routes({
      'GET /v1/ledger/gl-mappings': () => ok(MAPPINGS),
      'PUT /v1/ledger/gl-mappings/00000000-0000-4000-8000-0000000000d1/payout_in_transit': () => ok({ account_type: 'payout_in_transit', gl_code: '2110' }),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    expect(await screen.findByText('1 of 2 account types mapped. An export needs a GL code for every account type it posts to.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Edit GL code of Payouts in transit' }))
    const dialog = await screen.findByRole('dialog', { name: 'GL code of Payouts in transit' })
    await userEvent.type(within(dialog).getByLabelText('GL code'), '-2110')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save GL code' }))
    expect(callsTo(fetchMock, 'PUT', `/v1/ledger/gl-mappings/${M}/payout_in_transit`)).toHaveLength(0)
    await userEvent.clear(within(dialog).getByLabelText('GL code'))
    await userEvent.type(within(dialog).getByLabelText('GL code'), '2110')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save GL code' }))
    expect(await screen.findByText('Payouts in transit maps to 2110.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', `/v1/ledger/gl-mappings/${M}/payout_in_transit`)[0]![1])).toEqual({ gl_code: '2110' })
  })

  it('generates an export of a paid period with an Idempotency-Key and words GL_MAPPING_MISSING', async () => {
    navigation.search = `market=${M}&tab=exports`
    const fetchMock = routes({
      'GET /v1/ledger/journal-exports': () => json(200, { data: [], meta: { next_cursor: null } }),
      'POST /v1/ledger/journal-exports': () => apiError(422, 'GL_MAPPING_MISSING', 'Map every account type to a GL code first.', { account_types: ['payout_in_transit', 'settled_clearing'] }),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD.id)
    await userEvent.click(screen.getByRole('button', { name: 'Generate journal export' }))
    expect(await screen.findByText('Map these account types to a GL code first: Payouts in transit, Settled clearing.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/ledger/journal-exports')[0]!
    expect(bodyOf(init)).toEqual({ period_id: PERIOD.id })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
  })

  it('downloads an export through the API client: full hash shown, an expired session leaves for sign-in', async () => {
    navigation.search = `market=${M}&tab=exports`
    const hash = 'ab'.repeat(32)
    const row = { id: 'x1', market: { id: M, code: 'DE' }, period: { id: PERIOD.id, starts_at: PERIOD.starts_at, ends_at: PERIOD.ends_at }, line_count: 4, debit_total_minor: '5200', credit_total_minor: '5200', content_sha256: hash, created_by: { id: 'u9', type: 'user' }, created_at: ENTRY.posted_at }
    const fetchMock = routes({
      'GET /v1/ledger/journal-exports': () => json(200, { data: [row], meta: { next_cursor: null } }),
      'GET /v1/ledger/journal-exports/x1/file': () => apiError(401, 'UNAUTHENTICATED'),
    })
    renderAs(FINANCE, <LedgerPage />, fetchMock)
    const table = await screen.findByRole('table', { name: 'Journal exports' })
    expect(await within(table).findByText(hash)).toBeTruthy()
    expect(table.textContent).toContain('SHA-256 of the stored gzip (not the CSV)')
    expect(table.textContent).toContain('52.00')
    expect(table.textContent).not.toContain('52.00 EUR')
    await userEvent.click(within(table).getByRole('button', { name: /Download the export/ }))
    await vi.waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith(expect.stringMatching(/^\/signin/)))
    expect(headerOf(callsTo(fetchMock, 'GET', '/v1/ledger/journal-exports/x1/file')[0]![1], 'accept')).toBe('text/csv')
  })

  it('is read-only without the write permissions: no write-off selection, no exports tab, no mapping edit', async () => {
    navigation.search = `market=${M}&tab=receivables`
    renderAs(READER, <LedgerPage />, routes({
      'GET /v1/ledger/receivables': () => json(200, { data: [RECEIVABLE('pa', 'acc-a', '700')], meta: { next_cursor: null, totals_by_bucket: [] } }),
    }))
    expect(await screen.findByText('PA')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Exports' })).toBeNull()
    expect(screen.queryByTestId('primary-action')).toBeNull()
  })

  it('is not available without ledger.read', () => {
    renderAs(adminMe({ permissions: ['period.read'] }), <LedgerPage />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})
