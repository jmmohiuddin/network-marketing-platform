// @vitest-environment jsdom
import '../../test/dom'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { adminMe, bodyOf, callsTo, fetchByRoute, headerOf, renderAs } from '../admin/test-support'
import { blockerText, privacyItemLabel } from './format'
import { PrivacyRequestsPage } from './privacy-list'
import type { LegalHold, RetentionSchedule } from './types'

const navigation = vi.hoisted(() => ({ search: '', router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  usePathname: () => '/privacy',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const DPO = adminMe({ permissions: ['privacy.manage', 'legal_hold.manage', 'participant.read'] })
const COMPLIANCE = adminMe({ permissions: ['legal_hold.manage', 'participant.read'] })
const MARKET = { id: 'm1', code: 'BE', name: 'Belgium', currency: 'EUR', state: 'live', market_pack: 'x', time_zone: 'Europe/Brussels', languages: ['en'], minor_unit: 2 }
const OTHER = { id: '00000000-0000-4000-8000-0000000000d2', display_name: 'Dora DPO' }

function schedule(overrides: Partial<RetentionSchedule> = {}): RetentionSchedule {
  return {
    id: 's1', data_class: 'terminated_participant', market: { id: 'm1', code: 'BE' }, retain_days: 365, basis: 'Commercial code art. 5',
    effective_from: '2026-11-21', state: 'proposed', in_force: false, proposed_by: { id: DPO.user.id, display_name: 'Ada Admin' },
    proposed_at: '2026-11-21T08:00:00.000Z', approver: null, decided_at: null, ...overrides,
  }
}

function hold(overrides: Partial<LegalHold> = {}): LegalHold {
  return {
    id: 'h1', participant: { id: 'p2', external_ref: 'BE-R2' }, market_id: 'm1', reason: 'Pending court claim', placed_by: OTHER,
    placed_at: '2026-11-20T08:00:00.000Z', released_by: null, released_at: null, ...overrides,
  }
}

beforeEach(() => {
  navigation.search = ''
  navigation.router.replace.mockReset()
})

describe('SC-15 retention tab (D-V1A-08)', () => {
  it('lists schedules with a summary, proposes one and shows the second-person refusal of the proposer', async () => {
    navigation.search = 'tab=retention'
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/retention/schedules': () => ok([schedule(), schedule({ id: 's2', data_class: 'privacy_request', market: null, state: 'approved', in_force: true, approver: OTHER })]),
      'GET /v1/retention/runs': () => ok([{ id: 'r1', schedule_id: 's2', data_class: 'privacy_request', started_at: '2026-11-21T02:30:00.000Z', finished_at: '2026-11-21T02:30:01.000Z', due: 2, applied: 1, held: 1, deferred: 0 }]),
      'GET /v1/markets': () => ok([MARKET]),
      'POST /v1/retention/schedules': () => ok(schedule({ id: 's3' }), 201),
      'POST /v1/retention/schedules/s1/decision': () => apiError(422, 'SOD_SELF_APPROVAL', 'Someone other than the proposer must decide.'),
    })
    renderAs(DPO, <PrivacyRequestsPage />, fetchMock)
    expect(await screen.findByText('1 schedule in force, 1 waiting for a decision. Nothing is deleted without an approved schedule in force; members under a legal hold are skipped.')).toBeTruthy()
    expect(screen.getByText('In force')).toBeTruthy()
    expect(screen.getByText('Another privacy manager must decide.')).toBeTruthy()
    expect(within(screen.getByRole('table', { name: 'Retention runs' })).getAllByText('1').length).toBeGreaterThanOrEqual(2)

    await user.click(await screen.findByRole('button', { name: 'Propose schedule' }))
    const dialog = screen.getByRole('dialog', { name: 'Propose a retention schedule' })
    // The API checks the date against the server's (UTC) date, not the browser's local one.
    expect(within(dialog).getByLabelText('Applies from').getAttribute('min')).toBe(new Date().toISOString().slice(0, 10))
    await user.selectOptions(within(dialog).getByLabelText('Data class'), 'terminated_participant')
    await user.selectOptions(within(dialog).getByLabelText('Market'), 'm1')
    await user.type(within(dialog).getByLabelText('Keep for (days)'), '365')
    await user.type(within(dialog).getByLabelText('Legal basis'), 'Commercial code art. 5')
    await user.click(within(dialog).getByRole('button', { name: 'Propose schedule' }))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/retention/schedules')[0]!
    expect(bodyOf(init)).toMatchObject({ data_class: 'terminated_participant', market_id: 'm1', retain_days: 365, basis: 'Commercial code art. 5' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()

    await user.click(await screen.findByRole('button', { name: 'Approve Terminated members BE' }))
    const decide = screen.getByRole('dialog', { name: 'Approve the terminated members schedule' })
    await user.click(within(decide).getByRole('button', { name: 'Approve schedule' }))
    expect(await within(decide).findByText(/Someone other than the proposer must decide/)).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/retention/schedules/s1/decision')[0]![1])).toEqual({ decision: 'approve' })
  })

  it('says when the markets cannot be read and offers no proposal then', async () => {
    navigation.search = 'tab=retention'
    renderAs(DPO, <PrivacyRequestsPage />, fetchByRoute({
      'GET /v1/retention/schedules': () => ok([]),
      'GET /v1/retention/runs': () => ok([]),
      'GET /v1/markets': () => apiError(503, 'SERVICE_UNAVAILABLE', 'Try again later.'),
    }))
    expect(await screen.findByText(/^Markets could not be loaded, so no schedule can be proposed\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Propose schedule' })).toBeNull()
  })

  it('previews what is due and held, linking each sampled member', async () => {
    navigation.search = 'tab=retention'
    const user = userEvent.setup()
    renderAs(DPO, <PrivacyRequestsPage />, fetchByRoute({
      'GET /v1/retention/schedules': () => ok([schedule({ state: 'approved', in_force: true })]),
      'GET /v1/retention/runs': () => ok([]),
      'GET /v1/markets': () => ok([MARKET]),
      'GET /v1/retention/schedules/s1/preview': () => ok({ due: 1, held: 1, sample: [{ object_type: 'participant', object_id: 'p1', ref: 'BE-R1' }] }),
    }))
    await user.click(await screen.findByRole('button', { name: 'Preview Terminated members BE' }))
    const preview = await screen.findByTestId('retention-preview')
    expect(within(preview).getByRole('link', { name: 'BE-R1' }).getAttribute('href')).toBe('/people/p1')
    expect(within(preview).getByText('Skipped: legal hold')).toBeTruthy()
    expect(screen.getByText('No retention run yet')).toBeTruthy()
  })
})

describe('SC-15 legal holds tab (D-V1A-08)', () => {
  it('opens for legal_hold.manage alone and shows the refusal when the placer releases', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/legal-holds': () => ok([hold({ placed_by: { id: COMPLIANCE.user.id, display_name: 'Ada Admin' } }), hold({ id: 'h2', released_at: '2026-11-21T09:00:00.000Z', released_by: OTHER })]),
      'POST /v1/legal-holds/h1/release': () => apiError(422, 'SOD_SELF_APPROVAL', 'Someone other than the person who placed it must release this hold.'),
    })
    renderAs(COMPLIANCE, <PrivacyRequestsPage />, fetchMock)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Legal holds'])
    expect(await screen.findByText(/^1 active hold\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record a request' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Release the hold on BE-R2' }))
    const dialog = screen.getByRole('dialog', { name: 'Release the hold on BE-R2' })
    await user.click(within(dialog).getByRole('button', { name: 'Release hold' }))
    expect(await within(dialog).findByText(/must release this hold/)).toBeTruthy()
  })

  it('places a hold on a chosen member with an Idempotency-Key; read-only hides place and release', async () => {
    navigation.search = 'tab=holds'
    const user = userEvent.setup()
    const fetchMock = fetchByRoute({
      'GET /v1/legal-holds': () => ok([]),
      'GET /v1/participants': () => ok([{ id: 'p3', external_ref: 'BE-C', display_name: 'Cleo', market: { id: 'm1', code: 'BE' }, current_type: null, status: 'active' }]),
      'POST /v1/legal-holds': () => ok(hold({ id: 'h3' }), 201),
    })
    const view = renderAs(DPO, <PrivacyRequestsPage />, fetchMock)
    expect(await screen.findByText('No legal hold')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Place hold' }))
    const dialog = screen.getByRole('dialog', { name: 'Place a legal hold' })
    await user.type(within(dialog).getByLabelText('Member'), 'BE-C')
    await user.click(within(dialog).getByRole('button', { name: 'Search member' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Choose BE-C · Cleo' }))
    await user.type(within(dialog).getByLabelText('Reason'), 'Claim filed')
    await user.click(within(dialog).getByRole('button', { name: 'Place hold' }))
    const [, init] = callsTo(fetchMock, 'POST', '/v1/legal-holds')[0]!
    expect(bodyOf(init)).toEqual({ participant_id: 'p3', reason: 'Claim filed' })
    expect(headerOf(init, 'Idempotency-Key')).toBeTruthy()
    view.unmount()

    renderAs(adminMe({ ...DPO, tenant: { ...DPO.tenant!, read_only: true } }), <PrivacyRequestsPage />, fetchByRoute({ 'GET /v1/legal-holds': () => ok([hold()]) }))
    expect(await screen.findByText('Pending court claim')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Place hold' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull()
  })
})

describe('V1-A privacy words', () => {
  it('names the new export sections and the legal-hold and credit deferrals', () => {
    expect(privacyItemLabel('tax_lines')).toBe('Tax lines (withholding per run)')
    expect(privacyItemLabel('tax_forms')).toBe('Year-end tax statements')
    expect(privacyItemLabel('account_holders')).toBe('Account holders')
    expect(privacyItemLabel('credit_awards')).toBe('Non-cash reward awards')
    expect(privacyItemLabel('credit_redemptions')).toBe('Non-cash reward redemptions')
    expect(blockerText({ reason: 'legal_hold', hold_id: 'h1' }, [])).toBe('A legal hold is active on the member.')
    expect(blockerText({ reason: 'credits_outstanding', market_id: 'm1', credit_type_id: 'c1', amount_minor: '900' }, [MARKET as never]))
      .toMatch(/^.*9\.00.* of unexpired non-cash rewards is still owed to the member in BE\.$/)
  })
})
