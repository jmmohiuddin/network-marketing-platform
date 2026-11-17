'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { CodeInput } from '../../components/code-input'
import { QrCode } from '../../components/qr-code'
import { SecretText } from '../../components/secret-text'
import { SignOutButton } from '../../components/sign-out-button'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { leavePage } from '../../lib/leave-page'
import { errorMessage } from '../../lib/messages'
import { MFA_VERIFY_PATH, realmOf, safeNext, withNext } from '../../lib/navigation'
import { useMe } from '../../lib/session'
import { AUTH_TEXT, AuthFooter, AuthHeader, IdentityBox } from './auth-card'

/** The page to continue to (from ?next=), its realm, and the MFA pages' shared redirect. */
function useTarget() {
  const target = safeNext(useSearchParams().get('next'))
  return { target, realm: realmOf(target), destination: target ?? '/' }
}

// Leaving the auth pages is a full page load (leavePage): app pages then run under their own, narrower CSP.

/** SC-27 second step: the code from the enrolled authenticator app. */
export function MfaVerification() {
  const { realm, destination } = useTarget()
  // Who is signing in; the box is left out while loading or if it cannot be read (the code step works without it).
  const { me } = useMe()
  return (
    <>
      <AuthHeader eyebrow="Second factor" icon="lock" title="Enter your verification code" step="Step 2 / 2">
        Open your authenticator app and enter the 6-digit code it shows for this account.
      </AuthHeader>
      {me !== null && <IdentityBox me={me} />}
      <CodeInput
        idPrefix="mfa"
        endpoint="/v1/auth/sessions/current/mfa"
        autoFocus
        submitLabel="Verify code"
        onVerified={() => leavePage(destination)}
      />
      <AuthFooter><SignOutButton realm={realm} /></AuthFooter>
    </>
  )
}

/** One enrolment step in the sc_27 inner-panel look (bg-surface-container-low, rounded-lg). */
function EnrolStep({ number, title, text, children }: { readonly number: number; readonly title: string; readonly text?: string; readonly children: ReactNode }) {
  return (
    <li className="p-space-md bg-surface-container-low rounded-lg flex flex-col gap-space-sm">
      <div className="flex items-center gap-space-sm">
        <span aria-hidden="true" className="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-caption text-caption font-bold shrink-0">{number}</span>
        <h2 className="font-section-heading text-section-heading text-on-surface">{title}</h2>
      </div>
      {text !== undefined && <p className={AUTH_TEXT}>{text}</p>}
      {children}
    </li>
  )
}

/** POST /v1/auth/mfa/totp: shown once; the API keeps only the sealed secret. */
interface TotpEnrolment {
  readonly secret: string
  readonly otpauth_uri: string
}

/**
 * Forced TOTP enrolment (AC-35.1: no page until a factor is enrolled). Enrolment starts on the user's click,
 * so reloading or double rendering never replaces a secret the user is scanning.
 */
export function MfaEnrolment() {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const { target, realm, destination } = useTarget()
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<TotpEnrolment>('/v1/auth/mfa/totp')
      setEnrolment(data)
      setBusy(false)
    } catch (failure) {
      if (isApiError(failure, 'MFA_ALREADY_ENROLLED')) {
        router.replace(withNext(MFA_VERIFY_PATH, target))
        return
      }
      setError(errorMessage(failure))
      setBusy(false)
    }
  }

  function verified() {
    toast({ message: 'Your authenticator app is set up.' })
    // shortcut: a soft navigation keeps the toast, so this one session keeps the auth pages' wider CSP (csp.ts).
    router.replace(destination)
  }

  if (enrolment === null) {
    return (
      <>
        <AuthHeader eyebrow="Second factor" icon="phonelink_lock" title="Set up your authenticator app">
          Your role needs a second factor. You can open pages after you set up an authenticator app on your phone, one that shows 6-digit time-based codes.
        </AuthHeader>
        {error !== null && <Banner tone="danger">{error}</Banner>}
        <Button variant="primary" size="lg" icon="qr_code_2" loading={busy} onClick={start} className="w-full" data-testid="primary-action">Set up authenticator app</Button>
        <AuthFooter><SignOutButton realm={realm} /></AuthFooter>
      </>
    )
  }
  return (
    <>
      <AuthHeader eyebrow="Second factor" icon="phonelink_lock" title="Set up your authenticator app">
        Add this account to your authenticator app, then enter the code it shows.
      </AuthHeader>
      <ol className="flex flex-col gap-space-md">
        <EnrolStep number={1} title="Scan the QR code" text="In your authenticator app, add an account and scan this code.">
          <div className="flex justify-center">
            <QrCode value={enrolment.otpauth_uri} label="QR code that adds this account to your authenticator app. The same key is shown as text below." />
          </div>
        </EnrolStep>
        <EnrolStep number={2} title="Or type the setup key" text="If you cannot scan, add the account by typing this key. Do not share it.">
          <SecretText label="Setup key" value={enrolment.secret} />
        </EnrolStep>
        <EnrolStep number={3} title="Enter the code from the app">
          <CodeInput idPrefix="enrol" endpoint="/v1/auth/mfa/totp/confirm" submitLabel="Confirm code" onVerified={verified} />
        </EnrolStep>
      </ol>
    </>
  )
}
