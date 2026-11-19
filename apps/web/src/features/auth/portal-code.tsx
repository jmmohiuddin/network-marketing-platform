'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { CODE_CLASS } from '../../components/code-input'
import { FormField } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { isApiError } from '../../lib/api'
import { leavePage } from '../../lib/leave-page'
import { errorMessage } from '../../lib/messages'
import { afterSignInPath, PORTAL_SIGN_IN_PATH } from '../../lib/navigation'
import { CODE_LENGTH, codeError, digitsOnly } from '../../lib/validation'
import { AuthFooter, AuthHeader } from './auth-card'
import type { SignInSession } from './firebase-sign-in'
import {
  PORTAL_CODES_ENDPOINT, PORTAL_SESSIONS_ENDPOINT, portalQuery, portalTarget, readPendingCode, savePendingCode, type PendingCode,
} from './portal-sign-in'

/**
 * SC-27 portal code step (D-B5-03): the 6-digit code from the email, checked with the company and email of the first
 * step (kept in this tab). A wrong, used or expired code reads the same for every email; "Send a new code" asks again.
 */
export function PortalCode() {
  const api = useApi()
  const params = useSearchParams()
  const next = params.get('next')
  const back = `${PORTAL_SIGN_IN_PATH}${portalQuery(params.get('tenant'), next)}`
  const input = useRef<HTMLInputElement>(null)
  // undefined: not read yet (server render); null: nothing to continue (another tab, storage blocked).
  const [pending, setPending] = useState<PendingCode | null | undefined>(undefined)
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const tenant = params.get('tenant')

  // A code started for another company (?tenant= differs) is not continued: the member starts again.
  useEffect(() => {
    const stored = readPendingCode()
    setPending(stored !== null && tenant !== null && tenant !== stored.tenant ? null : stored)
  }, [tenant])

  if (pending === undefined) return <LoadingState label="Loading the code step" />
  if (pending === null) {
    return (
      <>
        <AuthHeader eyebrow="Distributor sign-in" icon="mail" title="Start the sign-in again">Enter your email address again to get a new code.</AuthHeader>
        <LinkButton href={back} variant="primary" size="lg" icon="login" className="w-full" data-testid="primary-action">Back to sign-in</LinkButton>
      </>
    )
  }
  const started = pending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = codeError(code)
    setFieldError(invalid)
    setFormError(null)
    setNotice(null)
    if (invalid !== null) {
      input.current?.focus()
      return
    }
    setBusy(true)
    try {
      const { data } = await api.post<SignInSession>(PORTAL_SESSIONS_ENDPOINT, { ...started, code })
      savePendingCode(null)
      leavePage(afterSignInPath(data.next_step, portalTarget(next)))
    } catch (error) {
      if (isApiError(error, 'INVALID_CREDENTIALS')) {
        setFieldError(errorMessage(error))
        input.current?.focus()
      } else {
        setFormError(errorMessage(error))
      }
      setBusy(false)
    }
  }

  // One request at a time (the button ignores clicks while loading): each new code voids the previous one and counts
  // against the member's limit.
  async function resend() {
    setResending(true)
    setFormError(null)
    setNotice(null)
    try {
      await api.post(PORTAL_CODES_ENDPOINT, started)
      setCode('')
      setFieldError(null)
      setNotice('A new code is on its way. Earlier codes no longer work.')
    } catch (error) {
      setFormError(errorMessage(error))
    }
    setResending(false)
  }

  return (
    <>
      <AuthHeader eyebrow="Distributor sign-in" icon="mail" title="Enter your sign-in code" step="Step 2 / 2">
        If a portal account uses {started.email}, we sent it a 6-digit code. It works once and for a few minutes.
      </AuthHeader>
      {notice !== null && <Banner tone="success">{notice}</Banner>}
      <form className="flex flex-col gap-space-md" onSubmit={submit} noValidate>
        {formError !== null && <Banner tone="danger">{formError}</Banner>}
        <FormField id="portal-code" label="Sign-in code" helper="The 6-digit code from the email." error={fieldError}>
          {(control) => (
            <input {...control} ref={input} className={CODE_CLASS} value={code} onChange={(event) => setCode(digitsOnly(event.target.value))}
              onBlur={() => code !== '' && setFieldError(codeError(code))} inputMode="numeric" autoComplete="one-time-code"
              maxLength={CODE_LENGTH} placeholder="000000" autoFocus />
          )}
        </FormField>
        <Button type="submit" variant="primary" size="lg" icon="login" loading={busy} className="w-full" data-testid="primary-action">Sign in</Button>
      </form>
      <AuthFooter>
        <Button variant="tertiary" loading={resending} onClick={resend}>Send a new code</Button>
        <LinkButton variant="tertiary" href={`${PORTAL_SIGN_IN_PATH}${portalQuery(params.get('tenant'), next, 'password')}`}>Use password</LinkButton>
      </AuthFooter>
    </>
  )
}
