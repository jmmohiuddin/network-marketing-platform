// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { BatchPage } from './batch-page'
import { PayoutBatchesPage } from './batches-page'
import { lastErrorText, totalsText } from './format'
import type { Batch, ProviderSummary } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/payouts',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const BATCH_ID = 'b0000000-0000-4000-8000-000000000001'
const MARKET: Market = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'de', time_zone: 'UTC', languages: ['de'], minor_unit: 2 }
const OFFICER_ROLE = { assignment_id: 'a1', role_id: 'r1', name: 'Payout officer', market_ids: null }
const PREPARER = adminMe({ permissions: ['payout.read', 'payout.prepare', 'payout.reconcile'], roles: [OFFICER_ROLE] })
const APPROVER = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000f2', email: 'fay@acme.example', display_name: 'Fay Finance' }, permissions: ['payout.read', 'payout.approve', 'ledger.read'] })
const READER = adminMe({ permissions: ['payout.read'] })
const FAY = { user_id: APPROVER.user.id, display_name: 'Fay Finance', email: 'fay@acme.example' }
const PAYEE = { id: 'p-a', external_ref: 'DE-A', display_name: 'Avery Test' }

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: BATCH_ID, market: { id: 'm1', code: 'DE' }, provider: { id: 'pc1', provider: 'Sandbox payouts', adapter: 'sandbox', state: 'recorded' },
    period: { id: 'per1', starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z', state: 'committed' },
    state: 'draft', total_minor: '2300', currency: 'EUR', line_count: 1,
    exclusions: [
      { participant: { id: 'p-b', external_ref: 'DE-B', display_name: 'Blake Test' }, reasons: [{ reason: 'bank_detail_cooling_off', detail: { until: '2026-11-21T09:00:00.000Z' } }] },
      { participant: { id: 'p-c', external_ref: 'DE-C', display_name: 'Casey Test' }, reasons: [{ reason: 'below_minimum', detail: { minimum_minor: '1000' } }, { reason: 'no_bank_details', detail: {} }, { reason: 'hold', detail: { hold_id: 'h1', reason: 'E2E hold', placed_at: '2026-11-10T09:00:00.000Z' } }] },
    ],
    instruction_counts: {}, prepared_by: { id: PREPARER.user.id, display_name: 'Ada Admin' }, submitted_by: null, approved_by: null,
    submitted_at: null, approved_at: null, cancelled_at: null, cancel_reason: null, created_at: '2026-11-18T08:00:00.000Z', eligible_approvers: null,
    ...overrides,
  }
}

const REVIEWED = (): Batch => batch({ state: 'reviewed', submitted_by: { id: PREPARER.user.id, display_name: 'Ada Admin' }, submitted_at: '2026-11-18T08:05:00.000Z', eligible_approvers: [FAY] })

const SUMMARY: ProviderSummary = {
  id: 'pc1', provider: 'Sandbox payouts', market_id: 'm1', in_transit: { count: 2, amount_minor: '4700' }, settled: { count: 1, amount_minor: '2300' },
  returned: { count: 0, amount_minor: '0' }, failed: { count: 3, amount_minor: '900' }, open_exceptions: 1,
}

function detailRoutes(view: () => Batch, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/payout-batches/${BATCH_ID}`]: () => ok(view()),
    [`GET /v1/payout-batches/${BATCH_ID}/lines`]: () => ok([{ participant: PAYEE, amount_minor: '2300', bank_detail: { id: 'v1', masked: 'DE•• •••• 3000' } }]),
    [`GET /v1/payout-batches/${BATCH_ID}/instructions`]: () => ok([]),
    'GET /v1/markets': () => ok([MARKET]),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockClear()
})

describe('PayoutBatchesPage (SC-03 list)', () => {
  function listRoutes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
    return fetchByRoute({
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/payout-batches': (query) => ok(query.get('state') === 'draft' ? [batch()] : query.get('state') === 'reviewed' ? [] : [batch(), batch({ id: 'b0000000-0000-4000-8000-000000000002', state: 'settled', approved_by: { id: 'f', display_name: 'Fay Finance' }, approved_at: '2026-10-02T10:00:00.000Z' })]),
      'GET /v1/payout-reconciliation/summary': () => ok({ providers: [SUMMARY] }),
      ...extra,
    })
  }

  it('shows the KPIs from real values and the batch register', async () => {
    renderAs(READER, <PayoutBatchesPage />, listRoutes())
    const kpis = await screen.findByTestId('kpis')
    expect(await within(kpis).findByText('23.00 EUR')).toBeTruthy()
    expect(within(kpis).getByText('47.00 EUR')).toBeTruthy()
    expect(within(kpis).getByText('2')).toBeTruthy()
    expect(within(kpis).getByText('3')).toBeTruthy()
    const table = await screen.findByRole('table', { name: 'Payout batches' })
    expect(within(table).getAllByRole('link', { name: /Batch b0000000, DE/ })).toHaveLength(2)
    expect(within(table).getByText('Draft')).toBeTruthy()
    expect(within(table).getByText(/Approved by Fay Finance/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare batch' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/wallet|countdown|cut-off in/i)
  })

  it('says why the KPIs are missing and offers a retry when their sources fail; Prepare waits for the markets', async () => {
    const user = userEvent.setup()
    let failing = true
    const fetchMock = listRoutes({
      'GET /v1/markets': () => (failing ? apiError(500, 'INTERNAL', 'Something went wrong.') : ok([MARKET])),
      'GET /v1/payout-reconciliation/summary': () => (failing ? apiError(500, 'INTERNAL', 'Something went wrong.') : ok({ providers: [SUMMARY] })),
    })
    renderAs(PREPARER, <PayoutBatchesPage />, fetchMock)
    const retry = await screen.findByRole('button', { name: 'Try again' })
    const kpis = screen.getByTestId('kpis')
    expect(within(kpis).getAllByText('Could not be loaded: retry above.')).toHaveLength(3)
    expect((screen.getByTestId('primary-action') as HTMLButtonElement).disabled).toBe(true)
    failing = false
    await user.click(retry)
    expect(await within(kpis).findByText('23.00 EUR')).toBeTruthy()
    expect(screen.queryByText('Could not be loaded: retry above.')).toBeNull()
    expect((screen.getByTestId('primary-action') as HTMLButtonElement).disabled).toBe(false)
    expect(callsTo(fetchMock, 'GET', '/v1/markets').length).toBeGreaterThan(1)
  })

  it('prepares a batch for a market and provider with an adapter, then opens it', async () => {
    const user = userEvent.setup()
    const fetchMock = listRoutes({
      'GET /v1/provider-configs': () => ok([
        { id: 'pc1', provider: 'Sandbox payouts', adapter: 'sandbox', state: 'recorded' },
        { id: 'pc2', provider: 'Unconfigured', adapter: null, state: 'recorded' },
      ]),
      'POST /v1/payout-batches': () => json(201, { data: batch(), meta: {} }),
    })
    renderAs(PREPARER, <PayoutBatchesPage />, fetchMock)
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Prepare batch' })
    await user.click(within(dialog).getByRole('button', { name: 'Prepare batch' }))
    expect(within(dialog).getAllByText('Choose the market to pay.').length).toBeGreaterThan(0)
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    const provider = await within(dialog).findByLabelText('Payout provider')
    await within(provider).findByRole('option', { name: /Sandbox payouts/ })
    expect(within(provider).queryByRole('option', { name: /Unconfigured/ })).toBeNull()
    await user.selectOptions(provider, 'pc1')
    await user.click(within(dialog).getByRole('button', { name: 'Prepare batch' }))
    await waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith(`/payouts/${BATCH_ID}`))
    const post = callsTo(fetchMock, 'POST', '/v1/payout-batches')[0]![1]
    expect(bodyOf(post)).toEqual({ market_id: 'm1', provider_config_id: 'pc1' })
    expect(headerOf(post, 'Idempotency-Key')).toBeTruthy()
  })

  it('says the providers are loading and keeps the provider field (the error summary links to it) until they answer', async () => {
    const user = userEvent.setup()
    let answer: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => { answer = resolve })
    // The route answers when the test says so: the fetch mock awaits the promise.
    renderAs(PREPARER, <PayoutBatchesPage />, listRoutes({ 'GET /v1/provider-configs': () => pending as unknown as Response }))
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Prepare batch' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    expect(await within(dialog).findByText("Loading the market's payout providers")).toBeTruthy()
    const provider = within(dialog).getByLabelText('Payout provider') as HTMLSelectElement
    expect(provider.disabled).toBe(true)
    await user.click(within(dialog).getByRole('button', { name: 'Prepare batch' }))
    expect(within(dialog).getAllByText('Choose the payout provider.').length).toBeGreaterThan(0)
    answer(ok([{ id: 'pc1', provider: 'Sandbox payouts', adapter: 'sandbox', state: 'recorded' }]))
    await within(provider).findByRole('option', { name: /Sandbox payouts/ })
    expect(provider.disabled).toBe(false)
    expect(within(dialog).queryByText("Loading the market's payout providers")).toBeNull()
  })

  it('offers only the markets of the preparer\'s payout.prepare scope', async () => {
    const user = userEvent.setup()
    const FR: Market = { ...MARKET, id: 'm2', code: 'FR', name: 'France' }
    const scoped = adminMe({ permissions: PREPARER.permissions, roles: [{ ...OFFICER_ROLE, market_ids: ['m2'] }] })
    renderAs(scoped, <PayoutBatchesPage />, listRoutes({ 'GET /v1/markets': () => ok([MARKET, FR]) }))
    await user.click(await screen.findByTestId('primary-action'))
    const market = within(screen.getByRole('dialog', { name: 'Prepare batch' })).getByLabelText('Market')
    expect(within(market).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a market', 'FR (EUR)'])
  })

  it('opens the open batch instead when the market already has one and words an unset setting', async () => {
    const user = userEvent.setup()
    let calls = 0
    renderAs(PREPARER, <PayoutBatchesPage />, listRoutes({
      'GET /v1/provider-configs': () => ok([{ id: 'pc1', provider: 'Sandbox payouts', adapter: 'sandbox', state: 'recorded' }]),
      'POST /v1/payout-batches': () => {
        calls += 1
        return calls === 1
          ? apiError(422, 'SETTING_NOT_CONFIGURED', 'The setting payouts.market_policy is not configured.', { key: 'payouts.market_policy' })
          : apiError(409, 'BATCH_OPEN', 'The market already has an open payout batch.', { batch_id: BATCH_ID })
      },
    }))
    await user.click(await screen.findByTestId('primary-action'))
    const dialog = screen.getByRole('dialog', { name: 'Prepare batch' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    await within(dialog).findByRole('option', { name: /Sandbox payouts/ })
    await user.selectOptions(within(dialog).getByLabelText('Payout provider'), 'pc1')
    await user.click(within(dialog).getByRole('button', { name: 'Prepare batch' }))
    expect(await within(dialog).findByText(/is not configured. A tenant admin sets it in Settings./)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Prepare batch' }))
    await waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith(`/payouts/${BATCH_ID}`))
  })
})

describe('BatchPage (SC-03 detail)', () => {
  it('shows the sandbox banner, reasons in words with dates, and lets the preparer submit', async () => {
    const user = userEvent.setup()
    let state: Batch = batch()
    const fetchMock = detailRoutes(() => state, {
      [`POST /v1/payout-batches/${BATCH_ID}/submit`]: () => {
        state = REVIEWED()
        return ok(state)
      },
    })
    renderAs(PREPARER, <BatchPage batchId={BATCH_ID} />, fetchMock)
    expect(await screen.findByText('Sandbox provider — no real money moves')).toBeTruthy()
    expect(await screen.findByText('DE•• •••• 3000')).toBeTruthy()
    const bar = screen.getByRole('region', { name: 'Approval' })
    expect(within(bar).queryByRole('button', { name: /Approve/ })).toBeNull()
    await user.click(within(bar).getByRole('button', { name: 'Submit for approval' }))
    expect(await screen.findByText('Batch submitted. A Finance approver approves it.')).toBeTruthy()
    expect(headerOf(callsTo(fetchMock, 'POST', `/v1/payout-batches/${BATCH_ID}/submit`)[0]![1], 'Idempotency-Key')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Approval' })).getByText('Can approve: Fay Finance (fay@acme.example)')).toBeTruthy()
  })

  it('words an unset dormant setting in the Dormant balances tab, with no retry', async () => {
    navigation.search = 'tab=dormant'
    renderAs(READER, <BatchPage batchId={BATCH_ID} />, detailRoutes(batch, {
      'GET /v1/payouts/dormant': () => apiError(422, 'SETTING_NOT_CONFIGURED', 'The setting payouts.dormant_after_days is not configured.', { key: 'payouts.dormant_after_days' }),
    }))
    expect(await screen.findByText('The setting "Dormant balance age" is not configured. A tenant admin sets it in Settings.')).toBeTruthy()
    expect(screen.queryByText(/payouts\.dormant_after_days/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('lists every exclusion reason in words', async () => {
    navigation.search = 'tab=exclusions'
    renderAs(READER, <BatchPage batchId={BATCH_ID} />, detailRoutes(batch))
    const table = await screen.findByRole('table', { name: 'Excluded payees and holds' })
    expect(within(table).getByText(/Bank details changed: cooling off until/)).toBeTruthy()
    expect(within(table).getByText('Below the market minimum of 10.00 EUR')).toBeTruthy()
    expect(within(table).getByText('No bank details on record')).toBeTruthy()
    expect(within(table).getByText(`On hold since ${formatDateTime('2026-11-10T09:00:00.000Z')}: E2E hold`)).toBeTruthy()
    expect(table.textContent).not.toMatch(/below_minimum|no_bank_details/)
    expect(screen.queryByRole('region', { name: 'Approval' })).toBeNull()
  })

  it('says when payables changed at submit and the batch is a draft again', async () => {
    const user = userEvent.setup()
    renderAs(PREPARER, <BatchPage batchId={BATCH_ID} />, detailRoutes(batch, {
      [`POST /v1/payout-batches/${BATCH_ID}/submit`]: () => apiError(409, 'BATCH_RECALCULATED', 'Payables changed since the batch was prepared.', { changed: [] }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Submit for approval' }))
    expect(await screen.findByText('The batch was recalculated')).toBeTruthy()
  })

  it('lets an eligible approver approve after step-up, keeping the Idempotency-Key', async () => {
    const user = userEvent.setup()
    let calls = 0
    const fetchMock = detailRoutes(REVIEWED, {
      [`POST /v1/payout-batches/${BATCH_ID}/approve`]: () => {
        calls += 1
        return calls === 1 ? apiError(403, 'STEP_UP_REQUIRED') : ok({ ...REVIEWED(), state: 'instructing', instruction_count: 1 })
      },
      'POST /v1/auth/sessions/current/step-up': () => ok({ assurance: 'aal2' }),
    })
    renderAs(APPROVER, <BatchPage batchId={BATCH_ID} />, fetchMock)
    const bar = await screen.findByRole('region', { name: 'Approval' })
    await user.click(within(bar).getByRole('button', { name: 'Approve 23.00 EUR' }))
    const dialog = screen.getByRole('dialog', { name: `Approve batch ${BATCH_ID.slice(0, 8)}` })
    expect(within(dialog).getByText(/You did not prepare or submit this batch/)).toBeTruthy()
    expect(within(dialog).queryByLabelText(/PIN/i)).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Approve 23.00 EUR' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Batch approved: 1 instruction written.')).toBeTruthy()
    const approvals = callsTo(fetchMock, 'POST', `/v1/payout-batches/${BATCH_ID}/approve`)
    expect(approvals).toHaveLength(2)
    expect(headerOf(approvals[0]![1], 'Idempotency-Key')).toBe(headerOf(approvals[1]![1], 'Idempotency-Key'))
  })

  it('names the eligible approvers when separation of duties refuses the approval', async () => {
    const user = userEvent.setup()
    renderAs(APPROVER, <BatchPage batchId={BATCH_ID} />, detailRoutes(REVIEWED, {
      [`POST /v1/payout-batches/${BATCH_ID}/approve`]: () => apiError(422, 'SOD_SELF_APPROVAL', 'You cannot approve a batch you prepared.', { eligible_approvers: [{ user_id: 'g', display_name: 'Gil Gold', email: 'gil@acme.example' }] }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Approve 23.00 EUR' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Approve 23.00 EUR' }))
    expect(await within(dialog).findByText(/Who can decide it: Gil Gold \(gil@acme.example\)/)).toBeTruthy()
  })

  it('hides Approve from the approver who prepared it and every action in a support session', async () => {
    const both = adminMe({ permissions: ['payout.read', 'payout.prepare', 'payout.approve'] })
    const first = renderAs(both, <BatchPage batchId={BATCH_ID} />, detailRoutes(REVIEWED))
    const bar = await screen.findByRole('region', { name: 'Approval' })
    expect(within(bar).queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(within(bar).getByText('You prepared or submitted this batch, so someone else must approve it.')).toBeTruthy()
    first.unmount()
    renderAs({ ...APPROVER, support_session: { id: 's1', tenant_slug: 'acme', ends_at: '2099-01-01T00:00:00.000Z', scope: { permissions: [] } } }, <BatchPage batchId={BATCH_ID} />, detailRoutes(REVIEWED))
    const readOnlyBar = await screen.findByRole('region', { name: 'Approval' })
    expect(within(readOnlyBar).queryAllByRole('button')).toHaveLength(0)
  })

  it('retries failed lines and lists the skipped payees with their reasons', async () => {
    const user = userEvent.setup()
    const failed = () => batch({ state: 'failed', instruction_counts: { failed: 2 }, submitted_by: { id: PREPARER.user.id, display_name: 'Ada Admin' } })
    renderAs(APPROVER, <BatchPage batchId={BATCH_ID} />, detailRoutes(failed, {
      [`POST /v1/payout-batches/${BATCH_ID}/retry-failed`]: () => ok({ batch: failed(), reinstructed: ['i9'], skipped: [{ participant: PAYEE, reasons: [{ reason: 'returned_payment_open', detail: { case_id: 'c1' } }] }] }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Retry failed lines' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Retry failed lines' })).getByRole('button', { name: 'Retry failed lines' }))
    expect(await screen.findByText('1 instruction sent again')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'returned-payment case' }).getAttribute('href')).toBe('/cases/c1')
  })

  it('names each skipped payee when no failed payee can be paid again (409 NOTHING_TO_RETRY)', async () => {
    const user = userEvent.setup()
    const failed = () => batch({ state: 'failed', instruction_counts: { failed: 2 }, submitted_by: { id: PREPARER.user.id, display_name: 'Ada Admin' } })
    const payees = [{ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', external_ref: 'DE-7', display_name: 'Robin Test' }, { id: '9b2f8c1e-1d4a-4f3b-8c2d-5e6f7a8b9c0d', external_ref: 'DE-9', display_name: null }]
    renderAs(APPROVER, <BatchPage batchId={BATCH_ID} />, detailRoutes(failed, {
      [`POST /v1/payout-batches/${BATCH_ID}/retry-failed`]: () => apiError(409, 'NOTHING_TO_RETRY', 'No failed payee can be paid again now.', {
        skipped: payees.map((participant) => ({ participant, reasons: [{ reason: 'hold', detail: { reason: 'Fraud review' } }] })),
      }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Retry failed lines' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Retry failed lines' })).getByRole('button', { name: 'Retry failed lines' }))
    expect(await screen.findByText('No failed payee can be paid again now')).toBeTruthy()
    expect(screen.getByText('Robin Test (DE-7)')).toBeTruthy()
    expect(screen.getByText('DE-9')).toBeTruthy()
    expect(screen.getAllByText('On hold: Fraud review')).toHaveLength(2)
    expect(screen.queryByText(/undefined/)).toBeNull()
  })

  it('generates the bank file after step-up and saves the CSV', async () => {
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => 'blob:bank')
    URL.revokeObjectURL = vi.fn()
    let calls = 0
    const view = () => batch({ state: 'instructing', provider: { id: 'pc2', provider: 'Bank file', adapter: 'bank_file_csv', state: 'recorded' }, instruction_counts: { pending: 1 } })
    const fetchMock = detailRoutes(view, {
      [`POST /v1/payout-batches/${BATCH_ID}/bank-file`]: () => {
        calls += 1
        return calls === 1 ? apiError(403, 'STEP_UP_REQUIRED') : new Response('end_to_end_id\ni1\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="payouts-${BATCH_ID}.csv"` } })
      },
      'POST /v1/auth/sessions/current/step-up': () => ok({ assurance: 'aal2' }),
    })
    renderAs(PREPARER, <BatchPage batchId={BATCH_ID} />, fetchMock)
    expect(screen.queryByText('Sandbox provider — no real money moves')).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Generate bank file' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText(/Bank file downloaded/)).toBeTruthy()
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(headerOf(callsTo(fetchMock, 'POST', `/v1/payout-batches/${BATCH_ID}/bank-file`)[1]![1], 'X-Requested-With')).toBe('fetch')
  })

  it('shows a non-id route as not available without asking the API', () => {
    const fetchMock = detailRoutes(batch)
    renderAs(READER, <BatchPage batchId="nope" />, fetchMock)
    expect(callsTo(fetchMock, 'GET', '/v1/payout-batches/nope')).toHaveLength(0)
  })
})

describe('payout helpers', () => {
  it('sums money per currency without floats and words dispatcher errors', () => {
    const markets = new Map([['m1', MARKET], ['m2', { ...MARKET, id: 'm2', code: 'AT' }], ['m3', { ...MARKET, id: 'm3', code: 'US', currency: 'USD' }]])
    expect(totalsText([{ minor: '9007199254740993', marketId: 'm1' }, { minor: '7', marketId: 'm2' }, { minor: '100', marketId: 'm3' }], markets)).toBe('90,071,992,547,410.00 EUR · 1.00 USD')
    expect(totalsText([], markets)).toBe('0')
    expect(totalsText([{ minor: '1', marketId: 'unknown' }], markets)).toBeNull()
    expect(lastErrorText('SIGNATURE_INVALID')).toBe('The signature check failed, so it was not sent.')
    expect(lastErrorText('R01 insufficient funds')).toBe('R01 insufficient funds')
  })
})
