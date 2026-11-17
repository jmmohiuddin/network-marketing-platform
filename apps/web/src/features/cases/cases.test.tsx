// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { CaseDetailPage } from './case-detail'
import { CasesPage } from './cases-page'
import { contributorsOf, inSentence, personName, utcToday } from './format'
import type { CaseDetail, CaseRecord } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const SUPPORT = adminMe({
  user: { id: '00000000-0000-4000-8000-00000000005a', email: 'sam@acme.example', display_name: 'Sam Support' },
  permissions: ['case.genealogy.read', 'case.genealogy.create', 'case.duplicate.read', 'case.duplicate.create', 'genealogy.read', 'participant.read'],
})
const OFFICER = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000c1', email: 'cora@acme.example', display_name: 'Cora Compliance' },
  permissions: ['case.genealogy.read', 'case.genealogy.approve', 'case.duplicate.read', 'case.duplicate.approve', 'genealogy.read', 'participant.read'],
})
const CORA = { user_id: OFFICER.user.id, display_name: 'Cora Compliance', email: 'cora@acme.example' }
const CREATED = '2026-11-17T09:00:00.000Z'
const POSITION = '00000000-0000-4000-8000-0000000000b1'
const PARENT = '00000000-0000-4000-8000-0000000000a1'

function record(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    id: '00000000-0000-4000-8000-00000000ca5e', type: 'genealogy_change', subject_type: 'position', subject_id: POSITION,
    reason_code: 'PARTICIPANT_REQUEST', state: 'open', payload: { kind: 'sponsor', proposed_parent_position_id: PARENT, effective_from: '2026-11-17' },
    effect_preview: null, due_at: null, market_id: 'm1', opened_by: SUPPORT.user.id, opened_by_kind: 'user', assigned_to: null,
    submitted_by: null, submitted_at: null, decided_at: null, approval_id: null, created_at: CREATED,
    evidence: [], events: [{ id: 'ev1', occurred_at: CREATED, actor_id: SUPPORT.user.id, kind: 'opened', data: null }], eligible_approvers: null,
    ...overrides,
  }
}

const position = (id: string, ref: string) => ok({
  id, position_ref: ref, market: { id: 'm1', code: 'NL' }, status: 'active',
  owner: { participant_id: `p-${ref}`, external_ref: `D-${ref}`, display_name: `Owner ${ref}` }, parents: { sponsor: null, placement: null },
})

const refs = {
  [`GET /v1/positions/${POSITION}`]: () => position(POSITION, 'P-C'),
  [`GET /v1/positions/${PARENT}`]: () => position(PARENT, 'P-A'),
}

describe('case format', () => {
  it('counts opener, submitter, evidence adders and editors as contributors', () => {
    const c = record({
      submitted_by: 'u2', evidence: [{ id: 'e', document_id: 'd', file_name: 'a.pdf', mime: 'application/pdf', size_bytes: 1, note: null, added_by: 'u3', added_at: CREATED }],
      events: [{ id: 'x', occurred_at: CREATED, actor_id: 'u4', kind: 'updated', data: { fields: ['payload'] } }, { id: 'y', occurred_at: CREATED, actor_id: null, kind: 'updated', data: null }],
    })
    expect([...contributorsOf(c)].sort()).toEqual([SUPPORT.user.id, 'u2', 'u3', 'u4'].sort())
  })

  it('names people as far as the user can tell, and fits them in sentences', () => {
    expect(personName(null, 'me')).toBe('The system')
    expect(personName('me', 'me')).toBe('You')
    expect(personName(CORA.user_id, 'me', [CORA])).toBe('Cora Compliance')
    expect(personName('other', 'me', [CORA])).toBe('Another user')
    expect(inSentence('You')).toBe('you')
    expect(inSentence('Cora Compliance')).toBe('Cora Compliance')
    expect(utcToday(new Date('2026-11-17T23:30:00-05:00'))).toBe('2026-11-18')
  })
})

describe('CasesPage (SC-06)', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.router.replace.mockReset()
  })

  it('shows KPI sums, one tab per readable type with counts, and the queue', async () => {
    const reader = adminMe({ permissions: ['case.genealogy.read'] })
    const fetchMock = fetchByRoute({
      'GET /v1/cases/counts': () => ok([
        { type: 'genealogy_change', open: 2, submitted: 1, overdue: 1, decided_30d: 4 },
        { type: 'genealogy_correction', open: 1, submitted: 0, overdue: 0, decided_30d: 0 },
        { type: 'transfer', open: 0, submitted: 2, overdue: 0, decided_30d: 1 },
      ]),
      'GET /v1/cases': () => ok([record()]),
    })
    renderAs(reader, <CasesPage />, fetchMock)
    expect((await screen.findByRole('link', { name: 'Genealogy change' })).getAttribute('href')).toBe(`/cases/${record().id}`)
    const kpis = screen.getByTestId('kpis')
    expect(kpis.textContent).toContain('Open3') // 2 + 1 + 0
    expect(kpis.textContent).toContain('Waiting for decision3') // 1 + 0 + 2
    expect(kpis.textContent).toContain('Decided in 30 days5') // 4 + 0 + 1
    expect((screen.getByRole('tab', { name: 'All cases 6' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Genealogy changes 3' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /Duplicates/ })).toBeNull()
    expect(screen.queryByTestId('primary-action')).toBeNull()
  })

  it('filters by the URL, shows the subject as a removable chip and sends the filters to the API', async () => {
    navigation.search = `type=genealogy_change&state=submitted&subject_type=position&subject_id=${POSITION}`
    const fetchMock = fetchByRoute({ 'GET /v1/cases/counts': () => ok([]), 'GET /v1/cases': () => ok([]), ...refs })
    renderAs(SUPPORT, <CasesPage />, fetchMock)
    expect(await screen.findByText('No cases match these filters')).toBeTruthy()
    const [url] = callsTo(fetchMock, 'GET', '/v1/cases')[0]!
    expect(new URL(url, 'http://x').searchParams.toString()).toBe(`type=genealogy_change&state=submitted&subject_type=position&subject_id=${POSITION}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove filter: Subject: P-C' }))
    expect(navigation.router.replace).toHaveBeenCalledWith('/cases?type=genealogy_change&state=submitted')
    expect((screen.getByTestId('primary-action')).getAttribute('href')).toBe('/cases/genealogy/new')
  })

  it('is not available without a case read permission', () => {
    renderAs(adminMe({ permissions: ['order.read'] }), <CasesPage />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})

describe('CaseDetailPage (SC-06)', () => {
  it('lets the preparer attach evidence and submit, and shows a refusal from submit', async () => {
    const id = record().id
    let attached = false
    const fetchMock = fetchByRoute({
      [`GET /v1/cases/${id}`]: () => ok(record(attached ? { evidence: [{ id: 'e1', document_id: 'doc1', file_name: 'consent.pdf', mime: 'application/pdf', size_bytes: 2048, note: null, added_by: SUPPORT.user.id, added_at: CREATED }] } : {})),
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'POST /v1/documents': () => ok({ id: 'doc1', file_name: 'consent.pdf', mime: 'application/pdf', size_bytes: 2048, sha256: 'ab' }, 201),
      [`POST /v1/cases/${id}/evidence`]: () => {
        attached = true
        return ok({}, 201)
      },
      [`POST /v1/cases/${id}/submit`]: () => apiError(409, 'GEN_SLOT_TAKEN', 'That leg of the parent is taken.'),
      ...refs,
    })
    renderAs(SUPPORT, <CaseDetailPage caseId={id} />, fetchMock)
    expect(await screen.findByRole('heading', { level: 1, name: /Genealogy change/ })).toBeTruthy()
    expect(screen.getByText('The effect preview is calculated when the case is submitted for a decision.')).toBeTruthy()
    await userEvent.upload(await screen.findByLabelText('Add evidence'), new File(['%PDF'], 'consent.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Attach evidence' }))
    expect((await screen.findByRole('link', { name: 'consent.pdf' })).getAttribute('href')).toBe('/v1/documents/doc1/content')
    const [, attach] = callsTo(fetchMock, 'POST', `/v1/cases/${id}/evidence`)[0]!
    expect(bodyOf(attach)).toEqual({ document_id: 'doc1' })
    expect(headerOf(attach, 'idempotency-key')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Submit for decision' }))
    expect(await screen.findByText('That leg of the parent is taken.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('shows a failure with Try again instead of hiding Add evidence when the evidence rules cannot load', async () => {
    const id = record().id
    const fetchMock = fetchByRoute({
      [`GET /v1/cases/${id}`]: () => ok(record()),
      'GET /v1/documents/limits': () => apiError(500, 'INTERNAL', 'Something went wrong.'),
      ...refs,
    })
    renderAs(SUPPORT, <CaseDetailPage caseId={id} />, fetchMock)
    expect(await screen.findByText('This section could not be loaded')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows the stored effect preview and hides the decision for a contributor', async () => {
    const submitted = record({
      state: 'submitted', submitted_by: OFFICER.user.id, submitted_at: CREATED, eligible_approvers: [],
      effect_preview: {
        current_parent: { position_id: 'b', position_ref: 'P-B', leg: null }, proposed_parent: { position_id: PARENT, position_ref: 'P-A' },
        structural_check: { ok: true }, affected_committed_periods: [],
      },
    })
    renderAs(OFFICER, <CaseDetailPage caseId={submitted.id} />, fetchByRoute({ [`GET /v1/cases/${submitted.id}`]: () => ok(submitted), ...refs }))
    expect(await screen.findByText('No committed period affected.')).toBeTruthy()
    expect(screen.getByText('P-B')).toBeTruthy()
    const bar = screen.getByRole('region', { name: 'Approval' })
    expect(within(bar).getAllByText(/someone else must decide it/).length).toBeGreaterThan(0)
    expect(within(bar).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(bar).getByText(/No one can approve this yet/)).toBeTruthy()
  })

  it('approves with a reason and names the eligible approvers when the server refuses on SoD', async () => {
    const submitted = record({
      state: 'submitted', submitted_by: SUPPORT.user.id, submitted_at: CREATED, eligible_approvers: [CORA],
      effect_preview: {
        current_parent: null, proposed_parent: { position_id: PARENT, position_ref: 'P-A' }, structural_check: { ok: true },
        affected_committed_periods: [{ period_id: 'p1', starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2026-02-01T00:00:00.000Z', state: 'committed' }],
        affects_committed_periods: true, estimated_payout_impact: null, impact_note: 'Payout impact is calculated once runs exist (B3).',
      },
      type: 'genealogy_correction', payload: { kind: 'sponsor', proposed_parent_position_id: PARENT, valid_from: '2026-01-15T10:00:00.000Z' },
    })
    const fetchMock = fetchByRoute({
      [`GET /v1/cases/${submitted.id}`]: () => ok(submitted),
      [`POST /v1/cases/${submitted.id}/decision`]: () => json(422, { error: { code: 'SOD_SELF_APPROVAL', message: 'You prepared or contributed to this case, so someone else must decide it.', details: { eligible_approvers: [CORA] }, request_id: 'r' } }),
      ...refs,
    })
    renderAs(OFFICER, <CaseDetailPage caseId={submitted.id} />, fetchMock)
    expect((await screen.findByTestId('committed-periods')).textContent).toContain('Committed periods affected: 1')
    expect(screen.getByText('Payout impact is calculated once runs exist (B3).')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: /Approve this genealogy correction/ })
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Evidence checked')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await within(dialog).findByText(/Who can decide it: Cora Compliance/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', `/v1/cases/${submitted.id}/decision`)[0]!
    expect(bodyOf(init)).toEqual({ decision: 'approve', reason: 'Evidence checked' })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
  })
})
