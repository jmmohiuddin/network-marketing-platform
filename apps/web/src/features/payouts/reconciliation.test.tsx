// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { ReconciliationPage } from './reconciliation-page'
import type { PayoutException, ProviderSummary, ReconciliationItem } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/payouts/reconciliation',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const ITEM_ID = 'a0000000-0000-4000-8000-000000000001'
const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'de', time_zone: 'UTC', languages: ['de'], minor_unit: 2 }
const OFFICER = adminMe({ permissions: ['payout.read', 'payout.reconcile', 'ledger.read'] })
const READER = adminMe({ permissions: ['payout.read'] })

const SUMMARY: ProviderSummary = {
  id: 'pc2', provider: 'Bank file', market_id: 'm1', in_transit: { count: 1, amount_minor: '2300' }, settled: { count: 2, amount_minor: '4600' },
  returned: { count: 1, amount_minor: '2300' }, failed: { count: 0, amount_minor: '0' }, open_exceptions: 1,
}

const ITEM: ReconciliationItem = {
  id: ITEM_ID, batch_id: 'b0000000-0000-4000-8000-000000000001', market_id: 'm1', provider_config_id: 'pc2',
  participant: { id: 'p-a', external_ref: 'DE-A', display_name: 'Avery Test' }, amount_minor: '2300', currency: 'EUR', state: 'returned', provider_ref: 'sbx_1',
  last_error: 'R01 insufficient funds', returned_case_id: 'c1',
  events: [{ type: 'created', at: '2026-11-18T08:00:00.000Z', source: 'platform' }, { type: 'returned', at: '2026-11-18T09:00:00.000Z', source: 'provider' }],
}

const EXCEPTION: PayoutException = {
  id: 'e1', provider_config_id: 'pc2', kind: 'unknown_reference', reference: 'nope-1', amount_minor: '500', instruction_id: null, state: 'open',
  created_at: '2026-11-18T09:30:00.000Z', resolved_by: null, resolved_at: null, resolution_note: null,
}

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/markets': () => ok([MARKET]),
    'GET /v1/payout-reconciliation/summary': () => ok({ providers: [SUMMARY] }),
    'GET /v1/provider-configs': () => ok([{ id: 'pc2', provider: 'Bank file', adapter: 'bank_file_csv', state: 'recorded' }]),
    'GET /v1/payout-reconciliation/items': () => ok([ITEM]),
    'GET /v1/payout-exceptions': () => ok([EXCEPTION]),
    'GET /v1/ledger/entries': () => ok([{ id: 'je1', event_type: 'payout_returned', posted_at: '2026-11-18T09:00:00.000Z' }]),
    'GET /v1/ledger/entries/je1': () => ok({
      id: 'je1', event_type: 'payout_returned', posted_at: '2026-11-18T09:00:00.000Z', postings: [
        { id: 'x1', account: { id: 'a1', type: 'payout_in_transit' }, payee: null, debit_minor: '0', credit_minor: '2300' },
        { id: 'x2', account: { id: 'a2', type: 'payee_payable' }, payee: { id: 'p-a', external_ref: 'DE-A', display_name: 'Avery Test' }, debit_minor: '2300', credit_minor: '0' },
      ],
    }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockClear()
})

describe('ReconciliationPage (SC-34)', () => {
  it('shows KPI cards per provider, the instructions and the exceptions, without unbacked controls', async () => {
    renderAs(READER, <ReconciliationPage />, routes())
    const kpis = await screen.findByTestId('kpis')
    expect(within(kpis).getAllByText('23.00 EUR')).toHaveLength(2)
    expect(within(kpis).getByText('46.00 EUR')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Bank file · DE' })).toBeTruthy()
    const items = await screen.findByRole('table', { name: 'Payout instructions' })
    expect(within(items).getByText('R01 insufficient funds')).toBeTruthy()
    const exceptions = await screen.findByRole('table', { name: 'Payout exceptions' })
    expect(within(exceptions).getByText('Unknown reference')).toBeTruthy()
    expect(within(exceptions).queryByRole('button', { name: /Resolve/ })).toBeNull()
    expect(screen.queryByTestId('primary-action')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Reconciler|BAI2|Dossier|Notify payee|Batch resolve|wallet/i)
  })

  it('filters instructions by state through the URL', async () => {
    const user = userEvent.setup()
    navigation.search = 'state=returned'
    const fetchMock = routes()
    renderAs(READER, <ReconciliationPage />, fetchMock)
    await screen.findByRole('table', { name: 'Payout instructions' })
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/payout-reconciliation/items')[0]![0], 'http://x').searchParams.get('state')).toBe('returned')
    const chips = screen.getByRole('group', { name: 'Filter instructions by state' })
    expect(within(chips).getByRole('button', { name: 'Returned' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(chips).getByRole('button', { name: 'All' }))
    expect(navigation.router.replace).toHaveBeenLastCalledWith('/payouts/reconciliation')
  })

  it('lists open exceptions by default and resolved or all ones through the URL', async () => {
    const user = userEvent.setup()
    const fetchMock = routes()
    const first = renderAs(READER, <ReconciliationPage />, fetchMock)
    await screen.findByRole('table', { name: 'Payout exceptions' })
    const query = () => new URL(callsTo(fetchMock, 'GET', '/v1/payout-exceptions').at(-1)![0], 'http://x').searchParams
    expect(query().get('state')).toBe('open')
    const chips = screen.getByRole('group', { name: 'Filter exceptions by state' })
    expect(within(chips).getByRole('button', { name: 'Open' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(chips).getByRole('button', { name: 'Resolved' }))
    expect(navigation.router.replace).toHaveBeenLastCalledWith('/payouts/reconciliation?exceptions=resolved')
    first.unmount()
    navigation.search = 'exceptions=all'
    renderAs(READER, <ReconciliationPage />, fetchMock)
    await screen.findByRole('table', { name: 'Payout exceptions' })
    expect(query().has('state')).toBe(false)
  })

  it('offers Inspect on an exception only when its instruction is among the loaded ones', async () => {
    const other = 'c0000000-0000-4000-8000-000000000009'
    renderAs(READER, <ReconciliationPage />, routes({
      'GET /v1/payout-exceptions': () => ok([
        { ...EXCEPTION, id: 'e2', kind: 'duplicate_settlement', reference: 'sbx_1', instruction_id: ITEM_ID },
        { ...EXCEPTION, id: 'e3', kind: 'duplicate_settlement', reference: 'sbx_9', instruction_id: other },
      ]),
    }))
    const exceptions = await screen.findByRole('table', { name: 'Payout exceptions' })
    expect(await within(exceptions).findByRole('button', { name: `Inspect instruction ${ITEM_ID.slice(0, 8)}` })).toBeTruthy()
    expect(within(exceptions).queryByRole('button', { name: `Inspect instruction ${other.slice(0, 8)}` })).toBeNull()
  })

  it('inspects an instruction: events, postings for ledger readers and the returned-payment case', async () => {
    navigation.search = `item=${ITEM_ID}`
    renderAs(OFFICER, <ReconciliationPage />, routes())
    const drawer = await screen.findByRole('dialog', { name: `Instruction ${ITEM_ID.slice(0, 8)}` })
    expect(within(drawer).getByText('Returned by the bank')).toBeTruthy()
    expect(await within(drawer).findByText('Credit: Payout in transit')).toBeTruthy()
    expect(within(drawer).getByText('Debit: Payee payable (Avery Test (DE-A))')).toBeTruthy()
    expect(within(drawer).getByRole('link', { name: 'Open the returned-payment case' }).getAttribute('href')).toBe('/cases/c1')
  })

  it('shows no postings without ledger.read', async () => {
    navigation.search = `item=${ITEM_ID}`
    const fetchMock = routes()
    renderAs(READER, <ReconciliationPage />, fetchMock)
    const drawer = await screen.findByRole('dialog', { name: `Instruction ${ITEM_ID.slice(0, 8)}` })
    expect(within(drawer).queryByText('Ledger postings')).toBeNull()
    expect(callsTo(fetchMock, 'GET', '/v1/ledger/entries')).toHaveLength(0)
  })

  it('resolves an exception only with a note', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/payout-exceptions/e1/resolve': () => ok({ id: 'e1', state: 'resolved' }) })
    renderAs(OFFICER, <ReconciliationPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Resolve exception nope-1' }))
    const dialog = screen.getByRole('dialog', { name: 'Resolve unknown reference' })
    await user.click(within(dialog).getByRole('button', { name: 'Resolve exception' }))
    expect(within(dialog).getAllByText('Enter how the exception was resolved.').length).toBeGreaterThan(0)
    await user.type(within(dialog).getByLabelText('Note'), 'Not ours: bank confirmed')
    await user.click(within(dialog).getByRole('button', { name: 'Resolve exception' }))
    expect(await screen.findByText('Exception resolved.')).toBeTruthy()
    const post = callsTo(fetchMock, 'POST', '/v1/payout-exceptions/e1/resolve')[0]![1]
    expect(bodyOf(post)).toEqual({ note: 'Not ours: bank confirmed' })
    expect(headerOf(post, 'Idempotency-Key')).toBeTruthy()
  })

  it('imports a bank result file as text/csv and shows what changed; a bad row names its line', async () => {
    const user = userEvent.setup()
    let calls = 0
    const fetchMock = routes({
      'POST /v1/payout-providers/pc2/settlement-reports': () => {
        calls += 1
        return calls === 1
          ? apiError(422, 'REPORT_INVALID', 'Line 2: amount_minor is not valid.', { line: 2, message: 'amount_minor is not valid.' })
          : json(200, { data: { rows: 2, settled: 1, returned: 0, failed: 0, exceptions: 1, unchanged: 0 }, meta: {} })
      },
    })
    renderAs(OFFICER, <ReconciliationPage />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Import result file' })
    await user.upload(within(dialog).getByLabelText('Result file'), new File(['end_to_end_id,status,amount_minor,reason\ni1,settled,2300,\n'], 'result.csv', { type: 'text/csv' }))
    await user.click(within(dialog).getByRole('button', { name: 'Import file' }))
    expect(await within(dialog).findByText('Line 2: amount_minor is not valid.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Import file' }))
    expect(await screen.findByText('Result file imported: 2 rows')).toBeTruthy()
    expect(screen.queryByText('Result file imported.')).toBeNull() // one notice, not a toast as well (BUG-102)
    const posts = callsTo(fetchMock, 'POST', '/v1/payout-providers/pc2/settlement-reports')
    expect(headerOf(posts[1]![1], 'Content-Type')).toBe('text/csv')
    expect(String(posts[1]![1].body)).toContain('i1,settled,2300')
    expect(headerOf(posts[0]![1], 'Idempotency-Key')).toBe(headerOf(posts[1]![1], 'Idempotency-Key'))
  })
})
