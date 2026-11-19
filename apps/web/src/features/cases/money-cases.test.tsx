// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { adjustmentRefusal } from './adjustment-dialog'
import { decisionRefusal } from './case-actions'
import { approvalProgress, CaseDetailPage } from './case-detail'
import { CasesPage } from './cases-page'
import type { CaseDetail } from './types'
import { periodText } from '../periods/format'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const ANALYST = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000a1', email: 'ann@acme.example', display_name: 'Ann Analyst' },
  permissions: ['case.adjustment.read', 'case.adjustment.create', 'case.write_off.read', 'case.write_off.create', 'period.read', 'genealogy.read'],
})
const FINANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000f1', email: 'fay@acme.example', display_name: 'Fay Finance' },
  permissions: ['case.adjustment.read', 'case.adjustment.approve', 'case.write_off.read', 'case.write_off.approve'],
})
const CASE_ID = '00000000-0000-4000-8000-00000000ca5e'
const POSITION = '00000000-0000-4000-8000-0000000000b1'
const PERIOD = '00000000-0000-4000-8000-0000000000e1'
const CREATED = '2026-11-17T09:00:00.000Z'

function record(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: CASE_ID, type: 'adjustment', subject_type: 'position', subject_id: POSITION, reason_code: 'COMMISSION_ERROR', state: 'submitted',
    payload: { period_id: PERIOD, amount_minor: '500', note: 'Missed order' },
    effect_preview: {
      payee: { participant: { id: 'p-c', external_ref: 'DE-C', display_name: null }, position: { id: POSITION, position_ref: 'P-C' } },
      period: { id: PERIOD, starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z', state: 'open' },
      amount_minor: '500', approvals_required: 2, escalations: ['above_threshold'], included_in: 'next calculation of this period',
    },
    due_at: null, market_id: 'm1', opened_by: ANALYST.user.id, opened_by_kind: 'user', assigned_to: null, submitted_by: ANALYST.user.id,
    submitted_at: CREATED, decided_at: null, approval_id: null, created_at: CREATED, approvals_required: 2, first_approval: null,
    evidence: [], events: [{ id: 'ev1', occurred_at: CREATED, actor_id: ANALYST.user.id, kind: 'opened', data: null }],
    eligible_approvers: [{ user_id: FINANCE.user.id, display_name: 'Fay Finance', email: 'fay@acme.example' }],
    ...overrides,
  }
}

function detailRoutes(c: CaseDetail, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/cases/${CASE_ID}`]: () => ok(c),
    'GET /v1/markets': () => ok([MARKET]),
    [`GET /v1/positions/${POSITION}`]: () => ok({ id: POSITION, position_ref: 'P-C', market: { id: 'm1', code: 'DE' }, status: 'active', owner: null, parents: { sponsor: null, placement: null } }),
    [`GET /v1/periods/${PERIOD}`]: () => ok({ id: PERIOD, calendar_id: 'cal1', starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z' }),
    'GET /v1/periods': () => json(200, { data: { calendars: [], periods: [] }, meta: { next_cursor: null } }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
})

describe('money case words', () => {
  it('words ADJUSTMENT_BLOCKED as a related account and busy decisions as try again', async () => {
    const { ApiError } = await import('../../lib/api')
    expect((adjustmentRefusal(new ApiError(422, 'ADJUSTMENT_BLOCKED', 'blocked', { reason: 'related_party' })) as Error).message).toMatch(/related account/)
    expect((decisionRefusal(new ApiError(409, 'LEDGER_BUSY', 'busy')) as Error).message).toMatch(/Another posting or commit is using this market/)
    expect((decisionRefusal(new ApiError(409, 'PERIOD_NOT_OPEN', 'x', { state: 'busy' })) as Error).message).toMatch(/Decide the case again/)
    expect((decisionRefusal(new ApiError(409, 'PERIOD_NOT_OPEN', 'committed', { state: 'committed' })) as Error).message).toBe('committed')
  })

  it('says which approval a two-approval case is at', () => {
    expect(approvalProgress(record(), 'me')).toMatch(/approval 1 of 2 is not given yet/)
    const first = record({ first_approval: { approver: { id: 'u9', display_name: 'Gil Gold' }, decided_at: CREATED } })
    expect(approvalProgress(first, 'me')).toMatch(/^Approval 1 of 2 by Gil Gold on .* — awaiting a second approver\.$/)
  })
})

describe('SC-06 money cases', () => {
  it('shows the adjustment preview: payee, period, signed amount, two approvals and why', async () => {
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, detailRoutes(record()))
    const preview = (await screen.findByRole('heading', { name: 'Effect preview' })).closest('section')!
    expect(await within(preview).findByText('+5.00 EUR')).toBeTruthy()
    expect(within(preview).getByText('DE-C')).toBeTruthy()
    expect(within(preview).getByTestId('approvals-required').textContent).toContain('2 (two different approvers)')
    const reason = within(preview).getByText('The amount is above the second-approver threshold of the policy.').closest('li')!
    expect(reason.textContent).toContain('info') // an informational mark, not the error icon (BUG-103)
    expect(reason.textContent).not.toContain('error')
    expect(screen.getByTestId('approval-progress').textContent).toMatch(/approval 1 of 2 is not given yet/)
  })

  it('names the adjustment period in its calendar cut-off zone, not the market zone', async () => {
    const calendar = { id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'America/New_York', market: { id: 'm1', code: 'DE' }, plan: null }
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, detailRoutes(record(), {
      'GET /v1/periods': () => json(200, { data: { calendars: [calendar], periods: [] }, meta: { next_cursor: null } }),
    }))
    const preview = (await screen.findByRole('heading', { name: 'Effect preview' })).closest('section')!
    const bounds = { starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z' }
    expect(periodText(bounds, 'America/New_York')).not.toBe(periodText(bounds, 'Europe/Berlin'))
    expect(await within(preview).findByRole('link', { name: periodText(bounds, 'America/New_York') })).toBeTruthy()
  })

  it('words ADJUSTMENT_BLOCKED at submit as a related account', async () => {
    const open = record({ state: 'open', submitted_by: null, submitted_at: null, eligible_approvers: null })
    renderAs(ANALYST, <CaseDetailPage caseId={CASE_ID} />, detailRoutes(open, {
      [`POST /v1/cases/${CASE_ID}/submit`]: () => apiError(422, 'ADJUSTMENT_BLOCKED', 'Adjustments to this payee are blocked by the adjustment policy.', { reason: 'related_party' }),
    }))
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for decision' }))
    expect(await screen.findByText(/this payee is a related account/)).toBeTruthy()
  })

  it('records the first of two approvals and tells the approver a second one decides', async () => {
    const fetchMock = detailRoutes(record(), {
      [`POST /v1/cases/${CASE_ID}/decision`]: () => ok({ ...record(), first_approval: { approver: { id: FINANCE.user.id, display_name: 'Fay Finance' }, decided_at: CREATED } }),
    })
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Checked')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('First approval recorded. A second approver decides next.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/cases/${CASE_ID}/decision`)[0]![1])).toEqual({ decision: 'approve', reason: 'Checked' })
  })

  it('hides the decision from the first approver and names the first approval', async () => {
    const first = record({ first_approval: { approver: { id: FINANCE.user.id, display_name: 'Fay Finance' }, decided_at: CREATED } })
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, detailRoutes(first))
    expect((await screen.findByTestId('approval-progress')).textContent).toMatch(/^Approval 1 of 2 by you on .* — awaiting a second approver\.$/)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByText('You gave the first approval, so a second approver must decide it.')).toBeTruthy()
  })

  it('words a busy ledger when deciding a write-off', async () => {
    const writeOff = record({
      type: 'write_off', subject_type: 'ledger_account', subject_id: 'acc-1', reason_code: 'UNRECOVERABLE', payload: { amount_minor: '700', note: 'Gone' },
      effect_preview: {
        market: { id: 'm1', code: 'DE' }, payee: { id: 'p-a', external_ref: 'DE-A', display_name: 'Ann Example' },
        receivable_minor: '700', amount_minor: '700', after_minor: '0', outstanding_since: CREATED, eligible: true, approvals_required: 1, reasons: [],
      },
      approvals_required: 1,
    })
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, detailRoutes(writeOff, {
      [`POST /v1/cases/${CASE_ID}/decision`]: () => apiError(409, 'LEDGER_BUSY', 'The ledger of this market is being posted.'),
    }))
    const preview = (await screen.findByRole('heading', { name: 'Effect preview' })).closest('section')!
    expect(await within(preview).findByText('0.00 EUR')).toBeTruthy()
    expect(within(preview).getByText('Eligible for write-off under the policy.')).toBeTruthy()
    // BUG-103: the subject names whose receivable it is, not the ledger account id.
    expect(screen.getByRole('link', { name: 'DE-A · Ann Example' }).getAttribute('href')).toBe('/people/p-a')
    expect(screen.queryByText('acc-1')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'ok')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await within(dialog).findByText(/Another posting or commit is using this market right now/)).toBeTruthy()
  })

  it('shows a bank-detail change with masked accounts only', async () => {
    const bank = record({
      type: 'bank_detail', subject_type: 'participant', subject_id: 'p-b', reason_code: 'PAYEE_REQUEST', payload: { request_id: '00000000-0000-4000-8000-0000000000aa' },
      effect_preview: { current_masked: '•••• 3000', new_masked: '•••• 1234', scheme: 'iban', cooling_off_hours: 72, shared_with_count: 3, shared_account_threshold: 3, shared_above_threshold: true },
      approvals_required: 1,
    })
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, detailRoutes(bank, { 'GET /v1/participants/p-b': () => ok({ id: 'p-b', external_ref: 'DE-B', display_name: null }) }))
    const preview = (await screen.findByRole('heading', { name: 'Effect preview' })).closest('section')!
    expect(within(preview).getByText('•••• 3000')).toBeTruthy()
    expect(within(preview).getByText('•••• 1234')).toBeTruthy()
    expect(within(preview).getByText('72 hours without payouts after approval')).toBeTruthy()
    expect(within(preview).getByText(/shared by at least 3 payees/)).toBeTruthy()
    expect(screen.queryByText('Note')).toBeNull()
  })

  it('submits an open returned payment with the payout officer’s note', async () => {
    const officer = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000e9', email: 'pat@acme.example', display_name: 'Pat Payout' }, permissions: ['case.returned_payment.read', 'case.returned_payment.create'] })
    const returned = record({
      type: 'returned_payment', subject_type: 'payout_instruction', subject_id: 'i-1', reason_code: 'RETURNED_BY_BANK', state: 'open', opened_by: null, opened_by_kind: 'system',
      submitted_by: null, submitted_at: null, payload: { instruction_id: 'i-1' }, effect_preview: null, approvals_required: null, eligible_approvers: null,
    })
    const fetchMock = detailRoutes(returned, {
      [`PATCH /v1/cases/${CASE_ID}`]: () => ok({ ...returned, payload: { instruction_id: 'i-1', note: 'Account closed' } }),
      [`POST /v1/cases/${CASE_ID}/submit`]: () => ok({ ...returned, state: 'submitted' }),
    })
    renderAs(officer, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    expect(await screen.findByText('Returned by the bank')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Submit for decision' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit the returned payment' })
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Account closed')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit for decision' }))
    expect(await screen.findByText('Case submitted. A Finance approver decides it.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PATCH', `/v1/cases/${CASE_ID}`)[0]![1])).toEqual({ payload: { instruction_id: 'i-1', note: 'Account closed' } })
  })

  it('opens a new adjustment from the cases page with a signed amount in the market currency', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/cases/counts': () => ok([]),
      'GET /v1/cases': () => json(200, { data: [], meta: { next_cursor: null } }),
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'GET /v1/genealogy/search': () => ok([{ position_id: POSITION, position_ref: 'P-C', owner: { participant_id: 'p-c', external_ref: 'DE-C', display_name: null }, status: 'active', market_code: 'DE', leg: null }]),
      'GET /v1/periods': () => json(200, {
        data: {
          calendars: [{ id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: 'm1', code: 'DE' }, plan: null }],
          periods: [
            { id: PERIOD, calendar_id: 'cal1', starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z', cut_off_passed: true, state: 'open', committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 } },
            { id: 'per-old', calendar_id: 'cal1', starts_at: '2026-06-30T22:00:00.000Z', ends_at: '2026-07-31T22:00:00.000Z', cut_off_passed: true, state: 'paid', committed_run_id: null, latest_run: null, blockers: [], late: { pending: 0, decided: 0 } },
          ],
        },
        meta: { next_cursor: null },
      }),
      'POST /v1/cases': () => apiError(422, 'ADJUSTMENT_BLOCKED', 'Adjustments to this payee are blocked by the adjustment policy.', { reason: 'related_party' }),
    })
    renderAs(ANALYST, <CasesPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'New adjustment' }))
    const dialog = await screen.findByRole('dialog', { name: 'New adjustment' })
    await userEvent.type(within(dialog).getByLabelText('Payee position'), 'P-C{Enter}')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Choose P-C/ }))
    const period = within(dialog).getByLabelText('Period') as HTMLSelectElement
    expect([...period.options].map((option) => option.value)).toEqual(['', PERIOD]) // the Paid period is not offered
    await userEvent.selectOptions(period, PERIOD)
    await userEvent.type(within(dialog).getByLabelText('Amount (EUR)'), '5.001')
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'COMMISSION_ERROR')
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Missed order')
    await userEvent.upload(within(dialog).getByLabelText(/Evidence/), new File(['%PDF'], 'proof.pdf', { type: 'application/pdf' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open adjustment case' }))
    expect(within(dialog).getAllByText(/Enter a non-zero amount in EUR with at most 2 decimals/).length).toBeGreaterThan(0)
    await userEvent.clear(within(dialog).getByLabelText('Amount (EUR)'))
    await userEvent.type(within(dialog).getByLabelText('Amount (EUR)'), '5.00')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open adjustment case' }))
    expect(await within(dialog).findByText(/related account/)).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/cases')[0]![1])).toEqual({
      type: 'adjustment', subject_type: 'position', subject_id: POSITION, reason_code: 'COMMISSION_ERROR', payload: { period_id: PERIOD, amount_minor: '500', note: 'Missed order' },
    })
  })
})
