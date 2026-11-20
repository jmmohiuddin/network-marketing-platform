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
import { errorText } from '../portal/format'
import { translator, type Locale, type Translate } from '../portal/i18n'
import { emailProblem, passwordProblem } from './credentials'

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
const ENDPOINT: Readonly<Record<Realm, string>> = {
  tenant: '/v1/auth/firebase-sessions', vendor: '/v1/auth/vendor-firebase-sessions', portal: '/v1/auth/portal-firebase-sessions',
}
// Firebase's own errors by catalogue key; null: the person stopped the sign-in themselves, nothing to report.
const FIREBASE_MESSAGES: Readonly<Record<string, 'auth.firebase.popup_blocked' | 'auth.firebase.wrong_credentials' | 'auth.firebase.email_in_use'
  | 'auth.firebase.weak_password' | 'auth.firebase.too_many' | 'auth.firebase.network' | null>> = {
  'auth/popup-closed-by-user': null,
  'auth/cancelled-popup-request': null,
  'auth/user-cancelled': null,
  'auth/popup-blocked': 'auth.firebase.popup_blocked',
  'auth/invalid-credential': 'auth.firebase.wrong_credentials',
  'auth/invalid-email': 'auth.firebase.wrong_credentials',
  'auth/wrong-password': 'auth.firebase.wrong_credentials',
  'auth/user-not-found': 'auth.firebase.wrong_credentials',
  'auth/email-already-in-use': 'auth.firebase.email_in_use',
  'auth/weak-password': 'auth.firebase.weak_password',
  'auth/too-many-requests': 'auth.firebase.too_many',
  'auth/network-request-failed': 'auth.firebase.network',
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

/** An API failure: the portal shows it by code from the catalogue (D-BM-11), staff the API's own sentence. */
const apiFailure = (realm: Realm, error: unknown, t: Translate): string => (realm === 'portal' ? errorText(error, t) : errorMessage(error))

/** The sentence for a failed Firebase or API step, or null when there is nothing to report. */
function failureMessage(realm: Realm, error: unknown, t: Translate): string | null {
  const code = firebaseCode(error)
  if (code !== null) {
    if (!(code in FIREBASE_MESSAGES)) return t('auth.firebase.failed')
    const key = FIREBASE_MESSAGES[code]!
    return key === null ? null : t(key)
  }
  if (isApiError(error, 'INVALID_CREDENTIALS')) return t(`auth.firebase.no_account.${realm}`)
  return apiFailure(realm, error, t)
}

type EmailField = 'email' | 'password'

/** A verified Firebase sign-in waiting for the account password that links it (401 FIREBASE_LINK_REQUIRED). */
interface PendingLink {
  readonly tenant: string | null
  readonly idToken: string
}

export interface FirebaseSignInProps {
  readonly realm: Realm
  /** Tenant and portal realms: the company sign-in name, or null once the form shows why it is missing. Checked before Firebase. */
  readonly company?: () => string | null
  /** Follows next_step like the password sign-in. */
  readonly onSignedIn: (session: SignInSession) => void
  /** Shows a failure in the form's error summary; null clears it. */
  readonly onError: (message: string | null) => void
  /** The portal's negotiated locale; staff and vendor sign-in stay English (the default). */
  readonly locale?: Locale
}

/**
 * Firebase sign-in under the password form (Google, Firebase email/password), shown only when the API has Firebase
 * configured. The Firebase ID token is exchanged for the app's session; MFA and roles then apply as for a password.
 */
export function FirebaseSignIn({ realm, company, onSignedIn, onError, locale = 'en' }: FirebaseSignInProps) {
  const api = useApi()
  const t = translator(locale)
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
        const message = failureMessage(realm, error, t)
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
    const missing = passwordProblem(linkPassword, t) ?? undefined
    setLinkError(missing)
    if (missing !== undefined) return
    onError(null)
    setBusy(true)
    openSession(link, linkPassword).catch((error: unknown) => {
      if (isApiError(error, 'INVALID_CREDENTIALS')) setLinkError(t('auth.firebase.wrong_password'))
      else onError(apiFailure(realm, error, t))
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
    const found = { email: emailProblem(values.email, t) ?? undefined, password: passwordProblem(values.password, t) ?? undefined }
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
      setNotice(t('auth.firebase.link_sent', { email: values.email.trim() }))
      return false
    }, false)
  }

  const set = (field: EmailField, value: string) => setValues((current) => ({ ...current, [field]: value }))

  return (
    <div className="flex flex-col gap-space-md">
      <div className="flex items-center gap-space-sm" role="separator" aria-label={t('auth.or')}>
        <div className="h-[1px] flex-1 bg-surface-variant" />
        <span aria-hidden="true" className="font-caption text-caption uppercase tracking-wider text-outline">{t('auth.or')}</span>
        <div className="h-[1px] flex-1 bg-surface-variant" />
      </div>
      {link !== null && (
        <form aria-label={t('auth.firebase.link_title')} className="flex flex-col gap-space-md" onSubmit={confirmLink} noValidate>
          <Banner tone="info">{t('auth.firebase.link_text')}</Banner>
          <TextInput ref={linkRef} id="firebase-link-password" label={t('auth.firebase.account_password')} type="password" autoComplete="current-password"
            value={linkPassword} error={linkError} onChange={(event) => setLinkPassword(event.target.value)} />
          <Button type="submit" variant="primary" disabled={busy}>{t('auth.firebase.link_and_sign_in')}</Button>
        </form>
      )}
      <Button variant="secondary" size="lg" className="w-full" disabled={busy} onClick={google}>
        <span aria-hidden="true" className="font-semibold">G</span>
        {t('auth.firebase.google')}
      </Button>
      <Button variant="tertiary" icon={open ? 'expand_less' : 'expand_more'} className="self-start" aria-expanded={open} aria-controls="firebase-email"
        onClick={() => setOpen((value) => !value)}>
        {t('auth.firebase.use_email')}
      </Button>
      {open && (
        <form id="firebase-email" aria-label={t('auth.firebase.email_account')} className="flex flex-col gap-space-md" onSubmit={signInWithEmail} noValidate>
          {unverified && (
            <Banner tone="danger" action={(
              <Button disabled={busy} onClick={() => sendVerification(() => signInWithEmailAndPassword(firebase, values.email.trim(), values.password))}>
                {t('auth.firebase.send_again')}
              </Button>
            )}>
              {t('auth.firebase.unverified', { email: values.email.trim() })}
            </Banner>
          )}
          {notice !== null && <Banner tone="success">{notice}</Banner>}
          <TextInput ref={emailRef} id="firebase-email-address" label={t('auth.email')} type="email" autoComplete="username" value={values.email}
            error={errors.email} onChange={(event) => set('email', event.target.value)} autoCapitalize="none" spellCheck={false} />
          <TextInput id="firebase-password" label={t('auth.password')} type="password" autoComplete="current-password" value={values.password}
            error={errors.password} onChange={(event) => set('password', event.target.value)} />
          <div className="flex flex-wrap gap-space-sm">
            <Button type="submit" variant="secondary" disabled={busy}>{t('auth.sign_in')}</Button>
            <Button disabled={busy} onClick={() => sendVerification(() => createUserWithEmailAndPassword(firebase, values.email.trim(), values.password))}>
              {t('auth.firebase.create_account')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
