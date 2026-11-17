// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { moneyText } from '../orders/format'
import { CaseDetailPage } from './case-detail'
import { CasesPage } from './cases-page'
import { periodName } from '../periods/format'
import { RestatementDialog } from './restatement-dialog'
import type { CaseDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const MARKET = { id: 'm1', code: 'DE', name: 'Germany', currency: 'EUR', state: 'live', market_pack: 'e2e-fixture', time_zone: 'Europe/Berlin', languages: ['de'], minor_unit: 2 }
const PERIOD = { id: '00000000-0000-4000-8000-0000000000e3', calendar_id: 'cal1', market_id: 'm1', starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z', state: 'committed' }
const COMPLIANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000c1', email: 'cora@acme.example', display_name: 'Cora Compliance' },
  permissions: ['case.restatement.read', 'restatement.request', 'period.read', 'run.review'],
})
const FINANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000f1', email: 'fay@acme.example', display_name: 'Fay Finance' },
  permissions: ['case.restatement.read', 'restatement.approve', 'period.read', 'run.review'],
})
const FAY = { user_id: FINANCE.user.id, display_name: 'Fay Finance', email: 'fay@acme.example' }
const CREATED = '2026-11-17T09:00:00.000Z'
const CASE_ID = '00000000-0000-4000-8000-00000000ca5e'

function restatement(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: CASE_ID, type: 'restatement', subject_type: 'period', subject_id: PERIOD.id, reason_code: 'GENEALOGY_CORRECTION', state: 'submitted',
    payload: { note: 'C moved under A from enrolment' },
    effect_preview: { restatement_id: 'rs1', period: PERIOD, diff_total_minor: '-500', by_rule: [{ rule_key: 'unilevel', diff_minor: '-500' }], payees: 2, empty: false },
    due_at: null, market_id: 'm1', opened_by: COMPLIANCE.user.id, opened_by_kind: 'user', assigned_to: null, submitted_by: COMPLIANCE.user.id,
    submitted_at: CREATED, decided_at: null, approval_id: null, created_at: CREATED, evidence: [],
    events: [{ id: 'ev1', occurred_at: CREATED, actor_id: COMPLIANCE.user.id, kind: 'opened', data: null }], eligible_approvers: [FAY],
    ...overrides,
  }
}

const detailRoutes = (overrides: Partial<CaseDetail> = {}, applied: string | null = null) => ({
  [`GET /v1/cases/${CASE_ID}`]: () => ok(restatement(overrides)),
  'GET /v1/markets': () => ok([MARKET]),
  [`GET /v1/periods/${PERIOD.id}`]: () => ok(PERIOD),
  'GET /v1/restatements/rs1': () => ok({ id: 'rs1', case_id: CASE_ID, state: applied === null ? 'calculated' : 'applied', applied_in_run_id: applied }),
  'GET /v1/restatements/rs1/lines': () => ok([
    { payee_position_id: 'pos-b', payee_participant_id: 'par-b', rule_key: 'unilevel', committed_minor: '2400', applied_adjustments_minor: '-1600', restated_minor: '0', diff_minor: '-800' },
    { payee_position_id: 'pos-a', payee_participant_id: 'par-a', rule_key: 'unilevel', committed_minor: '2300', applied_adjustments_minor: '-1000', restated_minor: '1600', diff_minor: '300' },
  ]),
  'GET /v1/participants/par-a': () => ok({ id: 'par-a', external_ref: 'DE-A', display_name: null }),
  'GET /v1/participants/par-b': () => ok({ id: 'par-b', external_ref: 'DE-B', display_name: null }),
  'GET /v1/positions/pos-a': () => ok({ id: 'pos-a', position_ref: 'P-A', owner: null }),
  'GET /v1/positions/pos-b': () => ok({ id: 'pos-b', position_ref: 'P-B', owner: null }),
})

beforeEach(() => {
  navigation.search = ''
  navigation.router.push.mockReset()
})

describe('Restatement cases (SC-06)', () => {
  it('has a Restatements tab for restatement readers, naming the period subject', async () => {
    navigation.search = 'type=restatement'
    const fetchMock = fetchByRoute({
      'GET /v1/cases/counts': () => ok([{ type: 'restatement', open: 0, submitted: 1, overdue: 0, decided_30d: 0 }]),
      'GET /v1/cases': () => ok([restatement()]),
      [`GET /v1/periods/${PERIOD.id}`]: () => ok(PERIOD),
      'GET /v1/periods': () => json(200, { data: { calendars: [{ id: 'cal1', name: 'DE monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Berlin', market: { id: 'm1', code: 'DE' }, plan: null }], periods: [] }, meta: { next_cursor: null } }),
    })
    renderAs(COMPLIANCE, <CasesPage />, fetchMock)
    expect(screen.getByRole('tab', { name: /Restatements/ }).getAttribute('aria-selected')).toBe('true')
    // BUG-091: the subject period is named in its calendar's cut-off zone, not as viewer-zone instants.
    expect(await screen.findByText(periodName(PERIOD.starts_at, PERIOD.ends_at, 'Europe/Berlin'))).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/periods')[0]![0], 'http://x').searchParams.get('calendar_id')).toBe('cal1')
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/cases')[0]![0], 'http://x').searchParams.get('type')).toBe('restatement')
  })

  it('opens a restatement case with reason, note in the payload and evidence, then goes to the case', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'POST /v1/cases': () => ok({ id: CASE_ID }, 201),
      'POST /v1/documents': () => ok({ id: 'doc1', file_name: 'correction.pdf', mime: 'application/pdf', size_bytes: 4, sha256: 'ab' }, 201),
      [`POST /v1/cases/${CASE_ID}/evidence`]: () => ok({}, 201),
    })
    renderAs(COMPLIANCE, <RestatementDialog period={{ id: PERIOD.id, label: 'Aug 2026' }} onClose={() => undefined} />, fetchMock)
    const dialog = await screen.findByRole('dialog', { name: 'Request restatement' })
    expect(dialog.textContent).toContain('Aug 2026')
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'GENEALOGY_CORRECTION')
    await userEvent.upload(await within(dialog).findByLabelText('Evidence'), new File(['%PDF'], 'correction.pdf', { type: 'application/pdf' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open restatement case' }))
    expect((await within(dialog).findAllByText('Enter the note.')).length).toBeGreaterThan(0)
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(0)
    expect(within(dialog).queryByLabelText(/Statement/)).toBeNull()
    await userEvent.type(within(dialog).getByLabelText('Note'), 'C moved under A from enrolment')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open restatement case' }))
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith(`/cases/${CASE_ID}`))
    const [, create] = callsTo(fetchMock, 'POST', '/v1/cases')[0]!
    expect(bodyOf(create)).toEqual({
      type: 'restatement', subject_type: 'period', subject_id: PERIOD.id, reason_code: 'GENEALOGY_CORRECTION', payload: { note: 'C moved under A from enrolment' },
    })
    expect(headerOf(create, 'idempotency-key')).not.toBeNull()
    expect(bodyOf(callsTo(fetchMock, 'POST', `/v1/cases/${CASE_ID}/evidence`)[0]![1])).toEqual({ document_id: 'doc1' })
  })

  it('shows the diff total, by bonus and per payee net of adjustments, and the opener cannot decide', async () => {
    renderAs(COMPLIANCE, <CaseDetailPage caseId={CASE_ID} />, fetchByRoute(detailRoutes()))
    expect(await screen.findByRole('heading', { level: 1, name: /Restatement/ })).toBeTruthy()
    await vi.waitFor(() => expect(screen.getByTestId('diff-total').textContent).toBe(`-${moneyText('500', 'EUR', 2)}`))
    const table = await screen.findByRole('table', { name: 'Restated payees' })
    expect(await within(table).findByText('DE-B')).toBeTruthy()
    expect(table.textContent).toContain(`-${moneyText('1600', 'EUR', 2)}`) // the clawback already paid
    expect(table.textContent).toContain(`+${moneyText('300', 'EUR', 2)}`)
    expect(screen.getByText('C moved under A from enrolment')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getAllByText(/Can decide: Fay Finance/).length).toBeGreaterThan(0)
  })

  it('lets finance approve and renders a separation-of-duties refusal with the eligible approvers', async () => {
    const fetchMock = fetchByRoute({
      ...detailRoutes(),
      [`POST /v1/cases/${CASE_ID}/decision`]: () => apiError(422, 'SOD_SELF_APPROVAL', 'You contributed to this case.', { eligible_approvers: [{ user_id: 'u9', display_name: 'Gil Gold', email: 'gil@acme.example' }] }),
    })
    renderAs(FINANCE, <CaseDetailPage caseId={CASE_ID} />, fetchMock)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: 'Approve this restatement' })
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Correction verified')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await within(dialog).findByText(/Who can decide it: Gil Gold/)).toBeTruthy()
  })

  it('links the run that applied the restatement to its review', async () => {
    renderAs(COMPLIANCE, <CaseDetailPage caseId={CASE_ID} />, fetchByRoute({
      ...detailRoutes({ state: 'approved' }, 'run-m1'),
      'GET /v1/runs/run-m1': () => ok({ id: 'run-m1', period_id: 'per-m1', state: 'committed' }),
    }))
    const link = await screen.findByRole('link', { name: 'run run-m1' })
    expect(link.getAttribute('href')).toBe('/periods/per-m1/runs/run-m1/review')
  })
})
