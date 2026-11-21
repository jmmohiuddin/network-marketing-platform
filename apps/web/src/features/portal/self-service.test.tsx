// @vitest-environment jsdom
import '../../test/dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { apiError, ok } from '../../test/fetch'
import { bodyOf, callsTo, fetchByRoute, headerOf } from '../admin/test-support'
import { LanguagePage } from './language'
import { MorePage } from './more'
import { MyDataPage } from './my-data'
import { NotificationsPage } from './notifications'
import { PaymentDetailsPage } from './payment-details'
import { useReauth } from './reauth'
import { TaxStatementsPage } from './tax-statements'
import { page, portalMe, renderPortal, renderServer, RUN, serverRoutes } from './test-support'

const leave = vi.hoisted(() => vi.fn())
vi.mock('../../lib/leave-page', () => ({ leavePage: leave }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/portal/more', useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => { throw new Error(`redirect ${path}`) },
}))
vi.mock('next/headers', async () => ({ headers: async () => (await import('./test-support')).requestHeaders.current }))

const FUTURE = new Date(Date.now() + 72 * 3600_000).toISOString()
const BANK = {
  current: { masked: 'DE•• 3000', scheme: 'iban', created_via: 'self', created_at: '2026-09-01T10:00:00.000Z', cooling_off_until: FUTURE },
  pending_review: null,
  history: [{ masked: 'DE•• 1111', created_via: 'staff', created_at: '2026-01-01T10:00:00.000Z', superseded_at: '2026-09-01T10:00:00.000Z' }],
  owed: [{ market_code: 'DE', currency: 'EUR', minor_unit: 2, payable_minor: '500' }],
}
const TAX = { current: { id: 't1', residency: 'DE', entity_type: 'individual', tax_id_masked: '•••• 6789', valid_from: '2026-09-01T10:00:00.000Z', valid_to: null }, history: [], format: null }

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

function ReauthHarness() {
  const reauth = useReauth()
  return <><button type="button" onClick={() => void reauth.confirm()}>open</button>{reauth.dialog}</>
}

describe('portal re-authentication in the effective locale (shared step-up words)', () => {
  it('asks for the password in German and words a wrong one by code', async () => {
    renderPortal(<ReauthHarness />, fetchByRoute({
      'POST /v1/auth/sessions/current/reauth': () => apiError(401, 'INVALID_CREDENTIALS', 'The password is not correct.'),
    }), portalMe({ locale: 'de' }))
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const dialog = await screen.findByRole('dialog', { name: 'Bestätigen Sie, dass Sie es sind' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen und weiter' }))
    expect(within(dialog).getByText('Geben Sie Ihr Passwort ein.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'wrong' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen und weiter' }))
    expect(await within(dialog).findByText('Das Passwort ist nicht richtig.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Dialog schließen' })).toBeTruthy()
  })

  it('asks an authenticator user for a code in German, without the set-up offer', async () => {
    renderPortal(<ReauthHarness />, fetchByRoute({
      'POST /v1/auth/sessions/current/step-up': () => apiError(422, 'MFA_CODE_INVALID', 'The code is not correct.'),
    }), portalMe({ locale: 'de', mfa: { required: false, enrolled: true, verified: true } }))
    fireEvent.click(screen.getByRole('button', { name: 'open' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mit Ihrer Authenticator-App bestätigen' })
    expect(within(dialog).queryByRole('button', { name: 'Set one up now' })).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Bestätigungscode'), { target: { value: '12' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen und weiter' }))
    expect(within(dialog).getByText('Der Code hat 6 Ziffern.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Bestätigungscode'), { target: { value: '123456' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen und weiter' }))
    expect(await within(dialog).findByText('Dieser Code ist nicht richtig. Geben Sie den Code ein, den Ihre App jetzt anzeigt.')).toBeTruthy()
  })
})

describe('SC-22 payment details and tax profile', () => {
  it('shows the masked account, the cooling-off banner with the amount waiting, the tax card and earlier versions', async () => {
    renderPortal(<PaymentDetailsPage />, paymentRoutes(() => ok({})))
    expect(await screen.findByText('DE•• 3000')).toBeTruthy()
    expect(screen.getByText(/Cooling off until/)).toBeTruthy()
    expect(screen.getByText(/€5.00 waits/)).toBeTruthy()
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

  it('names the pack format under the tax id and words TAX_ID_FORMAT with its label (SC-22)', async () => {
    const fetchMock = fetchByRoute({
      'GET /v1/me/bank-details': () => ok(BANK),
      'GET /v1/me/tax-profile': () => ok({ ...TAX, format: { label: 'FX tax id: 2 letters, 6 digits', pattern: '^[A-Z]{2}[0-9]{6}$' } }),
      'POST /v1/auth/sessions/current/reauth': () => ok({ step_up_at: new Date().toISOString() }),
      'PUT /v1/me/tax-profile': () => apiError(422, 'TAX_ID_FORMAT', 'API words', { label: 'FX tax id: 2 letters, 6 digits' }),
    })
    renderPortal(<PaymentDetailsPage />, fetchMock, portalMe({ locale: 'de' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Steuerprofil ändern' }))
    expect(screen.getByText(/^Format: FX tax id: 2 letters, 6 digits\./)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Steuernummer/), { target: { value: 'ab1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Steuerprofil speichern' }))
    const dialog = await screen.findByRole('dialog', { name: 'Bestätigen Sie, dass Sie es sind' })
    fireEvent.change(within(dialog).getByLabelText('Passwort'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen und weiter' }))
    expect(await screen.findByText('Das entspricht nicht dem Format FX tax id: 2 letters, 6 digits.')).toBeTruthy()
    expect(screen.queryByText('API words')).toBeNull()
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
    expect(screen.getByText(/is ready. Net €23.00./)).toBeTruthy()
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

const FORM = {
  id: 'f1', tax_year: 2026, form_type: 'FX-1', title: 'Annual withholding statement', version: 2, currency: 'EUR',
  totals: { gross_minor: '2300', taxable_minor: '2300', withheld_minor: '480' }, created_at: '2027-01-10T10:00:00.000Z',
}

describe('More (server-rendered)', () => {
  it('lists Customers only when Team replaced it in the bottom bar, Language always, Tax statements only with a form', async () => {
    await renderServer(() => MorePage(), serverRoutes({ 'GET /v1/me/tax-forms': () => ok([]) }, portalMe({}, true)), portalMe({}, true))
    expect(screen.getByRole('link', { name: /Customers/ }).getAttribute('href')).toBe('/portal/customers')
    expect(screen.getByRole('link', { name: /My data/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Language/ }).getAttribute('href')).toBe('/portal/more/language')
    expect(screen.queryByRole('link', { name: /Tax statements/ })).toBeNull()
    await renderServer(() => MorePage(), serverRoutes({ 'GET /v1/me/tax-forms': () => ok([FORM]) }, portalMe({ locale: 'de' })), portalMe({ locale: 'de' }))
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Steuerübersichten/ }).getAttribute('href')).toBe('/portal/more/tax-statements')
    expect(screen.getByRole('link', { name: /Sprache/ })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Kunden/ })).toBeNull()
  })

  it('keeps Tax statements when the forms read fails, so the page can show the failure and Try again', async () => {
    await renderServer(() => MorePage(), serverRoutes({ 'GET /v1/me/tax-forms': () => apiError(503, 'SERVICE_UNAVAILABLE', 'down') }))
    expect(screen.getByRole('link', { name: /Tax statements/ }).getAttribute('href')).toBe('/portal/more/tax-statements')
  })
})

describe('tax statements (server-rendered)', () => {
  it('lists each year-end statement with its totals and a CSV download link that needs no script', async () => {
    const container = await renderServer(() => TaxStatementsPage(), serverRoutes({ 'GET /v1/me/tax-forms': () => ok([FORM]) }, portalMe({ locale: 'de' })))
    expect(screen.getByText('Steuerjahr 2026')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Annual withholding statement' })).toBeTruthy()
    expect(screen.getByText('FX-1 · Version 2')).toBeTruthy()
    expect(screen.getByText('23,00 €')).toBeTruthy()
    expect(screen.getByText('4,80 €')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'CSV herunterladen' })
    expect([link.getAttribute('href'), link.hasAttribute('download')]).toEqual(['/v1/me/tax-forms/f1/download', true])
    expect(container.textContent).not.toMatch(/W-9|1099|filed|certified|eingereicht|zertifiziert/i)
  })

  it('says when there is none yet', async () => {
    await renderServer(() => TaxStatementsPage(), serverRoutes({ 'GET /v1/me/tax-forms': () => ok([]) }))
    expect(screen.getByText('No tax statement yet')).toBeTruthy()
  })
})

describe('language (SC-38 view 3)', () => {
  it('lists the offered locales by endonym with the current one selected, saves the choice and renders again', async () => {
    const fetchMock = fetchByRoute({ 'PUT /v1/me/locale': () => ok({ locale: 'de' }) })
    renderPortal(<LanguagePage />, fetchMock)
    const english = screen.getByRole('radio', { name: /English/ }) as HTMLInputElement
    const german = screen.getByRole('radio', { name: /Deutsch/ }) as HTMLInputElement
    expect([english.checked, german.checked]).toEqual([true, false])
    expect(screen.getByText('German')).toBeTruthy()
    fireEvent.click(german)
    fireEvent.click(screen.getByRole('button', { name: 'Save language' }))
    expect(await screen.findByText('Saved. The portal now uses this language.')).toBeTruthy()
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/me/locale')[0]![1])).toEqual({ locale: 'de' })
    // Formats follow the language: no currency or date-format choice.
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('saves the shown language too: it may come from the browser with nothing saved, and e-mails follow only a saved one', async () => {
    const fetchMock = fetchByRoute({ 'PUT /v1/me/locale': () => ok({ locale: 'de' }) })
    renderPortal(<LanguagePage />, fetchMock, portalMe({ locale: 'de' }))
    expect((screen.getByRole('radio', { name: /Deutsch/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sprache speichern' }))
    await waitFor(() => expect(callsTo(fetchMock, 'PUT', '/v1/me/locale')).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, 'PUT', '/v1/me/locale')[0]![1])).toEqual({ locale: 'de' })
  })

  it('says a language the market does not offer by code, not the API message', async () => {
    renderPortal(<LanguagePage />, fetchByRoute({ 'PUT /v1/me/locale': () => apiError(422, 'LOCALE_NOT_OFFERED', 'API words') }))
    fireEvent.click(screen.getByRole('radio', { name: /Deutsch/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save language' }))
    expect(await screen.findByText('This language is not offered in your market.')).toBeTruthy()
    expect(screen.queryByText('API words')).toBeNull()
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
    expect(await screen.findByText('A request of this kind is already in progress.')).toBeTruthy()
  })
})

describe('read-only tenant (D-V1A-07): write controls hidden, the data-subject request form stays (C-V1A-18)', () => {
  const readOnly = portalMe({ tenant: { slug: 'acme', legal_name: 'Acme Ltd', read_only: true } })
  const notice = { id: 'n1', template: 'statement.ready', topic: 'statement', mandatory: false, created_at: '2026-09-02T08:00:00.000Z', read_at: null,
    params: { run_id: RUN, starts_at: '2026-08-01T00:00:00.000Z', ends_at: '2026-09-01T00:00:00.000Z', net_minor: '2300', currency: 'EUR', minor_unit: 2 } }

  it('hides payment, tax, language and notification changes', async () => {
    const payment = renderPortal(<PaymentDetailsPage />, paymentRoutes(() => ok({})), readOnly)
    expect(await screen.findByText('DE•• 3000')).toBeTruthy()
    expect(await screen.findByText('•••• 6789')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Change bank details' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change tax profile' })).toBeNull()
    payment.unmount()
    const language = renderPortal(<LanguagePage />, fetchByRoute({}), readOnly)
    expect((screen.getByRole('radio', { name: /English/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save language' })).toBeNull()
    language.unmount()
    renderPortal(<NotificationsPage />, fetchByRoute({
      'GET /v1/me/notifications': () => page([notice]),
      'GET /v1/me/notification-preferences': () => ok([{ topic: 'statement', email: true, mandatory: false }]),
    }), readOnly, 1)
    expect(await screen.findByText('Statement ready')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark read: Statement ready' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Channels' }))
    expect((await screen.findByRole('switch', { name: 'Statements' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('keeps the data-subject request form', async () => {
    renderPortal(<MyDataPage />, fetchByRoute({ 'GET /v1/me/privacy-requests': () => ok([]) }), readOnly)
    expect(await screen.findByRole('button', { name: 'Send request' })).toBeTruthy()
  })
})
