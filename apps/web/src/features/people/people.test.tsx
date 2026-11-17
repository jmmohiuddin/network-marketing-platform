// @vitest-environment jsdom
import '../../test/dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import type { AgreementVersion, ParticipantType } from '../admin/settings/types'
import { enrolBody, enrolErrors, type EnrolForm } from './enrol-dialog'
import { ParticipantRecord, currentType } from './participant-record'
import { PeopleList } from './people-list'
import { statusChoices } from './record-dialogs'
import type { ParticipantDetail, ParticipantRow } from './types'
import ParticipantPage from '../../app/(staff)/people/[id]/page'

const navigation = vi.hoisted(() => ({ search: '', pathname: '/people', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const SUPPORT = adminMe({ permissions: ['participant.read', 'participant.manage', 'genealogy.read', 'servicing.manage', 'case.genealogy.create'] })
const COMPLIANCE = adminMe({ permissions: ['participant.read', 'participant.terminate', 'genealogy.read'] })
const FINANCE = adminMe({ permissions: ['participant.read', 'participant.unmask'] })
const AT = '2026-11-17T09:00:00.000Z'
const MARKET = { id: 'm1', code: 'NL', name: 'Netherlands', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Amsterdam', languages: ['nl'], minor_unit: 2 }

const ROW: ParticipantRow = {
  id: 'p1', external_ref: 'B-1', display_name: 'Bea Builder', market: { id: 'm1', code: 'NL' }, current_type: { code: 'DIST', name: 'Distributor' },
  status: 'active', enrolled_at: AT, positions: { count: 1, active: 1 },
}

const DIST: ParticipantType = {
  id: 't1', code: 'DIST', name: 'Distributor', can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true, state: 'active',
  reason: 'r', requested_by: { id: 'u', display_name: null }, requested_at: AT, decided_by: null, decided_at: null, decision_reason: null, eligible_approvers: null,
}

const AGREEMENT: AgreementVersion = {
  id: 'av1', market: { id: 'm1', code: 'NL' }, label: 'NL v1', document: { id: 'd1', file_name: 'terms.pdf' }, acceptance_required: true,
  published_at: AT, published_by: { id: 'u', display_name: null }, current: true, acceptances: { accepted: 0, not_accepted: 0 },
}

function detail(overrides: Partial<ParticipantDetail> = {}): ParticipantDetail {
  return {
    id: 'p1', external_ref: 'B-1', account_type: 'individual', market: { id: 'm1', code: 'NL' }, display_name: 'Bea Builder',
    contact_masked: { email: 'b•••@e•••.com', phone: '•••• 4912' }, status: 'active', merged_into: null, enrolled_at: AT,
    types: [{ type: { id: 't1', code: 'DIST', name: 'Distributor' }, valid_from: '2026-01-01T00:00:00.000Z', valid_to: null }],
    agreements: [{ version: { id: 'av1', label: 'NL v1' }, accepted_at: AT, evidence: { channel: 'web', reference: 'R-1' } }],
    positions: [{ id: 'pos1', position_ref: 'B1', status: 'active', status_from: AT, market: { id: 'm1', code: 'NL' }, owned_from: AT, owned_to: null }],
    duplicate_hold: false, ...overrides,
  }
}

const listRoutes = (extra: Record<string, (query: URLSearchParams) => Response> = {}) => fetchByRoute({
  'GET /v1/participants': () => ok([ROW]),
  'GET /v1/markets': () => ok([MARKET]),
  'GET /v1/participant-types': () => ok([DIST]),
  'GET /v1/agreement-versions': () => ok([AGREEMENT]),
  ...extra,
})

const recordRoutes = (data: ParticipantDetail, extra: Record<string, (query: URLSearchParams) => Response> = {}) => fetchByRoute({
  'GET /v1/participants/p1': () => ok(data),
  'GET /v1/participants/p1/servicing': () => ok([]),
  'GET /v1/positions/pos1/customers': () => ok([]),
  'GET /v1/positions/pos1': () => ok({ parents: { sponsor: { position_id: 'pos0', position_ref: 'A1', valid_from: AT, event_type: 'rule', rule_id: 'v1:reparent' }, placement: null } }),
  ...extra,
})

beforeEach(() => {
  navigation.search = ''
  navigation.pathname = '/people'
  navigation.router.replace.mockClear()
  navigation.router.push.mockClear()
})

describe('PeopleList', () => {
  it('lists participants with links and keeps filters in the URL', async () => {
    const user = userEvent.setup()
    navigation.search = 'q=Bea'
    const fetchMock = listRoutes()
    renderAs(SUPPORT, <PeopleList />, fetchMock)
    const link = await screen.findByRole('link', { name: 'B-1' })
    expect(link.getAttribute('href')).toBe('/people/p1')
    expect(within(link.closest('tr')!).getByText('1 (1 active)')).toBeTruthy()
    expect(new URL(callsTo(fetchMock, 'GET', '/v1/participants')[0]![0], 'http://x').searchParams.get('q')).toBe('Bea')
    await user.selectOptions(screen.getByLabelText('Market'), 'm1')
    expect(navigation.router.replace).toHaveBeenLastCalledWith('/people?q=Bea&market=m1')
    expect(screen.getByRole('button', { name: 'Remove filter: Search: Bea' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enrol participant' }).dataset.testid).toBe('primary-action')
  })

  it('offers no enrolment to readers', async () => {
    renderAs(FINANCE, <PeopleList />, listRoutes())
    await screen.findByRole('link', { name: 'B-1' })
    expect(screen.queryByRole('button', { name: 'Enrol participant' })).toBeNull()
  })

  it('enrols with the market’s current agreement, placement on a leg and signals, then opens the record', async () => {
    const user = userEvent.setup()
    const fetchMock = listRoutes({
      'POST /v1/participants': () => ok({ participant: { id: 'p9', external_ref: 'D-1', status: 'active' }, position: { id: 'x', position_ref: 'D1', status: 'pending' }, placement: null, servicing: null, duplicate_case_id: 'c1' }, 201),
    })
    renderAs(SUPPORT, <PeopleList />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Enrol participant' }))
    const dialog = screen.getByRole('dialog', { name: 'Enrol participant' })
    await user.type(within(dialog).getByLabelText('External reference'), 'D-1')
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'NL')
    await user.selectOptions(within(dialog).getByLabelText('Participant type'), 'DIST')
    await user.type(within(dialog).getByLabelText(/Place under position/), 'B1')
    const leg = await within(dialog).findByLabelText('Leg')
    // BUG-087: legs and automatic placement are offered without the retired placement-width setting (D-B3-06).
    expect(within(leg).getAllByRole('option').map((option) => option.textContent).slice(0, 3)).toEqual(['No leg', 'Automatic: first free leg, breadth-first', 'Leg 1'])
    expect(callsTo(fetchMock, 'GET', '/v1/settings/genealogy.placement_width')).toHaveLength(0)
    expect(within(dialog).queryByText(/placement width is set in Settings/)).toBeNull()
    await user.selectOptions(leg, 'auto')
    await user.type(within(dialog).getByLabelText(/Identity reference/), 'ID-123')
    await within(dialog).findByLabelText('The participant accepted NL v1')
    await user.click(within(dialog).getByRole('button', { name: 'Enrol participant' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Enrolment in NL needs the participant’s acceptance of NL v1.')
    expect(callsTo(fetchMock, 'POST', '/v1/participants')).toHaveLength(0)
    await user.click(within(dialog).getByLabelText('The participant accepted NL v1'))
    await user.click(within(dialog).getByRole('button', { name: 'Enrol participant' }))
    expect(await screen.findByText(/D-1 was enrolled. A duplicate review case was opened and the position stays pending/)).toBeTruthy()
    expect(navigation.router.push).toHaveBeenCalledWith('/people/p9')
    const [, init] = callsTo(fetchMock, 'POST', '/v1/participants')[0]!
    expect(bodyOf(init)).toMatchObject({
      external_ref: 'D-1', market: 'NL', type_code: 'DIST', account_type: 'individual', placement: { auto: true, position_ref: 'B1' },
      agreement: { version_id: 'av1' }, signals: { identity_ref: 'ID-123' },
    })
    expect(bodyOf(init)).not.toHaveProperty('contact')
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })
})

describe('enrolBody', () => {
  const PUBLISHED = { ...AGREEMENT, published_at: '2025-06-01T00:00:00.000Z' }
  const form: EnrolForm = {
    external_ref: 'A-1', market: 'NL', type_code: 'DIST', account_type: 'joint', display_name: ' Ann ', email: 'a@x.example', phone: '', address: '',
    enrolled_at: '', position_ref: '', sponsor: 'S1', placement: 'P1', leg: '2', accepted: false, accepted_at: '', evidence_channel: 'web', evidence_reference: '', signals: { device_id: ' ' },
  }
  it('leaves empty optional parts out and sends a chosen leg', () => {
    expect(JSON.parse(JSON.stringify(enrolBody(form, null, AT)))).toEqual({
      external_ref: 'A-1', market: 'NL', type_code: 'DIST', account_type: 'joint', display_name: 'Ann', contact: { email: 'a@x.example' },
      sponsor: { position_ref: 'S1' }, placement: { position_ref: 'P1', leg: '2' },
    })
  })

  it('refuses half the agreement evidence and a future acceptance instead of dropping them', () => {
    const accepted = { ...form, accepted: true, accepted_at: '2026-01-01T10:00' }
    expect(enrolErrors(accepted, PUBLISHED)).toEqual({ 'agreement.evidence.reference': 'Enter both the evidence channel and reference, or neither.' })
    expect(enrolErrors({ ...accepted, evidence_channel: '', evidence_reference: 'R-1' }, PUBLISHED))
      .toEqual({ 'agreement.evidence.channel': 'Enter both the evidence channel and reference, or neither.' })
    expect(enrolErrors({ ...accepted, evidence_reference: 'R-1', accepted_at: '2999-01-01T10:00' }, PUBLISHED))
      .toEqual({ 'agreement.accepted_at': 'Acceptance cannot be in the future.' })
    expect(enrolErrors({ ...accepted, evidence_reference: 'R-1' }, PUBLISHED)).toEqual({})
  })

  it('sends the dialog-open instant for an empty acceptance time and refuses one before the publication', () => {
    const accepted = { ...form, accepted: true, evidence_channel: '' }
    expect(enrolErrors(accepted, PUBLISHED)).toEqual({})
    expect(enrolBody(accepted, PUBLISHED, '2026-11-17T10:30:42.123Z').agreement).toEqual({ version_id: 'av1', accepted_at: '2026-11-17T10:30:42.123Z' })
    expect(enrolErrors({ ...accepted, accepted_at: '2000-01-01T00:00' }, PUBLISHED)['agreement.accepted_at']).toMatch(/^Acceptance cannot be before NL v1 was published/)
  })
})

describe('ParticipantRecord (SC-09)', () => {
  beforeEach(() => {
    navigation.pathname = '/people/p1'
  })

  it('shows the masked contact, the duplicate-review chip and no forbidden content', async () => {
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, recordRoutes(detail({ duplicate_hold: true })))
    expect(await screen.findByRole('heading', { level: 1, name: 'Bea Builder' })).toBeTruthy()
    expect(screen.getByText('Duplicate review')).toBeTruthy()
    expect(screen.getByText('b•••@e•••.com')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show contact' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Start case' }).getAttribute('href')).toBe('/cases/genealogy/new?position=pos1')
    expect(screen.getByRole('link', { name: 'Open in genealogy' }).getAttribute('href')).toBe('/genealogy?root=pos1')
    expect(screen.getByRole('link', { name: 'Qualification history' }).getAttribute('href')).toBe('/people/p1/qualification') // SC-43
    expect(screen.queryByText(/Tax|Banking|Ledger|earning|rank/i)).toBeNull()
  })

  it('shows contact only through the step-up dialog, with the chosen fields', async () => {
    const user = userEvent.setup()
    let attempts = 0
    const fetchMock = recordRoutes(detail(), {
      'POST /v1/participants/p1/unmask': () => (++attempts === 1 ? apiError(403, 'STEP_UP_REQUIRED') : ok({ contact: { email: 'bea@example.com' } })),
      'POST /v1/auth/sessions/current/step-up': () => ok({ assurance: 'aal2' }),
    })
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Show contact' }))
    const dialog = screen.getByRole('dialog', { name: 'Show contact details' })
    await user.click(within(dialog).getByLabelText('Phone'))
    await user.click(within(dialog).getByRole('button', { name: 'Show contact' }))
    await user.type(await screen.findByLabelText('Verification code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await within(dialog).findByText('bea@example.com')).toBeTruthy()
    // Focus lands on the revealed values inside the open dialog, not on the page body (BUG-073).
    await vi.waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText('Contact details shown')))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/participants/p1/unmask')[0]![1])).toEqual({ fields: ['email'] })
    await user.click(within(dialog).getByRole('button', { name: 'Hide and close' }))
    expect(screen.queryByText('bea@example.com')).toBeNull()
  })

  it('moves focus to the shown contact when no step-up is asked (the Show contact button is gone)', async () => {
    const user = userEvent.setup()
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, recordRoutes(detail(), { 'POST /v1/participants/p1/unmask': () => ok({ contact: { email: 'bea@example.com' } }) }))
    await user.click(await screen.findByRole('button', { name: 'Show contact' }))
    const dialog = screen.getByRole('dialog', { name: 'Show contact details' })
    await user.click(within(dialog).getByRole('button', { name: 'Show contact' }))
    expect(await within(dialog).findByText('bea@example.com')).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Contact details shown'))
  })

  it('a support agent changes status but cannot terminate', async () => {
    navigation.search = 'tab=positions'
    const user = userEvent.setup()
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, recordRoutes(detail()))
    // BUG-088: the sponsor now names the plan rule that re-parented the position.
    expect(await screen.findByText(/^By plan rule “reparent”, since /)).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Change status of B1' }))
    const options = within(screen.getByLabelText('New status')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Suspended'])
  })

  it('a compliance officer terminates with a reason and an Idempotency-Key', async () => {
    navigation.search = 'tab=positions'
    const user = userEvent.setup()
    const fetchMock = recordRoutes(detail(), { 'POST /v1/positions/pos1/status': () => ok({ position: {}, reassigned_customers: 2 }) })
    renderAs(COMPLIANCE, <ParticipantRecord participantId="p1" />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change status of B1' }))
    expect(within(screen.getByLabelText('New status')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Terminated'])
    await user.selectOptions(screen.getByLabelText('New status'), 'terminated')
    expect(screen.getByText('Termination reassigns customers')).toBeTruthy()
    expect(screen.getByText('You may be asked for a code from your authenticator app.')).toBeTruthy()
    await user.type(screen.getByLabelText('Reason'), 'Breach of policy')
    await user.click(screen.getByRole('button', { name: 'Terminate position' }))
    expect(await screen.findByText('Position B1 is now terminated. 2 customers were reassigned.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/positions/pos1/status')[0]!
    expect(bodyOf(init)).toMatchObject({ status: 'terminated', reason: 'Breach of policy' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('changes the servicer of an end customer to the company', async () => {
    navigation.search = 'tab=servicing'
    const user = userEvent.setup()
    const fetchMock = recordRoutes(detail({ positions: [] }), {
      'GET /v1/participants/p1/servicing': () => ok([
        { position: { id: 'pos1', position_ref: 'C1', owner_name: 'Cy' }, source: 'enrolment', valid_from: AT, valid_to: null, case_id: null },
        { position: { id: 'pos2', position_ref: 'C2', owner_name: 'Eva Now' }, source: 'enrolment', valid_from: '2026-01-01T00:00:00.000Z', valid_to: AT, case_id: null },
      ]),
      'PUT /v1/customers/p1/servicing': () => ok({ servicing: { position_id: null, source: 'manual', valid_from: AT } }),
    })
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, fetchMock)
    expect((await screen.findAllByText('At enrolment')).length).toBe(2)
    // The ended row names its position by reference only: its owner now may not have owned it then (BUG-080).
    expect(screen.getByText(/· Cy/)).toBeTruthy()
    expect(screen.queryByText(/Eva Now/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Change servicer' }))
    await user.click(screen.getByLabelText('The company services this customer'))
    await user.type(screen.getByLabelText('Reason'), 'Customer asked')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change servicer' }))
    expect(await screen.findByText('The company services this customer now.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/customers/p1/servicing')[0]![1])).toEqual({ position_ref: null, reason: 'Customer asked' })
  })

  it('links cases by participant and by position for a user who can read both case types', async () => {
    navigation.search = 'tab=cases'
    renderAs(adminMe({ permissions: ['participant.read', 'case.duplicate.read', 'case.genealogy.read'] }), <ParticipantRecord participantId="p1" />, recordRoutes(detail()))
    expect((await screen.findByRole('link', { name: 'Cases about B-1' })).getAttribute('href')).toBe('/cases?subject_type=participant&subject_id=p1')
    expect(screen.getByRole('link', { name: 'Cases about position B1' }).getAttribute('href')).toBe('/cases?subject_type=position&subject_id=pos1')
    expect(screen.queryByText(/Start a case from the page header/)).toBeNull()
  })

  it('offers no case link to a user who cannot read cases', async () => {
    navigation.search = 'tab=cases'
    renderAs(FINANCE, <ParticipantRecord participantId="p1" />, recordRoutes(detail()))
    expect(await screen.findByText(/Cases are handled by support and compliance/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Cases about/ })).toBeNull()
  })

  it('warns of step-up when reinstating a terminated position, without the termination banner', async () => {
    navigation.search = 'tab=positions'
    const user = userEvent.setup()
    renderAs(COMPLIANCE, <ParticipantRecord participantId="p1" />, recordRoutes(detail({ positions: [{ ...detail().positions[0]!, status: 'terminated' }] })))
    await user.click(await screen.findByRole('button', { name: 'Change status of B1' }))
    expect(within(screen.getByLabelText('New status')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Active'])
    expect(screen.getByText('You may be asked for a code from your authenticator app.')).toBeTruthy()
    expect(screen.queryByText('Termination reassigns customers')).toBeNull()
  })

  it('never sends a route id that is not a UUID to the API', async () => {
    render(await ParticipantPage({ params: Promise.resolve({ id: '../users' }) }))
    expect(screen.getByText('Not found or not available to you')).toBeTruthy()
  })

  it('says "not available" for a participant outside the user’s markets', async () => {
    renderAs(SUPPORT, <ParticipantRecord participantId="p1" />, fetchByRoute({ 'GET /v1/participants/p1': () => apiError(404, 'NOT_FOUND') }))
    expect(await screen.findByText('Not found or not available to you')).toBeTruthy()
  })
})

describe('record helpers', () => {
  it('offers only the moves the API allows: termination and reinstatement with participant.terminate, the rest with participant.manage', () => {
    const manage = { canManage: true, canTerminate: false, duplicateHold: false }
    const terminate = { canManage: false, canTerminate: true, duplicateHold: false }
    const both = { canManage: true, canTerminate: true, duplicateHold: false }
    expect(statusChoices('active', manage)).toEqual(['suspended'])
    expect(statusChoices('active', terminate)).toEqual(['terminated'])
    expect(statusChoices('suspended', terminate)).toEqual(['terminated'])
    expect(statusChoices('suspended', both)).toEqual(['active', 'terminated'])
    expect(statusChoices('pending', both)).toEqual(['active', 'terminated'])
    expect(statusChoices('pending', { ...both, duplicateHold: true })).toEqual(['terminated'])
    expect(statusChoices('terminated', manage)).toEqual([])
    expect(statusChoices('terminated', terminate)).toEqual(['active'])
  })

  it('finds the type in force', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z')
    expect(currentType(detail(), now)?.code).toBe('DIST')
    expect(currentType(detail({ types: [] }), now)).toBeNull()
  })
})
