// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { CaseDetailPage } from './case-detail'
import { CasesPage } from './cases-page'
import { receivedError, type GrievanceRow } from './grievance'
import { RegistersPage } from './registers-page'
import type { CaseDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: '00000000-0000-4000-8000-0000000000a7', code: 'AT', name: 'Austria', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture-tax', time_zone: 'Europe/Vienna', languages: ['de'], minor_unit: 2 }
const SUPPORT = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000b1', email: 'sam@acme.example', display_name: 'Sam Support' },
  permissions: ['case.grievance.read', 'case.grievance.create'], roles: [{ role_id: 'r1', name: 'Support agent', market_ids: null, assignment_id: 'a1' }],
})
const COMPLIANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000c9', email: 'cora@acme.example', display_name: 'Cora Compliance' },
  permissions: ['case.grievance.read', 'case.grievance.approve', 'register.read'], roles: [{ role_id: 'r2', name: 'Compliance officer', market_ids: null, assignment_id: 'a2' }],
})
const CASE_ID = '00000000-0000-4000-8000-00000000ca5e'
const PARTICIPANT = '00000000-0000-4000-8000-0000000000d1'
const RECEIVED = '2026-11-17T09:00:00.000Z'

const ROW: GrievanceRow = {
  case_id: CASE_ID, market_id: MARKET.id, subject: { type: 'participant', id: PARTICIPANT, external_ref: 'AT-A' }, category: 'payout', channel: 'email',
  external_ref: 'T-1001', received_at: RECEIVED, ack_due_at: '2026-11-19T09:00:00.000Z', acknowledged_at: null, resolution_due_at: '2026-12-17T09:00:00.000Z',
  resolved_at: null, outcome: null, state: 'open', ack_overdue: true, resolution_overdue: false, escalated: ['ack'], rule_id: 'e2e-grievance@2020-01-01',
}

function grievance(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: CASE_ID, type: 'grievance', subject_type: 'participant', subject_id: PARTICIPANT, reason_code: 'payout', state: 'submitted',
    payload: { received_at: RECEIVED, channel: 'email', external_ref: 'T-1001' }, effect_preview: null, due_at: '2026-12-17T09:00:00.000Z',
    market_id: MARKET.id, opened_by: SUPPORT.user.id, opened_by_kind: 'user', assigned_to: null, submitted_by: SUPPORT.user.id, submitted_at: RECEIVED,
    decided_at: null, approval_id: null, created_at: RECEIVED, evidence: [], events: [{ id: 'e1', occurred_at: RECEIVED, actor_id: SUPPORT.user.id, kind: 'opened', data: null }],
    eligible_approvers: [{ user_id: COMPLIANCE.user.id, display_name: 'Cora Compliance', email: 'cora@acme.example' }],
    ...overrides,
  }
}

const base = {
  'GET /v1/markets': () => ok([MARKET]),
  [`GET /v1/participants/${PARTICIPANT}`]: () => ok({ id: PARTICIPANT, external_ref: 'AT-A', display_name: null }),
  'GET /v1/registers/grievances': () => json(200, { data: [ROW], meta: { next_cursor: null } }),
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
  navigation.router.replace.mockReset()
})

describe('Grievances on SC-06', () => {
  it('refuses a received date in the future or older than 366 days', () => {
    const now = Date.parse('2026-11-20T12:00:00.000Z')
    expect(receivedError('', now)).toBe('Enter the date and time the grievance was received.')
    expect(receivedError('2026-12-01T10:00', now)).toBe('The received date cannot be in the future.')
    expect(receivedError('2025-01-01T10:00', now)).toBe('The received date must be within the last 366 days.')
    expect(receivedError('2026-11-17T10:00', now)).toBeNull()
  })

  it('records a grievance not on record: market, category, channel, received date and reference, no evidence', async () => {
    navigation.search = 'type=grievance'
    const fetchMock = fetchByRoute({
      ...base,
      'GET /v1/cases/counts': () => ok([{ type: 'grievance', open: 1, submitted: 0, overdue: 0, decided_30d: 0 }]),
      'GET /v1/cases': () => json(200, { data: [], meta: { next_cursor: null } }),
      'POST /v1/cases': () => ok({ id: CASE_ID }, 201),
    })
    renderAs(SUPPORT, <CasesPage />, fetchMock)
    expect(await screen.findByRole('tab', { name: /Grievances/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Registers' }).getAttribute('href')).toBe('/cases/registers')
    await userEvent.click(screen.getByRole('button', { name: 'Record grievance' }))
    const dialog = await screen.findByRole('dialog')
    // A statement typed for a participant is neither shown nor sent once the complainant is not on record (D-BM-08/13).
    // BUG-139: the statement summarises the complaint (not the correction case's "Why the change is needed").
    expect(within(dialog).getByText('A short summary of the complaint in your words; kept with the case.')).toBeTruthy()
    expect(within(dialog).queryByText(/Why the change is needed/)).toBeNull()
    await userEvent.type(within(dialog).getByLabelText(/^Statement/), 'Letter from Jane Doe')
    await userEvent.click(within(dialog).getByLabelText(/Not on record/))
    expect(within(dialog).queryByLabelText(/^Evidence/)).toBeNull()
    expect(within(dialog).queryByLabelText(/^Statement/)).toBeNull()
    await userEvent.selectOptions(await within(dialog).findByLabelText('Market'), MARKET.id)
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'payout')
    await userEvent.selectOptions(within(dialog).getByLabelText('Channel'), 'email')
    const received = new Date(Date.now() - 3 * 86_400_000)
    const local = new Date(received.getTime() - received.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    await userEvent.type(within(dialog).getByLabelText('Received at'), local)
    await userEvent.type(within(dialog).getByLabelText(/Your reference/), 'T-1001')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record grievance' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(1))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/cases')[0]!
    const body = bodyOf(init) as { payload: { received_at: string } }
    expect(body).toMatchObject({ type: 'grievance', subject_type: 'market', subject_id: MARKET.id, reason_code: 'payout', payload: { channel: 'email', external_ref: 'T-1001' } })
    expect(Date.parse(body.payload.received_at)).toBe(Date.parse(new Date(local).toISOString()))
    expect(body).not.toHaveProperty('note')
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
    expect(callsTo(fetchMock, 'POST', '/v1/documents')).toHaveLength(0)
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith(`/cases/${CASE_ID}`))
  })

  it('says why the register refuses, in the API’s words (a draft market is not a missing pack rule)', async () => {
    const fetchMock = fetchByRoute({
      ...base,
      'GET /v1/cases/counts': () => ok([]),
      'GET /v1/cases': () => json(200, { data: [], meta: { next_cursor: null } }),
      'POST /v1/cases': () => apiError(422, 'REGISTER_NOT_ENABLED', 'A draft market keeps no grievance register: its pack can still change.'),
    })
    renderAs(SUPPORT, <CasesPage />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Record grievance' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText(/Not on record/))
    await userEvent.selectOptions(await within(dialog).findByLabelText('Market'), MARKET.id)
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'other')
    await userEvent.selectOptions(within(dialog).getByLabelText('Channel'), 'letter')
    const local = new Date(Date.now() - 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    await userEvent.type(within(dialog).getByLabelText('Received at'), local)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record grievance' }))
    expect(await within(dialog).findByText('A draft market keeps no grievance register: its pack can still change.')).toBeTruthy()
  })

  it('shows the deadlines from the register and the resolve decisions, never a money effect', async () => {
    const fetchMock = fetchByRoute({ ...base, [`GET /v1/cases/${CASE_ID}`]: () => ok(grievance()) })
    renderAs(COMPLIANCE, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    const deadlines = await screen.findByTestId('deadlines')
    expect(await within(deadlines).findByText('Acknowledge by')).toBeTruthy()
    expect(within(deadlines).getByText('Overdue')).toBeTruthy()
    expect(within(deadlines).getByText('Acknowledgement deadline near')).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/registers/grievances')[0]![0], 'http://x').searchParams.get('case_id')).toBe(CASE_ID)
    expect(screen.queryByText('Effect preview')).toBeNull()
    expect(screen.getByText('T-1001')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resolve: upheld' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resolve: not upheld' })).toBeTruthy()
  })

  it('names a grievance resolved as upheld in grievance words: state, section and history (BUG-139)', async () => {
    const resolved = grievance({
      state: 'approved', decided_at: RECEIVED,
      events: [
        { id: 'e1', occurred_at: RECEIVED, actor_id: SUPPORT.user.id, kind: 'opened', data: null },
        { id: 'e2', occurred_at: RECEIVED, actor_id: SUPPORT.user.id, kind: 'submitted', data: null },
        { id: 'e3', occurred_at: RECEIVED, actor_id: COMPLIANCE.user.id, kind: 'approved', data: null },
      ],
    })
    renderAs(COMPLIANCE, <CaseDetailPage caseId={CASE_ID} />, fetchByRoute({ ...base, [`GET /v1/cases/${CASE_ID}`]: () => ok(resolved) }))
    expect(await screen.findByRole('heading', { name: 'Complainant and complaint' })).toBeTruthy()
    expect(screen.queryByText('Subject and proposal')).toBeNull()
    expect(screen.getAllByText('Resolved: upheld').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Acknowledged')).toBeTruthy()
    expect(screen.queryByText('Approved')).toBeNull()
  })

  it('offers Acknowledge to the recorder of an open grievance, and no evidence upload when not on record', async () => {
    const open = grievance({ state: 'open', subject_type: 'market', subject_id: MARKET.id, submitted_by: null, submitted_at: null, due_at: null })
    renderAs(SUPPORT, <CaseDetailPage caseId={CASE_ID} />, fetchByRoute({ ...base, [`GET /v1/cases/${CASE_ID}`]: () => ok(open) }))
    expect(await screen.findByRole('button', { name: 'Acknowledge' })).toBeTruthy()
    expect((await screen.findAllByText('Austria (AT)')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Add evidence/ })).toBeNull()
  })
})

describe('/cases/registers', () => {
  it('lists grievances with state and overdue filters and exports the register', async () => {
    navigation.search = 'tab=grievances&overdue=ack'
    const fetchMock = fetchByRoute(base)
    renderAs(COMPLIANCE, <RegistersPage />, fetchMock)
    expect(await screen.findByRole('link', { name: 'AT-A' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove filter: Acknowledgement overdue' })).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/registers/grievances')[0]![0], 'http://x').searchParams.get('overdue')).toBe('ack')
    expect(screen.getByRole('button', { name: 'Export register' })).toBeTruthy()
  })

  it('shows only the pack rule’s fields of delisted sellers, and the not-enabled state', async () => {
    navigation.search = 'tab=delisted'
    const delisted = { rule: { id: 'e2e-delisted@2020-01-01', fields: ['external_ref', 'terminated_on'], window_days: null, basis_status: 'counsel_confirmed' }, rows: [{ participant_id: 'p1', external_ref: 'AT-C', terminated_on: '2026-11-20' }] }
    const view = renderAs(COMPLIANCE, <RegistersPage />, fetchByRoute({ ...base, 'GET /v1/registers/delisted': () => json(200, { data: delisted, meta: { next_cursor: null } }) }))
    expect(await screen.findByText('AT-C')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Terminated on' })).toBeTruthy()
    // BUG-137: a calendar date in words, and no rule id in the note.
    expect(screen.getByText(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 20)))).toBeTruthy()
    expect(screen.queryByText('2026-11-20')).toBeNull()
    expect(screen.queryByText(/e2e-delisted@/)).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Name' })).toBeNull()
    expect(screen.getByText('Counsel confirmed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
    view.unmount()
    renderAs(COMPLIANCE, <RegistersPage />, fetchByRoute({ ...base, 'GET /v1/registers/delisted': () => apiError(422, 'REGISTER_NOT_ENABLED') }))
    expect(await screen.findByText("Not enabled for this market's pack")).toBeTruthy()
  })

  it('is not available without a register permission', async () => {
    renderAs(adminMe({ permissions: ['case.adjustment.read'] }), <RegistersPage />, fetchByRoute(base))
    expect(await screen.findByText(/not available/i)).toBeTruthy()
  })
})
