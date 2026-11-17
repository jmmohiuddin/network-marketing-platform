'use client'

import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  browserPopupRedirectResolver, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, inMemoryPersistence, initializeAuth,
  sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, type Auth, type UserCredential,
} from 'firebase/auth'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { TextInput } from '../../components/form-field'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import type { NextStep, Realm } from '../../lib/navigation'
import { emailError, requiredError } from '../../lib/validation'

/** GET /v1/auth/firebase-config: the Firebase web app config (public values). */
export interface FirebaseConfig {
  readonly api_key: string
  readonly auth_domain: string
  readonly project_id: string
  readonly app_id: string
}

export interface SignInSession {
  readonly expires_at: string
  readonly next_step: NextStep
}

export const FIREBASE_CONFIG_PATH = '/v1/auth/firebase-config'
const ENDPOINT: Readonly<Record<Realm, string>> = { tenant: '/v1/auth/firebase-sessions', vendor: '/v1/auth/vendor-firebase-sessions' }
const NO_ACCOUNT: Readonly<Record<Realm, string>> = {
  tenant: 'No staff account in this company matches that Google/Firebase account.',
  vendor: 'No operations staff account matches that Google/Firebase account.',
}
const SIGN_IN_FAILED = 'The sign-in could not be completed. Try again.'
// Firebase's own errors; null: the person stopped the sign-in themselves, nothing to report.
const FIREBASE_MESSAGES: Readonly<Record<string, string | null>> = {
  'auth/popup-closed-by-user': null,
  'auth/cancelled-popup-request': null,
  'auth/user-cancelled': null,
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/invalid-credential': 'The email or password is not correct.',
  'auth/invalid-email': 'The email or password is not correct.',
  'auth/wrong-password': 'The email or password is not correct.',
  'auth/user-not-found': 'The email or password is not correct.',
  'auth/email-already-in-use': 'An account with this email address already exists. Sign in instead.',
  'auth/weak-password': 'Choose a longer password: at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'Cannot reach the sign-in service. Check your connection and try again.',
}

/**
 * The page's Firebase Auth, created once. Kept in memory only: Firebase just proves who the person is, and the app's
 * HttpOnly session cookie is the only session, so nothing of Firebase's outlives the page.
 */
function firebaseAuth(config: FirebaseConfig): Auth {
  if (getApps().length > 0) return getAuth(getApp())
  const app = initializeApp({ apiKey: config.api_key, authDomain: config.auth_domain, projectId: config.project_id, appId: config.app_id })
  return initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver })
}

function firebaseCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('auth/') ? code : null
}

/** The sentence for a failed Firebase or API step, or null when there is nothing to report. */
function failureMessage(realm: Realm, error: unknown): string | null {
  const code = firebaseCode(error)
  if (code !== null) return code in FIREBASE_MESSAGES ? FIREBASE_MESSAGES[code]! : SIGN_IN_FAILED
  if (isApiError(error, 'INVALID_CREDENTIALS')) return NO_ACCOUNT[realm]
  return errorMessage(error)
}

const WRONG_ACCOUNT_PASSWORD = 'The password is not correct.'

const sentMessage = (email: string) => `We sent a verification link to ${email}. Open it, then sign in.`

type EmailField = 'email' | 'password'

/** A verified Firebase sign-in waiting for the account password that links it (401 FIREBASE_LINK_REQUIRED). */
interface PendingLink {
  readonly tenant: string | null
  readonly idToken: string
}

export interface FirebaseSignInProps {
  readonly realm: Realm
  /** Tenant realm: the company sign-in name, or null once the form shows why it is missing. Checked before Firebase. */
  readonly company?: () => string | null
  /** Follows next_step like the password sign-in. */
  readonly onSignedIn: (session: SignInSession) => void
  /** Shows a failure in the form's error summary; null clears it. */
  readonly onError: (message: string | null) => void
}

/**
 * Firebase sign-in under the password form (Google, Firebase email/password), shown only when the API has Firebase
 * configured. The Firebase ID token is exchanged for the app's session; MFA and roles then apply as for a password.
 */
export function FirebaseSignIn({ realm, company, onSignedIn, onError }: FirebaseSignInProps) {
  const api = useApi()
  const [auth, setAuth] = useState<Auth | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Readonly<Record<EmailField, string>>>({ email: '', password: '' })
  const [errors, setErrors] = useState<Readonly<Partial<Record<EmailField, string>>>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [link, setLink] = useState<PendingLink | null>(null)
  const [linkPassword, setLinkPassword] = useState('')
  const [linkError, setLinkError] = useState<string | undefined>(undefined)
  const emailRef = useRef<HTMLInputElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    // 404 FIREBASE_DISABLED, or no answer: the page stays password-only, exactly as without Firebase.
    api.get<FirebaseConfig>(FIREBASE_CONFIG_PATH).then(({ data }) => { if (live) setAuth(firebaseAuth(data)) }).catch(() => undefined)
    return () => { live = false }
  }, [api])

  useEffect(() => {
    if (open) emailRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (link !== null) linkRef.current?.focus()
  }, [link])

  if (auth === null) return null
  const firebase = auth

  /** Runs one Firebase action; always ends Firebase's own session. work() resolves true when the page is being left. */
  async function withFirebase(work: () => Promise<boolean>, viaEmail: boolean) {
    onError(null)
    setNotice(null)
    setUnverified(false)
    setBusy(true)
    let leaving = false
    try {
      leaving = await work()
    } catch (error) {
      if (viaEmail && isApiError(error, 'EMAIL_NOT_VERIFIED')) setUnverified(true)
      else {
        const message = failureMessage(realm, error)
        if (message !== null) onError(message)
      }
    } finally {
      await signOut(firebase)
    }
    if (!leaving) setBusy(false)
  }

  async function openSession(pending: PendingLink, password?: string) {
    const body = { ...(pending.tenant === null ? {} : { tenant: pending.tenant }), id_token: pending.idToken, ...(password === undefined ? {} : { password }) }
    const { data } = await api.post<SignInSession>(ENDPOINT[realm], body)
    onSignedIn(data)
  }

  // The first Firebase sign-in of an account must also prove its password: the token is kept (valid for an hour) until then.
  async function exchange(credential: Promise<UserCredential>, tenant: string | null): Promise<boolean> {
    const { user } = await credential
    const pending = { tenant, idToken: await user.getIdToken(true) }
    try {
      await openSession(pending)
      return true
    } catch (error) {
      if (!isApiError(error, 'FIREBASE_LINK_REQUIRED')) throw error
      setLinkPassword('')
      setLinkError(undefined)
      setLink(pending)
      return false
    }
  }

  function confirmLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (link === null) return
    const missing = requiredError('your password', linkPassword) ?? undefined
    setLinkError(missing)
    if (missing !== undefined) return
    onError(null)
    setBusy(true)
    openSession(link, linkPassword).catch((error: unknown) => {
      if (isApiError(error, 'INVALID_CREDENTIALS')) setLinkError(WRONG_ACCOUNT_PASSWORD)
      else onError(errorMessage(error))
      setBusy(false)
    })
  }

  // undefined: the tenant realm's company is missing (the form says so); null: the vendor realm has none.
  function tenantOrStop(): string | null | undefined {
    if (company === undefined) return null
    return company() ?? undefined
  }

  function google() {
    setLink(null)
    const tenant = tenantOrStop()
    if (tenant === undefined) return
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    // No await before signInWithPopup: browsers only allow the popup inside the click.
    void withFirebase(() => exchange(signInWithPopup(firebase, provider), tenant), false)
  }

  function emailValid(): boolean {
    const found = { email: emailError(values.email) ?? undefined, password: requiredError('your password', values.password) ?? undefined }
    setErrors(found)
    return found.email === undefined && found.password === undefined
  }

  function signInWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!emailValid()) return
    setLink(null)
    const tenant = tenantOrStop()
    if (tenant === undefined) return
    void withFirebase(() => exchange(signInWithEmailAndPassword(firebase, values.email.trim(), values.password), tenant), true)
  }

  /** Create account, or send the link again: Firebase needs the person signed in to send it. */
  function sendVerification(credential: () => Promise<UserCredential>) {
    if (!emailValid()) return
    void withFirebase(async () => {
      const { user } = await credential()
      await sendEmailVerification(user)
      setNotice(sentMessage(values.email.trim()))
      return false
    }, false)
  }

  const set = (field: EmailField, value: string) => setValues((current) => ({ ...current, [field]: value }))

  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex items-center gap-space-sm" role="separator" aria-label="or">
        <div className="h-[1px] flex-1 bg-surface-variant" />
        <span aria-hidden="true" className="font-caption text-caption uppercase tracking-wider text-outline">or</span>
        <div className="h-[1px] flex-1 bg-surface-variant" />
      </div>
      {link !== null && (
        <form aria-label="Link your account" className="flex flex-col gap-space-md" onSubmit={confirmLink} noValidate>
          <Banner tone="info">This is your first sign-in with Google/Firebase here. Enter the password of your account once to link them.</Banner>
          <TextInput ref={linkRef} id="firebase-link-password" label="Account password" type="password" autoComplete="current-password"
            value={linkPassword} error={linkError} onChange={(event) => setLinkPassword(event.target.value)} />
          <Button type="submit" variant="primary" disabled={busy}>Link and sign in</Button>
        </form>
      )}
      <Button variant="secondary" size="lg" className="w-full" disabled={busy} onClick={google}>
        <span aria-hidden="true" className="font-semibold">G</span>
        Continue with Google
      </Button>
      <Button variant="tertiary" icon={open ? 'expand_less' : 'expand_more'} className="self-start" aria-expanded={open} aria-controls="firebase-email"
        onClick={() => setOpen((value) => !value)}>
        Use a Firebase email account
      </Button>
      {open && (
        <form id="firebase-email" aria-label="Firebase email account" className="flex flex-col gap-space-md" onSubmit={signInWithEmail} noValidate>
          {unverified && (
            <Banner tone="danger" action={(
              <Button disabled={busy} onClick={() => sendVerification(() => signInWithEmailAndPassword(firebase, values.email.trim(), values.password))}>
                Send the link again
              </Button>
            )}>
              Your email address is not verified yet. Open the link we sent to {values.email.trim()}, then sign in.
            </Banner>
          )}
          {notice !== null && <Banner tone="success">{notice}</Banner>}
          <TextInput ref={emailRef} id="firebase-email-address" label="Email address" type="email" autoComplete="username" value={values.email}
            error={errors.email} onChange={(event) => set('email', event.target.value)} autoCapitalize="none" spellCheck={false} />
          <TextInput id="firebase-password" label="Password" type="password" autoComplete="current-password" value={values.password}
            error={errors.password} onChange={(event) => set('password', event.target.value)} />
          <div className="flex flex-wrap gap-space-sm">
            <Button type="submit" variant="secondary" disabled={busy}>Sign in</Button>
            <Button disabled={busy} onClick={() => sendVerification(() => createUserWithEmailAndPassword(firebase, values.email.trim(), values.password))}>
              Create account
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
