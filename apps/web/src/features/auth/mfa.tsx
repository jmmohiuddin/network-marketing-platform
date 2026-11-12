'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { CodeForm } from '../../components/code-form'
import { QrCode } from '../../components/qr-code'
import { SecretText } from '../../components/secret-text'
import { SignOutButton } from '../../components/sign-out-button'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { MFA_VERIFY_PATH, realmOf, safeNext, withNext } from '../../lib/navigation'

/** The page to continue to (from ?next=), its realm, and the MFA pages' shared redirect. */
function useTarget() {
  const target = safeNext(useSearchParams().get('next'))
  return { target, realm: realmOf(target), destination: target ?? '/' }
}

/** SC-27 second step: the code from the enrolled authenticator app. */
export function MfaVerification() {
  const router = useRouter()
  const { realm, destination } = useTarget()
  return (
    <>
      <h1 className="card-title">Enter your verification code</h1>
      <p>Open your authenticator app and enter the 6-digit code it shows for this account.</p>
      <CodeForm
        idPrefix="mfa"
        endpoint="/v1/auth/sessions/current/mfa"
        submitLabel="Verify code"
        onVerified={() => router.replace(destination)}
        secondaryAction={<SignOutButton realm={realm} />}
      />
    </>
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
    router.replace(destination)
  }

  if (enrolment === null) {
    return (
      <>
        <h1 className="card-title">Set up your authenticator app</h1>
        <p>Your role needs a second factor. You can open pages after you set up an authenticator app on your phone, one that shows 6-digit time-based codes.</p>
        {error !== null && <Banner tone="danger">{error}</Banner>}
        <div className="form-actions">
          <SignOutButton realm={realm} />
          <Button variant="primary" loading={busy} onClick={start}>Set up authenticator app</Button>
        </div>
      </>
    )
  }
  return (
    <>
      <h1 className="card-title">Set up your authenticator app</h1>
      <ol className="steps">
        <li>
          <h2 className="step-title">Scan the QR code</h2>
          <p>In your authenticator app, add an account and scan this code.</p>
          <QrCode value={enrolment.otpauth_uri} label="QR code that adds this account to your authenticator app. The same key is shown as text below." />
        </li>
        <li>
          <h2 className="step-title">Or type the setup key</h2>
          <p>If you cannot scan, add the account by typing this key. Do not share it.</p>
          <SecretText label="Setup key" value={enrolment.secret} />
        </li>
        <li>
          <h2 className="step-title">Enter the code from the app</h2>
          <CodeForm idPrefix="enrol" endpoint="/v1/auth/mfa/totp/confirm" submitLabel="Confirm code" onVerified={verified} />
        </li>
      </ol>
    </>
  )
}
