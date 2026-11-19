// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, renderAs } from '../admin/test-support'
import { currentPeriodId } from './adjustment-dialog'
import { CaseDetailPage } from './case-detail'
import { CasesPage } from './cases-page'
import type { CaseDetail, CaseRecord } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const ANALYST = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000a1', email: 'ann@acme.example', display_name: 'Ann Analyst' },
  permissions: ['case.dispute.read', 'case.dispute.approve', 'case.adjustment.read', 'case.adjustment.create', 'restatement.request', 'trace.read', 'case.write_off.read'],
})
const DPO = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000d1', email: 'dee@acme.example', display_name: 'Dee DPO' }, permissions: ['privacy.manage', 'participant.read'] })
const DPO2 = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000d2', email: 'dan@acme.example', display_name: 'Dan DPO' }, permissions: ['privacy.manage', 'participant.read'] })
const CASE_ID = '00000000-0000-4000-8000-00000000ca5e'
const LINE = '00000000-0000-4000-8000-0000000001e1'
const RUN = '00000000-0000-4000-8000-0000000000r1'
const POSITION = '00000000-0000-4000-8000-0000000000b1'
const PERIOD = '00000000-0000-4000-8000-0000000000e1'
const REQUEST = '00000000-0000-4000-8000-0000000000f1'
const SUBJECT = '00000000-0000-4000-8000-0000000000c1'
const PORTAL_USER = '00000000-0000-4000-8000-0000000000p1'
const CREATED = '2026-11-17T09:00:00.000Z'
const BOUNDS = { starts_at: '2026-07-31T22:00:00.000Z', ends_at: '2026-08-31T22:00:00.000Z' }

function caseOf(overrides: Partial<CaseDetail>): CaseDetail {
  return {
    id: CASE_ID, type: 'dispute', subject_type: 'result_line', subject_id: LINE, reason_code: 'DISTRIBUTOR_DISPUTE', state: 'submitted',
    payload: { line_id: LINE, run_id: RUN, participant_id: SUBJECT, message: 'Volume missing', trace: { rankEvaluated: 'Gold', sources: [] } },
    effect_preview: { line: { id: LINE, amount_minor: '2300', currency: 'EUR', rule_key: 'unilevel' }, position: { id: POSITION, position_ref: 'P-A' }, run_id: RUN, period: { id: PERIOD, ...BOUNDS } },
    due_at: '2099-11-27T09:00:00.000Z', market_id: 'm1', opened_by: PORTAL_USER, opened_by_kind: 'user', assigned_to: null, submitted_by: PORTAL_USER,
    submitted_at: CREATED, decided_at: null, approval_id: null, created_at: CREATED, evidence: [],
    events: [{ id: 'ev1', occurred_at: CREATED, actor_id: PORTAL_USER, kind: 'opened', data: null }],
    eligible_approvers: [{ user_id: ANALYST.user.id, display_name: 'Ann Analyst', email: 'ann@acme.example' }],
    ...overrides,
  }
}

function routes(c: CaseDetail, extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    [`GET /v1/cases/${CASE_ID}`]: () => ok(c),
    'GET /v1/markets': () => ok([MARKET]),
    [`GET /v1/positions/${POSITION}`]: () => ok({ id: POSITION, position_ref: 'P-A', market: { id: 'm1', code: 'DE' }, status: 'active', owner: null, parents: { sponsor: null, placement: null } }),
    [`GET /v1/periods/${PERIOD}`]: () => ok({ id: PERIOD, calendar_id: 'cal1', ...BOUNDS }),
    'GET /v1/periods': () => json(200, { data: { calendars: [], periods: [] }, meta: { next_cursor: null } }),
    [`GET /v1/participants/${SUBJECT}`]: () => ok({ id: SUBJECT, external_ref: 'DE-B', display_name: 'Bea Example' }),
    ...extra,
  })
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
})

describe('SC-06 queue subjects', () => {
  it('BUG-108: names a write-off’s payee from its preview, a dispute’s position, and links a privacy request to SC-15', async () => {
    const row = (overrides: Partial<CaseRecord>): CaseRecord => ({ ...caseOf({}), evidence: undefined, events: undefined, eligible_approvers: undefined, ...overrides } as CaseRecord)
    const writeOff = row({
      id: 'c-w', type: 'write_off', subject_type: 'ledger_account', subject_id: 'acct-1', reason_code: 'UNRECOVERABLE',
      effect_preview: { payee: { id: 'p-a', external_ref: 'DE-A', display_name: 'Ann Example' } },
    })
    const LOWER_REQUEST = 'abcdef12-0000-4000-8000-0000000000f1'
    const privacy = row({ id: 'c-p', type: 'privacy', subject_type: 'privacy_request', subject_id: LOWER_REQUEST, reason_code: 'PUBLIC_FORM', effect_preview: null })
    const fetchMock = fetchByRoute({
      'GET /v1/cases/counts': () => ok([]),
      'GET /v1/cases': () => json(200, { data: [writeOff, row({ id: 'c-d' }), privacy], meta: { next_cursor: null } }),
    })
    renderAs(adminMe({ permissions: ['case.write_off.read', 'case.dispute.read', 'privacy.manage'] }), <CasesPage />, fetchMock)
    expect(await screen.findByText('DE-A · Ann Example')).toBeTruthy()
    expect(screen.getByText('Clawback receivable')).toBeTruthy()
    expect(screen.getByText('P-A')).toBeTruthy()
    expect(screen.getByText('Disputed line')).toBeTruthy()
    // BUG-117: the dispute's opener is the distributor's portal account, named as such.
    expect(screen.getByText('By the distributor')).toBeTruthy()
    // The same reference as SC-15 and the requester's answer: first 8 characters, upper case.
    expect(screen.getByRole('link', { name: 'Privacy request ABCDEF12' }).getAttribute('href')).toBe(`/privacy/${LOWER_REQUEST}`)
    // No per-row GET of a ledger account, a result line or a request: the preview names them.
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('?')[0]).sort()).toEqual(['/v1/cases', '/v1/cases/counts'])
    expect(screen.getByRole('tab', { name: /Disputes/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Privacy requests/ })).toBeTruthy()
  })
})

describe('SC-06 disputes (D-B5-15)', () => {
  it('shows the line facts and a trace link, never the raw trace, and starts the review by self-assignment', async () => {
    const fetchMock = routes(caseOf({}), { [`POST /v1/cases/${CASE_ID}/assign`]: () => ok(caseOf({ assigned_to: ANALYST.user.id })) })
    renderAs(ANALYST, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    expect(await screen.findByText('Volume missing')).toBeTruthy()
    const preview = screen.getByRole('heading', { name: 'Effect preview' }).closest('section')!
    expect(await within(preview).findByText('23.00 EUR')).toBeTruthy()
    expect(within(preview).getByText('unilevel')).toBeTruthy()
    expect(within(preview).getByRole('link', { name: 'Open the calculation trace of this line' }).getAttribute('href'))
      .toBe(`/periods/${PERIOD}/runs/${RUN}/review?tab=lines&line=${LINE}`)
    expect(document.body.textContent).not.toContain('rankEvaluated')
    // BUG-117: the distributor is named as such, and the subject is the line of a position in a period, not its id.
    expect(screen.getByText(/opened .* by the distributor/)).toBeTruthy()
    expect(screen.getAllByText('The distributor').length).toBeGreaterThan(0)
    const subject = screen.getByText('Subject (commission line)').nextElementSibling!
    expect(subject.textContent).toMatch(/^Line of .* in /)
    expect(document.body.textContent).not.toContain('another user')
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(await screen.findByText('Review started. The distributor sees the dispute as under review.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/cases/${CASE_ID}/assign`)[0]![1])).toEqual({ user_id: ANALYST.user.id })
  })

  it('upholds with the explanation sent to the distributor, and shows when the response date passed', async () => {
    const fetchMock = routes(caseOf({ assigned_to: ANALYST.user.id, due_at: '2026-01-01T00:00:00.000Z' }), {
      [`POST /v1/cases/${CASE_ID}/decision`]: () => ok(caseOf({ state: 'approved' })),
    })
    renderAs(ANALYST, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    expect(await screen.findByText(/The response date .* has passed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Uphold' }))
    const dialog = await screen.findByRole('dialog', { name: 'Uphold this dispute' })
    expect(within(dialog).getByText(/It changes no amount by itself/)).toBeTruthy()
    expect(within(dialog).queryByText(/applies the change/)).toBeNull()
    await userEvent.type(within(dialog).getByLabelText('Explanation sent to the distributor'), 'The order was credited late.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Uphold' }))
    expect(await screen.findByText('Dispute upheld. The distributor is told with your explanation.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/cases/${CASE_ID}/decision`)[0]![1])).toEqual({ decision: 'approve', reason: 'The order was credited late.' })
  })

  it('after upheld offers "Propose adjustment" prefilled with the position and DISPUTE_UPHELD, and "Request restatement"', async () => {
    const calendar = { id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: 'm1', code: 'DE' }, plan: null }
    const open = { id: 'per-open', calendar_id: 'cal1', state: 'open', starts_at: '2026-10-31T23:00:00.000Z', ends_at: '2026-11-30T23:00:00.000Z' }
    const later = { id: 'per-later', calendar_id: 'cal1', state: 'open', starts_at: '2027-01-31T23:00:00.000Z', ends_at: '2027-02-28T23:00:00.000Z' }
    // BUG-118: the list is newest first; the period running today is preselected, not the latest open one.
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-19T12:00:00.000Z'))
    renderAs(ANALYST, <CaseDetailPage caseId={CASE_ID} />, routes(caseOf({ state: 'approved', decided_at: CREATED }), {
      'GET /v1/periods': () => json(200, { data: { calendars: [calendar], periods: [later, open] }, meta: { next_cursor: null } }),
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
    }))
    expect(await screen.findByRole('button', { name: 'Request restatement' })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: 'Propose adjustment' }))
    const dialog = await screen.findByRole('dialog', { name: 'Propose adjustment' })
    expect(within(dialog).getByText(/P-A/)).toBeTruthy()
    const reason = within(dialog).getByLabelText('Reason') as HTMLSelectElement
    expect(reason.value).toBe('DISPUTE_UPHELD')
    // No other reason to pick: the API refuses a settlement whose reason is not DISPUTE_UPHELD.
    expect([...reason.options].filter((option) => option.value !== '').map((option) => option.value)).toEqual(['DISPUTE_UPHELD'])
    expect(((await within(dialog).findByLabelText('Period')) as HTMLSelectElement).value).toBe('per-open')
    now.mockRestore()
  })

  it('BUG-118: preselects the period running now, else the next one, else the latest', () => {
    const period = (id: string, starts: string, ends: string) => ({ id, starts_at: starts, ends_at: ends })
    const oct = period('oct', '2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z')
    const nov = period('nov', '2026-10-31T23:00:00Z', '2026-11-30T23:00:00Z')
    const feb = period('feb', '2027-01-31T23:00:00Z', '2027-02-28T23:00:00Z')
    expect(currentPeriodId([feb, nov, oct], Date.parse('2026-11-19T12:00:00Z'))).toBe('nov')
    expect(currentPeriodId([feb, oct], Date.parse('2026-11-19T12:00:00Z'))).toBe('feb')
    expect(currentPeriodId([oct], Date.parse('2026-11-19T12:00:00Z'))).toBe('oct')
    expect(currentPeriodId([], 0)).toBe('')
  })
})

describe('SC-06 privacy cases (D-B5-16..18)', () => {
  const privacy = (overrides: Partial<CaseDetail>) => caseOf({
    type: 'privacy', subject_type: 'privacy_request', subject_id: REQUEST, reason_code: 'PUBLIC_FORM', payload: { request_id: REQUEST },
    opened_by: null, opened_by_kind: 'system', submitted_by: null, submitted_at: null, state: 'open', effect_preview: null, eligible_approvers: null, due_at: null, ...overrides,
  })

  it('submits with the retention basis (PATCH the payload, then submit)', async () => {
    const fetchMock = routes(privacy({}), {
      [`GET /v1/privacy-requests/${REQUEST}`]: () => ok({ id: REQUEST, type: 'erasure' }),
      [`PATCH /v1/cases/${CASE_ID}`]: () => ok(privacy({})),
      [`POST /v1/cases/${CASE_ID}/submit`]: () => ok(privacy({ state: 'submitted' })),
    })
    renderAs(DPO, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    expect((await screen.findByRole('link', { name: 'Open the privacy request' })).getAttribute('href')).toBe(`/privacy/${REQUEST}`)
    await userEvent.click(screen.getByRole('button', { name: 'Submit for decision' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit the privacy request' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit for decision' }))
    expect(await within(dialog).findAllByText('Enter the retention basis.')).toBeTruthy()
    await userEvent.type(within(dialog).getByLabelText('Retention basis'), 'Ledger kept 10 years (tax law)')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit for decision' }))
    expect(await screen.findByText('Case submitted. Another DPO decides it.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PATCH', `/v1/cases/${CASE_ID}`)[0]![1])).toEqual({ payload: { request_id: REQUEST, retention_basis: 'Ledger kept 10 years (tax law)' } })
    expect(callsTo(fetchMock, 'POST', `/v1/cases/${CASE_ID}/submit`)).toHaveLength(1)
  })

  it('keeps a failed read of the request inside the submit dialog: Try again reads it, Close leaves, and Submit opens it again', async () => {
    let reads = 0
    const fetchMock = routes(privacy({}), {
      [`GET /v1/privacy-requests/${REQUEST}`]: () => (++reads === 1 ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again later.') : ok({ id: REQUEST, type: 'correction' })),
    })
    renderAs(DPO, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for decision' }))
    let dialog = await screen.findByRole('dialog', { name: 'Submit the privacy request' })
    expect(await within(dialog).findByText('This section could not be loaded')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Submit for decision' }))
    dialog = await screen.findByRole('dialog', { name: 'Submit the privacy request' })
    expect(await within(dialog).findByRole('button', { name: 'Submit for decision' })).toBeTruthy()
    expect(within(dialog).queryByLabelText('Retention basis')).toBeNull() // a correction needs no basis
  })

  it('shows cleared vs retained, and words ERASURE_DEFERRED when the approval must wait', async () => {
    const submitted = privacy({
      state: 'submitted', submitted_by: DPO.user.id, submitted_at: CREATED, payload: { request_id: REQUEST, retention_basis: 'Tax law' },
      effect_preview: { request_id: REQUEST, type: 'erasure', subject: { id: SUBJECT, external_ref: 'DE-B' }, cleared: ['participant.contact'], retained: ['journal_entry'], blockers: [] },
      eligible_approvers: [{ user_id: DPO2.user.id, display_name: 'Dan DPO', email: 'dan@acme.example' }],
    })
    renderAs(DPO2, <CaseDetailPage caseId={CASE_ID} />, routes(submitted, {
      [`POST /v1/cases/${CASE_ID}/decision`]: () => apiError(409, 'ERASURE_DEFERRED', 'The erasure must wait.', { reasons: [{ reason: 'open_payable', market_id: 'm1', amount_minor: '500' }, { reason: 'payout_hold', hold_id: 'h1' }] }),
    }))
    const erasure = await screen.findByTestId('erasure-preview')
    expect(within(erasure).getByText('Member contact details')).toBeTruthy()
    expect(within(erasure).getByText('Journal entries')).toBeTruthy()
    expect(screen.getByText('Nothing defers the erasure now.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Verified and complete')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await within(dialog).findByText(/^Erasure deferred: 5\.00.* is still owed to the member in DE\. A payout hold \(legal hold\) is in place on the member\. Nothing was erased/)).toBeTruthy()
  })
})
