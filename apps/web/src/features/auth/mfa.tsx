'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { CodeInput } from '../../components/code-input'
import { SignOutButton } from '../../components/sign-out-button'
import { useToast } from '../../components/toast'
import { TOTP_ENROL_PATH, TotpSteps, type TotpEnrolment } from '../../components/totp-steps'
import { isApiError } from '../../lib/api'
import { leavePage } from '../../lib/leave-page'
import { errorMessage } from '../../lib/messages'
import { MFA_VERIFY_PATH, realmOf, safeNext, withNext } from '../../lib/navigation'
import { useMe } from '../../lib/session'
import { AuthFooter, AuthHeader, IdentityBox } from './auth-card'

/** The page to continue to (from ?next=), its realm, and the MFA pages' shared redirect; portal: a portal page (MFA optional). */
function useTarget() {
  const target = safeNext(useSearchParams().get('next'))
  const realm = realmOf(target)
  return { target, realm, destination: target ?? '/', portal: realm === 'portal' }
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
      <AuthFooter><SignOutButton realm={realm} tenant={me?.tenant?.slug ?? null} /></AuthFooter>
    </>
  )
}

/**
 * TOTP enrolment: forced when the role requires it (AC-35.1: no page until a factor is enrolled), else optional (portal
 * members, and staff whose role needs a factor only for step-up, BUG-110). Enrolment starts on the user's click, so
 * reloading or double rendering never replaces a secret the user is scanning.
 */
export function MfaEnrolment() {
  const api = useApi()
  const router = useRouter()
  const toast = useToast()
  const { target, realm, destination, portal } = useTarget()
  const { me } = useMe()
  // Optional: the member or user may go back without a factor (D-B5-03; mfa.required false).
  const optional = portal || me?.mfa.required === false
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<TotpEnrolment>(TOTP_ENROL_PATH)
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
          {portal
            ? 'Protect your portal account with a second factor: after you set up an authenticator app on your phone, each sign-in also asks for the 6-digit code it shows.'
            : optional
              ? 'Some actions, such as deciding a case, ask for a fresh code from an authenticator app. Set one up on your phone, one that shows 6-digit time-based codes.'
              : 'Your role needs a second factor. You can open pages after you set up an authenticator app on your phone, one that shows 6-digit time-based codes.'}
        </AuthHeader>
        {error !== null && <Banner tone="danger">{error}</Banner>}
        <Button variant="primary" size="lg" icon="qr_code_2" loading={busy} onClick={start} className="w-full" data-testid="primary-action">Set up authenticator app</Button>
        <AuthFooter>{optional ? <Button variant="tertiary" onClick={() => leavePage(destination)}>Not now</Button> : <SignOutButton realm={realm} />}</AuthFooter>
      </>
    )
  }
  return (
    <>
      <AuthHeader eyebrow="Second factor" icon="phonelink_lock" title="Set up your authenticator app">
        Add this account to your authenticator app, then enter the code it shows.
      </AuthHeader>
      <TotpSteps enrolment={enrolment} idPrefix="enrol" onVerified={verified} />
    </>
  )
}
