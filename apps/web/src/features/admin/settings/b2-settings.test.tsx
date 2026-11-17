// @vitest-environment jsdom
import '../../../test/dom'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, json, ok } from '../../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../test-support'
import { countText } from './agreements'
import { valueText } from './labels'
import { typeCodeError } from './participant-types'
import { draftOf, policyValue } from './policy-fields'
import { SettingsPage } from './settings-page'
import type { AgreementVersion, ChangeRequest, ParticipantType } from './types'

const router = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/settings', useSearchParams: () => router.params }))

const ADMIN = adminMe({ permissions: ['settings.manage', 'market.manage'] })
const DPO = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000d1', email: 'dee@acme.example', display_name: 'Dee DPO' }, permissions: ['privacy.manage', 'participant.read'] })
const FINANCE = adminMe({ user: { id: '00000000-0000-4000-8000-0000000000f2', email: 'fay@acme.example', display_name: 'Fay Finance' }, permissions: ['settings.approve'] })
const COMPLIANCE = adminMe({
  user: { id: '00000000-0000-4000-8000-0000000000c1', email: 'cora@acme.example', display_name: 'Cora Compliance' },
  permissions: ['participant_type.approve', 'agreement.publish', 'participant.read'],
})
const CORA = { user_id: COMPLIANCE.user.id, display_name: 'Cora Compliance', email: 'cora@acme.example' }
const DEE = { user_id: DPO.user.id, display_name: 'Dee DPO', email: 'dee@acme.example' }
const B2 = [
  'participants.duplicate_matching', 'customers.reassignment_rule', 'orders.crediting_event', 'orders.purpose_required',
  'orders.attribution_precedence', 'orders.new_buyer_type', 'orders.restocking_fee_volume_effect', 'integrations.sync_health',
  'genealogy.placement_width', 'genealogy.visibility_policy',
]

function settings(values: Record<string, unknown> = {}, keys: readonly string[] = B2) {
  return () => json(200, {
    data: { version: 3, effective_from: '2026-11-01T00:00:00.000Z', values: Object.fromEntries(keys.map((key) => [key, { value: values[key] ?? null, value_since: null }])) },
    meta: { latest_version: 3 },
  })
}

function type(overrides: Partial<ParticipantType> = {}): ParticipantType {
  return {
    id: 't1', code: 'DIST', name: 'Distributor', can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true,
    state: 'pending', reason: 'Field sales', requested_by: { id: ADMIN.user.id, display_name: 'Ada Admin' }, requested_at: '2026-11-17T09:00:00.000Z',
    decided_by: null, decided_at: null, decision_reason: null, eligible_approvers: [CORA], ...overrides,
  }
}

const VERSION: AgreementVersion = {
  id: 'av1', market: { id: 'm1', code: 'NL' }, label: 'NL v1', document: { id: 'd1', file_name: 'terms.pdf' }, acceptance_required: true,
  published_at: '2026-11-17T09:00:00.000Z', published_by: { id: COMPLIANCE.user.id, display_name: 'Cora Compliance' }, current: true,
  acceptances: { accepted: '1200', not_accepted: 3 },
}

const VISIBILITY_REQUEST: ChangeRequest = {
  id: '0f000000-0000-4000-8000-0000000000aa', key: 'genealogy.visibility_policy', value: { named_depth: 1, contact_for_personally_sponsored: false },
  effective_from: '2026-12-01T00:00:00.000Z', reason: 'Privacy review', base_version: 3, state: 'pending',
  requested_by: { id: ADMIN.user.id, display_name: 'Ada Admin' }, requested_at: '2026-11-17T09:00:00.000Z', decided_by: null, decided_at: null,
  decision_reason: null, version: null, eligible_approvers: [DEE], no_eligible_approver: false,
}

function routes(extra: Record<string, (query: URLSearchParams) => Response> = {}) {
  return fetchByRoute({
    'GET /v1/settings': settings(),
    'GET /v1/setting-change-requests': () => ok([]),
    'GET /v1/settings/versions': () => ok([]),
    'GET /v1/participant-types': () => ok([type()]),
    'GET /v1/agreement-versions': () => ok([VERSION]),
    ...extra,
  })
}

describe('SC-29 B2 policy cards', () => {
  it('states what holds while each B2 key is unset, and the platform safe default for visibility', async () => {
    renderAs(ADMIN, <SettingsPage />, routes())
    const crediting = (await screen.findByRole('heading', { name: 'Crediting event' })).closest('li')!
    expect(within(crediting).getByText('Orders are refused until set.')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: 'Customer reassignment rule' }).closest('li')!).getByText('Positions that service customers cannot be terminated until set.')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: 'Restocking-fee volume effect' }).closest('li')!).getByText('Events with a restocking fee are refused until set.')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: 'Duplicate matching' }).closest('li')!).getByText('No duplicate matching.')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: 'Placement width' }).closest('li')!).getByText('Auto placement and legs unavailable.')).toBeTruthy()
    const visibility = screen.getByTestId('visibility-policy')
    expect(within(visibility).getByText('Platform safe default in force')).toBeTruthy()
    // In the narrow side card the value stacks under the title at every width, never beside it (BUG-069).
    expect(within(visibility).getByRole('heading', { name: 'Downline depth masking' }).closest('li')!.className).not.toContain('md:flex-row')
    expect(crediting.className).toContain('md:flex-row')
    // Must-not-implement items of SC-29 (PLAN B2 5).
    expect(screen.queryByText(/Prospect Data Ownership|retention|Revert|rollback/i)).toBeNull()
  })

  it('sends a visibility change as a DPO change request with its effective date', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'PUT /v1/settings/genealogy.visibility_policy': () => json(202, { data: { change_request: VISIBILITY_REQUEST }, meta: { latest_version: 3 } }) })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Change downline depth masking' }))
    const dialog = screen.getByRole('dialog', { name: 'Save new version with effective date' })
    expect(within(dialog).getByText('Needs DPO approval')).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Levels shown by name'), '2')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Privacy review')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('Enter the date and time the change takes effect.')
    await user.type(within(dialog).getByLabelText('Effective from'), '2099-01-01T00:00')
    await user.click(within(dialog).getByLabelText('Show the masked contact of personally sponsored participants'))
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    expect(await screen.findByText('Downline depth masking change sent. Waiting for DPO approval.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/settings/genealogy.visibility_policy')[0]!
    expect(bodyOf(init)).toEqual({ value: { named_depth: 2, contact_for_personally_sponsored: true }, reason: 'Privacy review', effective_from: new Date('2099-01-01T00:00').toISOString() })
    expect(headerOf(init, 'If-Match')).toBe('"3"')
  })

  it('applies an order setting at once from the value in force', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({
      'GET /v1/settings': settings({ 'orders.attribution_precedence': ['link', 'servicing'] }),
      'PUT /v1/settings/orders.attribution_precedence': () => json(200, { data: { version: 4 }, meta: { latest_version: 4 } }),
    })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    const row = (await screen.findByRole('heading', { name: 'Attribution precedence' })).closest('li')!
    expect(within(row).getByText('Link, then Servicing')).toBeTruthy()
    await user.click(within(row).getByRole('button', { name: 'Change attribution precedence' }))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Counts first') as HTMLSelectElement).value).toBe('link')
    await user.selectOptions(within(dialog).getAllByLabelText(/^Then/)[1]!, 'code')
    await user.type(within(dialog).getByLabelText('Reason for the change'), 'Codes too')
    await user.click(within(dialog).getByRole('button', { name: 'Save new version' }))
    expect(await screen.findByText('Attribution precedence saved as version 4.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/settings/orders.attribution_precedence')[0]![1])).toEqual({ value: ['link', 'servicing', 'code'], reason: 'Codes too' })
  })

  it('lets the DPO, not Finance, decide a visibility request', async () => {
    const withRequest = { 'GET /v1/setting-change-requests': () => ok([VISIBILITY_REQUEST]) }
    renderAs(DPO, <SettingsPage />, routes({ ...withRequest, 'GET /v1/settings': settings({}, ['genealogy.visibility_policy']) }))
    const card = (await screen.findByText('Waiting for DPO approval')).closest('article, li')!
    expect(within(card as HTMLElement).getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(within(card as HTMLElement).getByText(/Dee DPO/)).toBeTruthy()
    // The DPO reads the visibility key only: no empty money card, no change button.
    expect(screen.queryByRole('heading', { name: 'Money policies' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change downline depth masking' })).toBeNull()
  })

  it('shows Finance no decision on a visibility request', async () => {
    renderAs(FINANCE, <SettingsPage />, routes({ 'GET /v1/setting-change-requests': () => ok([VISIBILITY_REQUEST]), 'GET /v1/settings': settings({}, ['money.rounding_mode']) }))
    expect(await screen.findByText('Waiting for DPO approval')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})

describe('SC-29 participant types', () => {
  it('proposes a type with its fixed flags and an Idempotency-Key; the proposer may withdraw, never approve', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/participant-types': () => ok(type({ id: 't2', code: 'RETAIL' }), 201) })
    renderAs(ADMIN, <SettingsPage />, fetchMock)
    const row = (await screen.findByText('Distributor')).closest('tr')!
    expect(within(row).getByRole('button', { name: 'Withdraw type DIST' })).toBeTruthy()
    expect(within(row).queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(within(row).getByText('Can approve: Cora Compliance (cora@acme.example)')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Propose type' }))
    const dialog = screen.getByRole('dialog', { name: 'Propose participant type' })
    await user.type(within(dialog).getByLabelText('Code'), '1x')
    await user.click(within(dialog).getByRole('button', { name: 'Propose type' }))
    expect(within(dialog).getByRole('alert').textContent).toContain('starting with a letter')
    await user.clear(within(dialog).getByLabelText('Code'))
    await user.type(within(dialog).getByLabelText('Code'), 'retail')
    await user.type(within(dialog).getByLabelText('Name'), 'Retail customer')
    await user.click(within(dialog).getByLabelText('Counts as end customer'))
    await user.type(within(dialog).getByLabelText('Reason'), 'Store buyers')
    await user.click(within(dialog).getByRole('button', { name: 'Propose type' }))
    expect(await screen.findByText('Type RETAIL proposed. A Compliance officer must approve it.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/participant-types')[0]!
    expect(bodyOf(init)).toEqual({ code: 'RETAIL', name: 'Retail customer', can_earn: false, can_sponsor: false, can_hold_positions: false, counts_as_end_customer: true, reason: 'Store buyers' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
  })

  it('a Compliance officer without settings access sees types and agreements only, and approves with a reason', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({ 'POST /v1/participant-types/t1/decision': () => ok(type({ state: 'active' })) })
    renderAs(COMPLIANCE, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Approve type DIST' }))
    await user.type(screen.getByLabelText('Reason'), 'Checked')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve type DIST' }))
    expect(await screen.findByText('Type DIST approved.')).toBeTruthy()
    const [, init] = callsTo(fetchMock, 'POST', '/v1/participant-types/t1/decision')[0]!
    expect(bodyOf(init)).toEqual({ decision: 'approve', reason: 'Checked' })
    expect(headerOf(init, 'Idempotency-Key')).not.toBeNull()
    expect(callsTo(fetchMock, 'GET', '/v1/settings')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Agreement versions' })).toBeTruthy()
  })

  it('names the eligible approvers in a separation-of-duties refusal', async () => {
    const user = userEvent.setup()
    renderAs(COMPLIANCE, <SettingsPage />, routes({
      'POST /v1/participant-types/t1/decision': () => apiError(422, 'SOD_SELF_APPROVAL', 'You cannot approve your own proposal.', { eligible_approvers: [CORA] }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Reject type DIST' }))
    await user.type(screen.getByLabelText('Reason'), 'No')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reject type DIST' }))
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('Who can decide it: Cora Compliance (cora@acme.example).')
  })
})

describe('SC-29 agreement versions', () => {
  it('lists versions with acceptance counts and publishes an uploaded agreement', async () => {
    const user = userEvent.setup()
    const fetchMock = routes({
      'GET /v1/markets': () => ok([{ id: 'm1', code: 'NL', name: 'Netherlands', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Amsterdam', languages: ['nl'], minor_unit: 2 }]),
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'POST /v1/documents': () => ok({ id: 'd2', file_name: 'nl-v2.pdf', mime: 'application/pdf', size_bytes: 4, sha256: 'ab' }, 201),
      'POST /v1/agreement-versions': () => ok({ ...VERSION, id: 'av2', label: 'NL v2' }, 201),
    })
    renderAs(COMPLIANCE, <SettingsPage />, fetchMock)
    const row = (await screen.findByText('NL v1')).closest('tr')!
    expect(within(row).getByText('Current')).toBeTruthy()
    expect(within(row).getByText('1,200')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'terms.pdf' }).getAttribute('href')).toBe('/v1/documents/d1/content')
    await user.click(screen.getByRole('button', { name: 'Publish version' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish agreement version' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    await user.type(within(dialog).getByLabelText('Label'), 'NL v2')
    await user.upload(within(dialog).getByLabelText(/Agreement document/), new File(['%PDF'], 'nl-v2.pdf', { type: 'application/pdf' }))
    await user.click(within(dialog).getByRole('button', { name: 'Publish version' }))
    expect(await screen.findByText('Agreement NL v2 published.')).toBeTruthy()
    const upload = callsTo(fetchMock, 'POST', '/v1/documents')[0]![1].body as FormData
    expect(upload.get('class')).toBe('agreement')
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/agreement-versions')[0]![1])).toEqual({ market_id: 'm1', label: 'NL v2', document_id: 'd2', acceptance_required: true })
  })

  it('a publish retried after dropping another file sends a new Idempotency-Key, a plain retry the same one', async () => {
    const user = userEvent.setup()
    let documents = 0
    let publishes = 0
    const fetchMock = routes({
      'GET /v1/markets': () => ok([{ id: 'm1', code: 'NL', name: 'Netherlands', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Amsterdam', languages: ['nl'], minor_unit: 2 }]),
      'GET /v1/documents/limits': () => ok({ max_file_bytes: 1048576, types: ['application/pdf'] }),
      'POST /v1/documents': () => ok({ id: `d${(documents += 1)}`, file_name: 'nl-v2.pdf', mime: 'application/pdf', size_bytes: 4, sha256: 'ab' }, 201),
      'POST /v1/agreement-versions': () => ((publishes += 1) < 3 ? apiError(503, 'UNAVAILABLE') : ok({ ...VERSION, id: 'av2', label: 'NL v2' }, 201)),
    })
    renderAs(COMPLIANCE, <SettingsPage />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Publish version' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish agreement version' })
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    await user.type(within(dialog).getByLabelText('Label'), 'NL v2')
    await user.upload(within(dialog).getByLabelText(/Agreement document/), new File(['%PDF'], 'nl-v2.pdf', { type: 'application/pdf' }))
    const publish = within(dialog).getByRole('button', { name: 'Publish version' })
    await user.click(publish)
    await user.click(publish)
    fireEvent.drop(within(dialog).getByText('nl-v2.pdf').parentElement!, { dataTransfer: { files: [new File(['%PDF2'], 'nl-v3.pdf', { type: 'application/pdf' })] } })
    await user.click(publish)
    expect(await screen.findByText('Agreement NL v2 published.')).toBeTruthy()
    const [first, retry, dropped] = callsTo(fetchMock, 'POST', '/v1/agreement-versions').map(([, init]) => ({ key: headerOf(init, 'Idempotency-Key'), body: bodyOf(init) }))
    expect(retry!.key).toBe(first!.key)
    expect(dropped!.key).not.toBe(first!.key)
    expect(dropped!.body).toMatchObject({ document_id: 'd2' })
  })
})

describe('B2 settings helpers', () => {
  it('builds and checks B2 values', () => {
    expect(policyValue('participants.duplicate_matching', { signal_identity_ref: 'true', min_matches: '2' }).errors.min_matches).toContain('from 1 to 1')
    expect(policyValue('participants.duplicate_matching', { signal_identity_ref: 'true', signal_address: 'true', min_matches: '1', hold_activation: 'true' }).value)
      .toEqual({ signals: ['identity_ref', 'address'], min_matches: 1, hold_activation: true })
    expect(policyValue('integrations.sync_health', { behind: '60', failing: '60' }).errors.failing).toBe('The failing lag must be longer than the behind lag.')
    expect(policyValue('orders.attribution_precedence', { first: 'link', second: 'link' }).errors.second).toBe('Choose each source once.')
    expect(policyValue('customers.reassignment_rule', { rule: 'sponsor', notice_days: '0' }).value).toEqual({ rule: 'sponsor', notice_days: 0 })
    expect(policyValue('genealogy.placement_width', { value: '1' }).errors.value).toContain('from 2 to 20')
    expect(policyValue('orders.purpose_required', { value: 'false' }).value).toBe(false)
    expect(draftOf('integrations.sync_health', { behind_after_minutes: 60, failing_after_minutes: 240 })).toEqual({ behind: '60', failing: '240' })
    expect(typeCodeError('DIST_2')).toBeNull()
    expect(countText('12345678901234567890')).toBe('12,345,678,901,234,567,890')
  })

  it('words B2 values', () => {
    expect(valueText('customers.reassignment_rule', { rule: 'sponsor', notice_days: 0 })).toBe('To the sponsor, after 0 days')
    expect(valueText('integrations.sync_health', { behind_after_minutes: 60, failing_after_minutes: 240 })).toBe('Behind after 60 minutes, failing after 240 minutes')
    expect(valueText('genealogy.visibility_policy', { named_depth: 1, contact_for_personally_sponsored: false })).toBe('Names 1 level down; contact of personally sponsored hidden')
    expect(valueText('orders.purpose_required', true)).toBe('Required')
  })
})
