// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { DuplicatesPage } from './duplicates-page'
import { utcToday } from './format'
import { GenealogyCasePage } from './genealogy-case-page'
import type { CaseDetail } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/cases/duplicates',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const SUPPORT = adminMe({
  user: { id: '00000000-0000-4000-8000-00000000005a', email: 'sam@acme.example', display_name: 'Sam Support' },
  permissions: ['case.genealogy.read', 'case.genealogy.create', 'case.duplicate.read', 'case.duplicate.create', 'genealogy.read', 'participant.read'],
})
const node = (id: string, ref: string) => ({
  position_id: id, position_ref: ref, owner: { participant_id: `p${id}`, external_ref: `D-${ref}`, display_name: `Owner ${ref}` },
  status: 'active', market_code: 'NL', leg: null, children_count: 0, subtree_count: null,
})
const detail = (id: string, ref: string, sponsor: { position_id: string; position_ref: string; valid_from: string } | null) => ok({
  id, position_ref: ref, market: { id: 'm1', code: 'NL' }, status: 'active', owner: null, parents: { sponsor, placement: null },
})

async function choose(label: string, query: string, result: RegExp) {
  await userEvent.type(screen.getByLabelText(label), query)
  await userEvent.click(screen.getByRole('button', { name: `Search ${label.toLowerCase()}` }))
  await userEvent.click(await screen.findByRole('button', { name: result }))
}

describe('GenealogyCasePage (SC-08 change)', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.router.push.mockReset()
  })

  function routes(extra: Record<string, () => Response> = {}) {
    return fetchByRoute({
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'GET /v1/genealogy/search': (query) => ok(query.get('q') === 'C' ? [node('c', 'P-C')] : [node('a', 'P-A')]),
      'GET /v1/positions/c': () => detail('c', 'P-C', { position_id: 'b', position_ref: 'P-B', valid_from: '2026-11-17T08:00:00.123456Z' }),
      ...extra,
    })
  }

  it('explains a cycle refusal at create and keeps the user on the form', async () => {
    const fetchMock = routes({ 'POST /v1/cases': () => apiError(409, 'GEN_CYCLE', 'This change would make the position its own ancestor.') })
    renderAs(SUPPORT, <GenealogyCasePage />, fetchMock)
    await choose('Position to move', 'C', /Choose P-C/)
    await choose('Proposed parent', 'A', /Choose P-A/)
    expect(screen.getByTestId('current-parent').textContent).toContain('P-B')
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'PARTICIPANT_REQUEST')
    await userEvent.upload(screen.getByLabelText('Evidence'), new File(['%PDF'], 'request.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open genealogy change case' }))
    expect(await screen.findByText(/would create a cycle/)).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/cases')[0]!
    expect(bodyOf(init)).toEqual({
      type: 'genealogy_change', subject_type: 'position', subject_id: 'c', reason_code: 'PARTICIPANT_REQUEST',
      payload: { kind: 'sponsor', proposed_parent_position_id: 'a', effective_from: utcToday() },
    })
    expect(callsTo(fetchMock, 'POST', '/v1/documents')).toHaveLength(0)
    expect(navigation.router.push).not.toHaveBeenCalled()
  })

  it('opens with the position from ?position= chosen, and says so when it cannot be read', async () => {
    navigation.search = 'position=c'
    const view = renderAs(SUPPORT, <GenealogyCasePage />, routes())
    expect((await screen.findByTestId('gc-position-chosen')).textContent).toContain('P-C')
    expect((await screen.findByTestId('current-parent')).textContent).toContain('P-B')
    view.unmount()
    navigation.search = 'tab=transfer&position=x'
    renderAs(SUPPORT, <GenealogyCasePage />, routes({ 'GET /v1/positions/x': () => apiError(404, 'NOT_FOUND', 'Not found.') }))
    expect(await screen.findByText('The linked position could not be loaded')).toBeTruthy()
    expect(screen.getByLabelText('Position to transfer')).toBeTruthy()
  })

  it('opens the transfer form from the PLAN deep link ?kind=transfer too', async () => {
    navigation.search = 'kind=transfer'
    renderAs(SUPPORT, <GenealogyCasePage />, routes())
    expect(await screen.findByLabelText('Position to transfer')).toBeTruthy()
  })

  it('files a correction from the current relationship start, uploads and attaches the evidence, then opens the case', async () => {
    const fetchMock = routes({
      'POST /v1/cases': () => ok({ id: 'case1' }, 201),
      'POST /v1/documents': () => ok({ id: 'doc1', file_name: 'request.pdf', mime: 'application/pdf', size_bytes: 4, sha256: 'ab' }, 201),
      'POST /v1/cases/case1/evidence': () => ok({}, 201),
    })
    renderAs(SUPPORT, <GenealogyCasePage />, fetchMock)
    await userEvent.click(screen.getByRole('radio', { name: /Correction/ }))
    await userEvent.click(screen.getByRole('radio', { name: /Placement tree/ }))
    expect(screen.getByLabelText(/Leg/)).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: /Sponsor tree/ }))
    await choose('Position to move', 'C', /Choose P-C/)
    await choose('Proposed parent', 'A', /Choose P-A/)
    expect(await screen.findByRole('radio', { name: /When the current parent started/ })).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'DATA_ENTRY_ERROR')
    await userEvent.upload(screen.getByLabelText('Evidence'), new File(['%PDF'], 'request.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open genealogy correction case' }))
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith('/cases/case1'))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/cases')[0]!
    expect(bodyOf(init)).toMatchObject({ type: 'genealogy_correction', payload: { kind: 'sponsor', proposed_parent_position_id: 'a', valid_from: '2026-11-17T08:00:00.123456Z' } })
    expect(headerOf(init, 'idempotency-key')).not.toBeNull()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/cases/case1/evidence')[0]![1])).toEqual({ document_id: 'doc1' })
  })

  it('keeps the opened case on a failed attach, locks the case fields, and sends a new evidence key for another file', async () => {
    let attaches = 0
    const fetchMock = routes({
      'POST /v1/cases': () => ok({ id: 'case1' }, 201),
      'POST /v1/documents': () => ok({ id: `doc${attaches + 1}`, file_name: 'request.pdf', mime: 'application/pdf', size_bytes: 4, sha256: 'ab' }, 201),
      'POST /v1/cases/case1/evidence': () => {
        attaches += 1
        return attaches === 1 ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly.') : ok({}, 201)
      },
    })
    renderAs(SUPPORT, <GenealogyCasePage />, fetchMock)
    await choose('Position to move', 'C', /Choose P-C/)
    await choose('Proposed parent', 'A', /Choose P-A/)
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'PARTICIPANT_REQUEST')
    await userEvent.upload(screen.getByLabelText('Evidence'), new File(['%PDF'], 'request.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open genealogy change case' }))
    expect(await screen.findByText('The case is open')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Correction/ }).matches(':disabled')).toBe(true)
    await userEvent.upload(screen.getByLabelText('Evidence'), new File(['%PDF-2'], 'other.pdf', { type: 'application/pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Attach evidence' }))
    await vi.waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith('/cases/case1'))
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(1)
    const [first, second] = callsTo(fetchMock, 'POST', '/v1/cases/case1/evidence').map(([, init]) => headerOf(init, 'idempotency-key'))
    expect(second).not.toBe(first)
  })

  it('shows a failure with Try again when the evidence rules cannot load, never a missing field', async () => {
    let failing = true
    const fetchMock = routes({
      'GET /v1/documents/limits': () => (failing ? apiError(500, 'INTERNAL', 'Something went wrong.') : ok({ max_file_bytes: 1048576, types: ['application/pdf'] })),
    })
    renderAs(SUPPORT, <GenealogyCasePage />, fetchMock)
    expect(await screen.findByText('This section could not be loaded')).toBeTruthy()
    expect(screen.queryByLabelText('Evidence')).toBeNull()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Evidence')).toBeTruthy()
  })

  it('asks for every required field before sending', async () => {
    const fetchMock = routes()
    renderAs(SUPPORT, <GenealogyCasePage />, fetchMock)
    await userEvent.click(screen.getByRole('button', { name: 'Open genealogy change case' }))
    const summary = await screen.findByRole('alert')
    for (const text of ['Choose the position to move.', 'Choose the proposed parent.', 'Choose a reason.', 'Choose the evidence file.']) {
      expect(within(summary).getByText(text)).toBeTruthy()
    }
    expect(callsTo(fetchMock, 'POST', '/v1/cases')).toHaveLength(0)
  })

  it('moves focus to Change after Choose and back to the search box after Change (WCAG 2.4.3)', async () => {
    renderAs(SUPPORT, <GenealogyCasePage />, routes())
    await choose('Position to move', 'C', /Choose P-C/)
    const change = screen.getByRole('button', { name: 'Change position to move' })
    expect(document.activeElement).toBe(change)
    expect(change.getAttribute('aria-describedby')).toBe('gc-position-chosen-name')
    await userEvent.click(change)
    expect(document.activeElement).toBe(screen.getByLabelText('Position to move'))
  })

  it('keeps a prefilled ?position= when switching between change and transfer', async () => {
    navigation.search = 'position=c'
    renderAs(SUPPORT, <GenealogyCasePage />, routes())
    const nav = await screen.findByRole('navigation', { name: 'Genealogy and duplicate cases' })
    expect(within(nav).getByRole('link', { name: /Sponsor and placement change/ }).getAttribute('href')).toBe('/cases/genealogy/new?position=c')
    expect(within(nav).getByRole('link', { name: /Ownership transfer/ }).getAttribute('href')).toBe('/cases/genealogy/new?tab=transfer&position=c')
  })

  it('is not available to users who cannot file genealogy cases', () => {
    renderAs(adminMe({ permissions: ['case.genealogy.read'] }), <GenealogyCasePage />, fetchByRoute({}))
    expect(screen.getByText(/Not found or not available/)).toBeTruthy()
  })
})

describe('DuplicatesPage (SC-08 duplicates)', () => {
  const subject = 'p-sub'
  const matched = 'p-match'
  const review = (overrides: Partial<CaseDetail> = {}): CaseDetail => ({
    id: '00000000-0000-4000-8000-0000000000d1', type: 'duplicate', subject_type: 'participant', subject_id: subject, reason_code: 'SIGNAL_MATCH',
    state: 'open', payload: { matched_participant_id: matched, matched_kinds: ['identity_ref'] }, effect_preview: null, due_at: null, market_id: 'm1',
    opened_by: null, opened_by_kind: 'system', assigned_to: null, submitted_by: null, submitted_at: null, decided_at: null, approval_id: null,
    created_at: '2026-11-17T09:00:00.000Z', evidence: [], events: [], eligible_approvers: null, ...overrides,
  })
  const participant = (id: string, ref: string, hold: boolean) => ok({
    id, external_ref: ref, account_type: 'individual', market: { id: 'm1', code: 'NL' }, display_name: `Name ${ref}`,
    contact_masked: { email: 'a***@example.com' }, status: 'active', merged_into: null, enrolled_at: '2026-11-17T08:00:00.000Z',
    types: [{ type: { code: 'DIST', name: 'Distributor' }, valid_from: '2026-11-17T08:00:00.000Z', valid_to: null }],
    positions: [{ id: `pos-${ref}`, position_ref: `P-${ref}`, status: hold ? 'pending' : 'active', owned_to: null }], duplicate_hold: hold,
  })

  it('compares the two participants, highlights the matched signal kinds, saves the outcome and submits', async () => {
    navigation.search = `case=${review().id}`
    let current = review()
    const fetchMock = fetchByRoute({
      'GET /v1/cases': () => ok([current]),
      [`GET /v1/cases/${current.id}`]: () => ok(current),
      [`GET /v1/participants/${subject}`]: () => participant(subject, 'D', true),
      [`GET /v1/participants/${matched}`]: () => participant(matched, 'B', false),
      [`PATCH /v1/cases/${current.id}`]: () => {
        current = review({ payload: { matched_participant_id: matched, matched_kinds: ['identity_ref'], proposed_outcome: 'allow' } })
        return ok(current)
      },
      [`POST /v1/cases/${current.id}/submit`]: () => ok({ ...current, state: 'submitted' }),
    })
    renderAs(SUPPORT, <DuplicatesPage />, fetchMock)
    const investigation = await screen.findByTestId('investigation')
    const subjectSide = within(investigation).getByRole('region', { name: 'Subject under review' })
    expect(await within(subjectSide).findByText('Duplicate review')).toBeTruthy()
    expect(within(await within(investigation).findByRole('region', { name: 'Matched participant' })).getByText('B · NL')).toBeTruthy()
    expect(within(within(investigation).getByRole('list', { name: 'Matching signals' })).getByText('Identity reference')).toBeTruthy()
    expect(within(investigation).queryByText('Payment fingerprint')).toBeNull()
    await userEvent.click(within(investigation).getByRole('radio', { name: 'Allow both participants' }))
    await userEvent.click(within(investigation).getByRole('button', { name: 'Save proposed outcome' }))
    const [, patch] = callsTo(fetchMock, 'PATCH', `/v1/cases/${current.id}`)[0]!
    expect(bodyOf(patch)).toEqual({ payload: { matched_participant_id: matched, matched_kinds: ['identity_ref'], proposed_outcome: 'allow' } })
    await userEvent.click(await screen.findByRole('button', { name: 'Submit for decision' }))
    await vi.waitFor(() => expect(callsTo(fetchMock, 'POST', `/v1/cases/${current.id}/submit`)).toHaveLength(1))
  })

  it('a review someone else opened shows its outcome read-only unless it is assigned to you', async () => {
    const other = review({ opened_by: 'u-other', opened_by_kind: 'user', reason_code: 'STAFF_SUSPICION' })
    navigation.search = `case=${other.id}`
    const fetchMock = fetchByRoute({
      'GET /v1/cases': () => ok([other]),
      [`GET /v1/cases/${other.id}`]: () => ok(other),
      [`GET /v1/participants/${subject}`]: () => participant(subject, 'D', false),
      [`GET /v1/participants/${matched}`]: () => participant(matched, 'B', false),
    })
    renderAs(SUPPORT, <DuplicatesPage />, fetchMock)
    const investigation = await screen.findByTestId('investigation')
    expect(within(investigation).getByText('Proposed outcome: not chosen yet')).toBeTruthy()
    expect(within(investigation).queryByRole('button', { name: 'Save proposed outcome' })).toBeNull()
  })
})
