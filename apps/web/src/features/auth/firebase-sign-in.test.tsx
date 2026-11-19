// @vitest-environment jsdom
import '../../test/dom'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, fetchReturning, ok, requestBody } from '../../test/fetch'
import { renderWithProviders } from '../../test/render'
import { SignInForm } from './sign-in-form'

const navigation = vi.hoisted(() => ({ search: '', leavePage: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.search) }))
vi.mock('../../lib/leave-page', () => ({ leavePage: navigation.leavePage }))

const firebase = vi.hoisted(() => {
  const user = { email: 'ada@acme.example', getIdToken: vi.fn(async () => 'id-token-1') }
  return {
    user,
    initializeApp: vi.fn(() => ({ name: 'app' })),
    signInWithPopup: vi.fn(async () => ({ user })),
    signInWithEmailAndPassword: vi.fn(async () => ({ user })),
    createUserWithEmailAndPassword: vi.fn(async () => ({ user })),
    sendEmailVerification: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    setCustomParameters: vi.fn(),
  }
})
vi.mock('firebase/app', () => ({ getApps: () => [], getApp: vi.fn(), initializeApp: firebase.initializeApp }))
vi.mock('firebase/auth', () => ({
  initializeAuth: () => ({ name: 'auth' }),
  getAuth: vi.fn(),
  inMemoryPersistence: {},
  browserPopupRedirectResolver: {},
  GoogleAuthProvider: class { setCustomParameters = firebase.setCustomParameters },
  signInWithPopup: firebase.signInWithPopup,
  signInWithEmailAndPassword: firebase.signInWithEmailAndPassword,
  createUserWithEmailAndPassword: firebase.createUserWithEmailAndPassword,
  sendEmailVerification: firebase.sendEmailVerification,
  signOut: firebase.signOut,
}))

const CONFIG = { api_key: 'public-key', auth_domain: 'nmp.firebaseapp.com', project_id: 'nmp', app_id: '1:2:web:3' }
const session = (next_step: string) => ok({ expires_at: '2026-11-17T20:00:00Z', next_step }, 201)

async function openEmailForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Use a Firebase email account' }))
  const form = within(screen.getByRole('form', { name: 'Firebase email account' }))
  await user.type(form.getByLabelText('Email address'), 'ada@acme.example')
  await user.type(form.getByLabelText('Password'), 'firebase secret')
  return form
}

describe('FirebaseSignIn', () => {
  beforeEach(() => {
    navigation.search = ''
    navigation.leavePage.mockClear()
    for (const mock of Object.values(firebase)) if (typeof mock === 'function') mock.mockClear()
    firebase.signInWithPopup.mockImplementation(async () => ({ user: firebase.user }))
  })

  it('BUG-101: asks the API for nothing when the web server has no Firebase auth domain', () => {
    const fetchMock = fetchReturning()
    renderWithProviders(<SignInForm realm="tenant" firebase={false} />, fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
  })

  it('adds nothing to the page when the API has Firebase disabled', async () => {
    const fetchMock = fetchReturning(apiError(404, 'FIREBASE_DISABLED'))
    renderWithProviders(<SignInForm realm="tenant" firebase />, fetchMock)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/auth/firebase-config', expect.anything()))
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
    expect(screen.queryByText('or')).toBeNull()
    expect(firebase.initializeApp).not.toHaveBeenCalled()
  })

  it('asks for the company before opening the Google popup', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok(CONFIG))
    renderWithProviders(<SignInForm realm="tenant" firebase />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect(screen.getByRole('alert').textContent).toContain('Enter your company sign-in name.')
    expect(screen.getByLabelText('Company').getAttribute('aria-invalid')).toBe('true')
    expect(firebase.signInWithPopup).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('exchanges the Google ID token for a session, follows next_step and signs out of Firebase', async () => {
    const user = userEvent.setup()
    navigation.search = 'next=%2Fsettings%2Faudit'
    const fetchMock = fetchReturning(ok(CONFIG), session('mfa_verification'))
    renderWithProviders(<SignInForm realm="tenant" firebase />, fetchMock)
    await user.type(screen.getByLabelText('Company'), ' Acme ')
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/signin/mfa?next=%2Fsettings%2Faudit'))
    expect(firebase.initializeApp).toHaveBeenCalledWith({ apiKey: 'public-key', authDomain: 'nmp.firebaseapp.com', projectId: 'nmp', appId: '1:2:web:3' })
    expect(firebase.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' })
    expect(firebase.user.getIdToken).toHaveBeenCalledWith(true)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/firebase-sessions')
    expect(requestBody(fetchMock, 1)).toEqual({ tenant: 'acme', id_token: 'id-token-1' })
    await waitFor(() => expect(firebase.signOut).toHaveBeenCalledTimes(1))
  })

  it('uses the vendor endpoint without a company', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok(CONFIG), session('none'))
    renderWithProviders(<SignInForm realm="vendor" firebase />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/vendor'))
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/vendor-firebase-sessions')
    expect(requestBody(fetchMock, 1)).toEqual({ id_token: 'id-token-1' })
  })

  it('asks once for the account password when the API needs it to link, and sends it with the same token', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(
      ok(CONFIG), apiError(401, 'FIREBASE_LINK_REQUIRED'), apiError(401, 'INVALID_CREDENTIALS', 'The sign-in could not be completed.'), session('none'),
    )
    renderWithProviders(<SignInForm realm="vendor" firebase />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    const link = within(await screen.findByRole('form', { name: 'Link your account' }))
    expect(document.activeElement).toBe(link.getByLabelText('Account password'))
    expect(navigation.leavePage).not.toHaveBeenCalled()
    await user.type(link.getByLabelText('Account password'), 'wrong one')
    await user.click(link.getByRole('button', { name: 'Link and sign in' }))
    expect(await link.findByText('The password is not correct.')).toBeTruthy()
    await user.clear(link.getByLabelText('Account password'))
    await user.type(link.getByLabelText('Account password'), 'correct horse battery staple')
    await user.click(link.getByRole('button', { name: 'Link and sign in' }))
    await waitFor(() => expect(navigation.leavePage).toHaveBeenCalledWith('/vendor'))
    expect(requestBody(fetchMock, 1)).toEqual({ id_token: 'id-token-1' })
    expect(requestBody(fetchMock, 3)).toEqual({ id_token: 'id-token-1', password: 'correct horse battery staple' })
    expect(firebase.signInWithPopup).toHaveBeenCalledTimes(1)
  })

  it('maps INVALID_CREDENTIALS to the no-account message and still signs out of Firebase', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignInForm realm="tenant" firebase />, fetchReturning(ok(CONFIG), apiError(401, 'INVALID_CREDENTIALS', 'The sign-in could not be completed.')))
    await user.type(screen.getByLabelText('Company'), 'acme')
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect((await screen.findByRole('alert')).textContent).toContain('No staff account in this company matches that Google/Firebase account.')
    expect(firebase.signOut).toHaveBeenCalledTimes(1)
    expect(navigation.leavePage).not.toHaveBeenCalled()
  })

  it('reports nothing when the person closes the popup', async () => {
    const user = userEvent.setup()
    firebase.signInWithPopup.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }))
    const fetchMock = fetchReturning(ok(CONFIG))
    renderWithProviders(<SignInForm realm="vendor" firebase />, fetchMock)
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(firebase.signOut).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Continue with Google' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('creates a Firebase email account and sends the verification link', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignInForm realm="tenant" firebase />, fetchReturning(ok(CONFIG)))
    const form = await openEmailForm(user)
    await user.click(form.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByText('We sent a verification link to ada@acme.example. Open it, then sign in.')).closest('[role="status"]')).not.toBeNull()
    expect(firebase.createUserWithEmailAndPassword).toHaveBeenCalledWith({ name: 'auth' }, 'ada@acme.example', 'firebase secret')
    expect(firebase.sendEmailVerification).toHaveBeenCalledWith(firebase.user)
    expect(firebase.signOut).toHaveBeenCalledTimes(1)
  })

  it('offers to send the link again when the API says the email is not verified', async () => {
    const user = userEvent.setup()
    const fetchMock = fetchReturning(ok(CONFIG), apiError(401, 'EMAIL_NOT_VERIFIED'))
    renderWithProviders(<SignInForm realm="tenant" firebase />, fetchMock)
    await user.type(screen.getByLabelText('Company'), 'acme')
    const form = await openEmailForm(user)
    await user.click(form.getByRole('button', { name: 'Sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Your email address is not verified yet.')
    expect(requestBody(fetchMock, 1)).toEqual({ tenant: 'acme', id_token: 'id-token-1' })
    await user.click(within(alert).getByRole('button', { name: 'Send the link again' }))
    expect(await screen.findByText('We sent a verification link to ada@acme.example. Open it, then sign in.')).toBeTruthy()
    expect(screen.queryByText(/not verified yet/)).toBeNull()
    expect(firebase.signInWithEmailAndPassword).toHaveBeenCalledTimes(2)
    expect(firebase.sendEmailVerification).toHaveBeenCalledWith(firebase.user)
    expect(firebase.signOut).toHaveBeenCalledTimes(2)
  })
})
