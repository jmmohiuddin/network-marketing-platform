// @vitest-environment jsdom
import '../../test/dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf } from '../admin/test-support'
import { MorePage } from './more'
import { MyDataPage } from './my-data'
import { NotificationsPage } from './notifications'
import { PaymentDetailsPage } from './payment-details'
import { page, portalMe, renderPortal, RUN } from './test-support'

const leave = vi.hoisted(() => vi.fn())
vi.mock('../../lib/leave-page', () => ({ leavePage: leave }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/portal/more', useSearchParams: () => new URLSearchParams() }))

const FUTURE = new Date(Date.now() + 72 * 3600_000).toISOString()
const BANK = {
  current: { masked: 'DE•• 3000', scheme: 'iban', created_via: 'self', created_at: '2026-09-01T10:00:00.000Z', cooling_off_until: FUTURE },
  pending_review: null,
  history: [{ masked: 'DE•• 1111', created_via: 'staff', created_at: '2026-01-01T10:00:00.000Z', superseded_at: '2026-09-01T10:00:00.000Z' }],
  owed: [{ market_code: 'DE', currency: 'EUR', minor_unit: 2, payable_minor: '500' }],
}
const TAX = { current: { id: 't1', residency: 'DE', entity_type: 'individual', tax_id_masked: '•••• 6789', valid_from: '2026-09-01T10:00:00.000Z', valid_to: null }, history: [] }

function paymentRoutes(put: () => Response) {
  return fetchByRoute({
    'GET /v1/me/bank-details': () => ok(BANK),
    'GET /v1/me/tax-profile': () => ok(TAX),
    'POST /v1/auth/sessions/current/reauth': () => ok({ step_up_at: new Date().toISOString() }),
    'PUT /v1/me/bank-details': put,
    'PUT /v1/me/tax-profile': () => ok(TAX.current, 201),
  })
}

async function enterIban(iban: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Change bank details' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.change(screen.getByLabelText('Account holder'), { target: { value: 'Carla Example' } })
  fireEvent.change(screen.getByLabelText('IBAN'), { target: { value: iban } })
  fireEvent.click(screen.getByRole('button', { name: 'Save bank details' }))
}

describe('SC-22 payment details and tax profile', () => {
  it('shows the masked account, the cooling-off banner with the amount waiting, the tax card and earlier versions', async () => {
    renderPortal(<PaymentDetailsPage />, paymentRoutes(() => ok({})))
    expect(await screen.findByText('DE•• 3000')).toBeTruthy()
    expect(screen.getByText(/Cooling off until/)).toBeTruthy()
    expect(screen.getByText(/5.00 EUR waits/)).toBeTruthy()
    expect(await screen.findByText('•••• 6789')).toBeTruthy()
    expect(screen.getByText('Account DE•• 1111')).toBeTruthy()
  })

  it('refuses a wrong IBAN checksum inline without asking for the password', async () => {
    const fetchMock = paymentRoutes(() => ok({}))
    renderPortal(<PaymentDetailsPage />, fetchMock)
    await enterIban('DE00 3704 0044 0532 0130 00')
    expect(screen.getByText('Enter a valid IBAN: its check digits do not match.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(callsTo(fetchMock, 'PUT', '/v1/me/bank-details')).toHaveLength(0)
  })

  it('asks for the password, then saves the new details once with an Idempotency-Key', async () => {
    const fetchMock = paymentRoutes(() => ok({ state: 'pending_cooling_off', until: FUTURE }, 201))
    renderPortal(<PaymentDetailsPage />, fetchMock)
    await enterIban('DE89 3704 0044 0532 0130 00')
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'correct horse battery' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/me/bank-details')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/auth/sessions/current/reauth')[0]![1])).toEqual({ password: 'correct horse battery' })
    const [, init] = callsTo(fetchMock, 'PUT', '/v1/me/bank-details')[0]!
    expect(bodyOf(init)).toEqual({ scheme: 'iban', account_holder: 'Carla Example', iban: 'DE89370400440532013000' })
    expect(headerOf(init, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await screen.findByText(/New bank details saved/)).toBeTruthy()
  })

  it('says a wrong password and saves nothing on cancel', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/me/bank-details': () => ok(BANK),
      'GET /v1/me/tax-profile': () => ok(TAX),
      'POST /v1/auth/sessions/current/reauth': () => apiError(401, 'INVALID_CREDENTIALS', 'The password is not correct.'),
    })
    renderPortal(<PaymentDetailsPage />, fetchMock)
    await enterIban('DE89 3704 0044 0532 0130 00')
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    expect(await within(dialog).findByText('The password is not correct.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(callsTo(fetchMock, 'PUT', '/v1/me/bank-details')).toHaveLength(0)
  })

  it('shows the review banner when the account needs a review', async () => {
    let reviewed = false
    renderPortal(<PaymentDetailsPage />, fetchByRoute({
      'GET /v1/me/bank-details': () => ok({ ...BANK, pending_review: reviewed ? { case_id: 'c1', created_at: FUTURE } : null }),
      'GET /v1/me/tax-profile': () => ok(TAX),
      'POST /v1/auth/sessions/current/reauth': () => ok({ step_up_at: new Date().toISOString() }),
      'PUT /v1/me/bank-details': () => {
        reviewed = true
        return ok({ state: 'review_required', case_id: 'c1' }, 202)
      },
    }))
    await enterIban('DE89 3704 0044 0532 0130 00')
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('A change to your bank details is being reviewed')).toBeTruthy()
    // The pending case may be a company-opened change: no claim that another member shares the account.
    expect(screen.queryByText(/another member/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change bank details' })).toBeNull()
  })

  it('says there is nothing to change without asking for the password or saving', async () => {
    const fetchMock = paymentRoutes(() => ok({}))
    renderPortal(<PaymentDetailsPage />, fetchMock)
    fireEvent.click(await screen.findByRole('button', { name: 'Change tax profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save tax profile' }))
    expect(await screen.findByText('Nothing to change. Change at least one field.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Confirm it is you' })).toBeNull()
    expect(callsTo(fetchMock, 'PUT', '/v1/me/tax-profile')).toHaveLength(0)
  })

  it('saves the tax profile with residency, entity type and tax id after re-authentication', async () => {
    const fetchMock = paymentRoutes(() => ok({}))
    renderPortal(<PaymentDetailsPage />, fetchMock)
    fireEvent.click(await screen.findByRole('button', { name: 'Change tax profile' }))
    fireEvent.change(screen.getByLabelText(/^Tax id/), { target: { value: 'de123456789' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tax profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/me/tax-profile')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/me/tax-profile')[0]![1])).toEqual({ residency: 'DE', entity_type: 'individual', tax_id: 'DE123456789' })
  })
})

describe('SC-38 notifications and profile', () => {
  const notice = { id: 'n1', template: 'statement.ready', topic: 'statement', mandatory: false, created_at: '2026-09-02T08:00:00.000Z', read_at: null,
    params: { run_id: RUN, starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z', net_minor: '2300', currency: 'EUR', minor_unit: 2 } }

  it('shows inbox cards with their link and marks one and all read', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/me/notifications': () => page([notice]),
      'POST /v1/me/notifications/n1/read': () => ok({ ...notice, read_at: notice.created_at }),
      'POST /v1/me/notifications/read-all': () => ok({ updated: 0 }),
    })
    renderPortal(<NotificationsPage />, fetchMock, portalMe(), 1)
    expect(await screen.findByText('Statement ready')).toBeTruthy()
    expect(screen.getByText(/is ready. Net 23.00 EUR./)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Open statement/ }).getAttribute('href')).toBe(`/portal/earnings/${RUN}`)
    fireEvent.click(screen.getByRole('button', { name: 'Mark read: Statement ready' }))
    expect(await screen.findByText('Read')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/me/notifications/read-all')).toHaveLength(1))
  })

  it('switches statement email off at once and shows security notices locked', async () => {
    const prefs = [
      { topic: 'statement', email: true, mandatory: false }, { topic: 'payout', email: true, mandatory: false }, { topic: 'dispute', email: true, mandatory: false },
      { topic: 'security', mandatory: true }, { topic: 'privacy', mandatory: true }, { topic: 'plan_change', mandatory: true },
    ]
    const fetchMock = fetchByRoute({
      'GET /v1/me/notifications': () => page([]),
      'GET /v1/me/notification-preferences': () => ok(prefs),
      'PUT /v1/me/notification-preferences': () => ok(prefs.map((p) => (p.topic === 'statement' ? { ...p, email: false } : p))),
    })
    renderPortal(<NotificationsPage />, fetchMock)
    fireEvent.click(await screen.findByRole('radio', { name: 'Channels' }))
    const statements = await screen.findByRole('switch', { name: 'Statements' })
    fireEvent.click(statements)
    await waitFor(() => expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/me/notification-preferences')[0]![1])).toEqual({ topic: 'statement', email: false }))
    expect((screen.getByRole('switch', { name: 'Security' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('offers two-step sign-in and signs out to the portal sign-in of the company', async () => {
    renderPortal(<NotificationsPage />, fetchByRoute({
      'GET /v1/me/notifications': () => page([]),
      'DELETE /v1/auth/sessions/current': () => new Response(null, { status: 204 }),
    }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Profile' }))
    expect(screen.getByRole('link', { name: /Turn on two-step sign-in/ }).getAttribute('href')).toBe('/signin/enrol?next=/portal/more')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(leave).toHaveBeenCalledWith('/portal/signin?tenant=acme&reason=signed_out'))
  })
})

describe('More', () => {
  it('lists Customers only when Team replaced it in the bottom bar', () => {
    renderPortal(<MorePage />, fetchByRoute({}), portalMe({}, true))
    expect(screen.getByRole('link', { name: /Customers/ }).getAttribute('href')).toBe('/portal/customers')
    expect(screen.getByRole('link', { name: /My data/ })).toBeTruthy()
  })
})

describe('My data', () => {
  const requests = [
    { id: 'r1', type: 'access', state: 'fulfilled', due_at: null, retention_basis: null, closed_at: '2026-09-10T10:00:00.000Z' },
    { id: 'r2', type: 'erasure', state: 'in_progress', due_at: '2026-10-10T10:00:00.000Z', retention_basis: 'Tax records for 10 years', closed_at: null, deferred_reasons: [{ reason: 'open_payable' }] },
  ]

  it('lists requests with deferral reasons, what is kept and the export download', async () => {
    renderPortal(<MyDataPage />, fetchByRoute({ 'GET /v1/me/privacy-requests': () => ok(requests) }))
    expect(await screen.findByText('Money is still owed to you.')).toBeTruthy()
    expect(screen.getByText('Kept by the company because: Tax records for 10 years')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download your data' })).toBeTruthy()
  })

  it('asks erasure to confirm what is kept and to re-authenticate before sending', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/me/privacy-requests': () => ok([]),
      'POST /v1/auth/sessions/current/reauth': () => ok({ step_up_at: new Date().toISOString() }),
      'POST /v1/me/privacy-requests': () => ok({ id: 'r3', state: 'in_progress', due_at: null }, 201),
    })
    renderPortal(<MyDataPage />, fetchMock)
    fireEvent.click(await screen.findByRole('radio', { name: /Erase my data/ }))
    expect(screen.getByText(/Kept, because the law/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(screen.getByText('Confirm that you have read what is erased and what is kept.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('I have read what is erased and what is kept.'))
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it is you' })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/v1/me/privacy-requests')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'POST', '/v1/me/privacy-requests')[0]![1])).toEqual({ type: 'erasure' })
  })

  it('needs details for a correction and shows an open request refusal', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/me/privacy-requests': () => ok([]),
      'POST /v1/me/privacy-requests': () => apiError(409, 'REQUEST_OPEN', 'You already have an open request of this type.'),
    })
    renderPortal(<MyDataPage />, fetchMock)
    fireEvent.click(await screen.findByRole('radio', { name: /Correct my data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(screen.getByText('Say what should be corrected.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'My name is spelled wrong.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByText('You already have an open request of this type.')).toBeTruthy()
  })
})
