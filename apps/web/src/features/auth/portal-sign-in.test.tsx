// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning, noContent, ok, requestBody, type FetchMock } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import type { ReactElement } from 'react'
import PortalSignInPage from '../../app/(card)/portal/signin/page'
import { isAuthPage } from '../../lib/navigation'
import { adminMe } from '../admin/test-support'
import { InvitationForm } from './invitation-form'
import { MfaEnrolment, MfaVerification } from './mfa'
import { PortalCode } from './portal-code'
import { PortalSignIn, portalTarget, readPendingCode, savePendingCode } from './portal-sign-in'

const navigation = vi.hoisted(() => ({ search: '', leavePage: vi.fn(), router: { replace: vi.fn(), push: vi.fn() } }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.search), useRouter: () => navigation.router }))
vi.mock('../../lib/leave-page', () => ({ leavePage: navigation.leavePage }))

const SESSION = { expires_at: '2026-11-19T20:00:00Z', next_step: 'none' }
const CODE_REFUSED = 'The code is not valid or has expired. Request a new code.'

beforeEach(() => {
  navigation.search = 'tenant=acme'
  navigation.leavePage.mockClear()
  navigation.router.push.mockClear()
  savePendingCode(null)
})

describe('portal paths', () => {
  it('continues only to portal pages, never to its sign-in pages or elsewhere', () => {
    expect(portalTarget('/portal/earnings?x=1')).toBe('/portal/earnings?x=1')
    expect(portalTarget('/portal/signin/code')).toBe('/portal')
    expect(portalTarget('/portalx')).toBe('/portal')
    expect(portalTarget('/portal/rank')).toBe('/portal/rank')
    expect(portalTarget('/periods')).toBe('/portal')
    expect(portalTarget('//evil.example/portal')).toBe('/portal')
    expect(portalTarget(null)).toBe('/portal')
  })
})

describe('PortalSignIn (SC-27)', () => {
  it('emails a code by default and opens the code step without the email in the address', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok({ accepted: true }, 202))
    renderWithProviders(<PortalSignIn firebase={false} />, fetchMock)
    expect((screen.getByLabelText('Company') as HTMLInputElement).readOnly).toBe(true)
    expect(screen.queryByLabelText('Password')).toBeNull()
    await user.type(screen.getByLabelText('Email address'), 'de-b@example.test')
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith('/portal/signin/code?tenant=acme'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/portal-codes')
    expect(requestBody(fetchMock)).toEqual({ tenant: 'acme', email: 'de-b@example.test' })
    expect(readPendingCode()).toEqual({ tenant: 'acme', email: 'de-b@example.test' })
  })

  it('signs in with the password and follows the MFA step back to the portal', async () => {
    const user = userEvent.setup()
    navigation.search = `tenant=acme&next=${encodeURIComponent('/portal/rank')}`
    const fetchMock = fetchReturning(ok({ ...SESSION, next_step: 'mfa_verification' }, 201))
    renderWithProviders(<PortalSignIn firebase={false} />, fetchMock)
    await user.click(screen.getByRole('button', { name: 'Use password' }))
    await user.type(screen.getByLabelText('Email address'), 'de-a@example.test')
    await user.type(screen.getByLabelText('Password'), 'a long enough secret')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith(`/signin/mfa?next=${encodeURIComponent('/portal/rank')}`))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/portal-sessions')
    expect(requestBody(fetchMock)).toEqual({ tenant: 'acme', email: 'de-a@example.test', password: 'a long enough secret' })
  })

  it('asks for the company without a ?tenant=, and shows the generic and the locked refusals', async () => {
    const user = userEvent.setup()
    navigation.search = 'method=password'
    renderWithProviders(<PortalSignIn firebase={false} />, fetchReturning(
      apiError(401, 'INVALID_CREDENTIALS', 'The email or password is not correct.'),
      apiError(429, 'SIGN_IN_LOCKED', 'Too many failed sign-in attempts. Try again later.'),
    ))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getAllByText('Enter your company sign-in name.').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText('Company'), 'acme')
    await user.type(screen.getByLabelText('Email address'), 'de-c@example.test')
    await user.type(screen.getByLabelText('Password'), 'wrong password here')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('The email or password is not correct.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Too many failed sign-in attempts. Try again later.')).toBeTruthy()
    expect(navigation.leavePage).not.toHaveBeenCalled()
  })
})

describe('PortalCode (SC-27 code step)', () => {
  it('signs in with the emailed code', async () => {
    const user = userEvent.setup()
    savePendingCode({ tenant: 'acme', email: 'de-b@example.test' })
    const fetchMock = fetchReturning(ok(SESSION, 201))
    renderWithProviders(<PortalCode />, fetchMock)
    expect(await screen.findByText(/If a portal account uses de-b@example.test/)).toBeTruthy()
    await user.type(screen.getByLabelText('Sign-in code'), '123 456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/portal'))
    expect(requestBody(fetchMock)).toEqual({ tenant: 'acme', email: 'de-b@example.test', code: '123456' })
    expect(readPendingCode()).toBeNull()
  })

  it('shows the same refusal for a wrong or used code and can send a new one', async () => {
    const user = userEvent.setup()
    savePendingCode({ tenant: 'acme', email: 'de-b@example.test' })
    const fetchMock = fetchReturning(apiError(401, 'INVALID_CREDENTIALS', CODE_REFUSED), ok({ accepted: true }, 202))
    renderWithProviders(<PortalCode />, fetchMock)
    await user.type(await screen.findByLabelText('Sign-in code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(CODE_REFUSED)).toBeTruthy()
    expect(screen.getByLabelText('Sign-in code').getAttribute('aria-invalid')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Send a new code' }))
    expect(await screen.findByText('A new code is on its way. Earlier codes no longer work.')).toBeTruthy()
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/portal-codes')
    expect(screen.getByRole('link', { name: 'Use password' }).getAttribute('href')).toBe('/portal/signin?tenant=acme&method=password')
  })

  it('sends one new code per click while a request is in flight', async () => {
    const user = userEvent.setup()
    savePendingCode({ tenant: 'acme', email: 'de-b@example.test' })
    let answer: (response: Response) => void = () => undefined
    const fetchMock: FetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve }))
    renderWithProviders(<PortalCode />, fetchMock)
    const resend = await screen.findByRole('button', { name: 'Send a new code' })
    await user.dblClick(resend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    answer(ok({ accepted: true }, 202))
    expect(await screen.findByText('A new code is on its way. Earlier codes no longer work.')).toBeTruthy()
  })

  it('does not continue a code started for another company', async () => {
    savePendingCode({ tenant: 'other', email: 'de-b@example.test' })
    renderWithProviders(<PortalCode />, fetchReturning())
    expect(await screen.findByRole('heading', { name: 'Start the sign-in again' })).toBeTruthy()
  })

  it('asks to start again when the first step is not in this tab', async () => {
    renderWithProviders(<PortalCode />, fetchReturning())
    expect((await screen.findByRole('link', { name: 'Back to sign-in' })).getAttribute('href')).toBe('/portal/signin?tenant=acme')
  })
})

describe('portal invitation and optional MFA', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('leads a portal invitation to the portal sign-in with the password form', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/invitation?tenant=acme&realm=portal#token=tok_1')
    renderWithProviders(<InvitationForm />, fetchReturning(noContent()))
    expect(await screen.findByText(/invited to sign in to your distributor portal/)).toBeTruthy()
    await user.type(screen.getByLabelText('New password'), 'a long enough passphrase')
    await user.type(screen.getByLabelText('Repeat the password'), 'a long enough passphrase')
    await user.click(screen.getByRole('button', { name: 'Set password' }))
    // PLAN §5 SC-27: straight to the portal sign-in (a full load), no outcome card.
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/portal/signin?tenant=acme&method=password'))
    expect(screen.queryByRole('link', { name: 'Go to sign-in' })).toBeNull()
  })

  it('offers "Not now" on the optional portal enrolment, back to the portal page', () => {
    navigation.search = `next=${encodeURIComponent('/portal/more')}`
    renderWithProviders(<MfaEnrolment />, fetchReturning())
    expect(screen.getByText(/Protect your portal account with a second factor/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('leaves the optional enrolment with a full page load, so the portal page runs under its own CSP', async () => {
    navigation.search = `next=${encodeURIComponent('/portal/more')}`
    renderWithProviders(<MfaEnrolment />, fetchReturning())
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(navigation.leavePage).toHaveBeenCalledWith('/portal/more')
  })

  it('signs a member out of the MFA step to the portal sign-in of their company, not the staff sign-in', async () => {
    navigation.search = `next=${encodeURIComponent('/portal/earnings')}`
    const fetchMock = fetchReturning(ok(adminMe()), noContent())
    renderWithProviders(<MfaVerification />, fetchMock)
    expect(await screen.findByText('ada@acme.example')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/portal/signin?tenant=acme&reason=signed_out'))
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })
})

describe('portal sign-in page', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('offers Firebase when configured: /portal/signin is an auth page, where proxy.ts allows its sources', () => {
    vi.stubEnv('FIREBASE_AUTH_DOMAIN', 'nmp-staging.firebaseapp.com')
    const page = PortalSignInPage() as ReactElement<{ children: ReactElement<{ firebase: boolean }> }>
    expect(isAuthPage('/portal/signin')).toBe(true)
    expect(page.props.children.props.firebase).toBe(true)
  })
})
