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
import { afterSignInPath, PORTAL_SIGN_IN_PATH } from '../../lib/navigation'
import { CODE_LENGTH, digitsOnly } from '../../lib/validation'
import { errorText } from '../portal/format'
import { translator, type Locale, type Translate } from '../portal/i18n'
import { AuthFooter, AuthHeader } from './auth-card'
import type { SignInSession } from './firebase-sign-in'
import {
  PORTAL_CODES_ENDPOINT, PORTAL_SESSIONS_ENDPOINT, portalQuery, portalTarget, readPendingCode, savePendingCode, type PendingCode,
} from './portal-sign-in'

/** The 6-digit code check of lib/validation in catalogue words. */
function codeProblem(code: string, t: Translate): string | null {
  if (code === '') return t('auth.code_required')
  return /^\d{6}$/.test(code) ? null : t('auth.code_digits')
}

/**
 * SC-27 portal code step (D-B5-03): the 6-digit code from the email, checked with the company and email of the first
 * step (kept in this tab). A wrong, used or expired code reads the same for every email; "Send a new code" asks again.
 */
export function PortalCode({ locale }: { readonly locale: Locale }) {
  const api = useApi()
  const t = translator(locale)
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

  if (pending === undefined) return <LoadingState label={t('auth.code_loading')} />
  if (pending === null) {
    return (
      <>
        <AuthHeader eyebrow={t('auth.eyebrow')} icon="mail" title={t('auth.start_again')}>{t('auth.start_again_text')}</AuthHeader>
        <LinkButton href={back} variant="primary" size="lg" icon="login" className="w-full" data-testid="primary-action">{t('auth.back_to_sign_in')}</LinkButton>
      </>
    )
  }
  const started = pending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = codeProblem(code, t)
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
        setFieldError(t('auth.code_wrong'))
        input.current?.focus()
      } else {
        setFormError(errorText(error, t))
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
      setNotice(t('auth.code_resent'))
    } catch (error) {
      setFormError(errorText(error, t))
    }
    setResending(false)
  }

  return (
    <>
      <AuthHeader eyebrow={t('auth.eyebrow')} icon="mail" title={t('auth.code_title')} step={t('auth.step', { step: 2, of: 2 })}>
        {t('auth.code_intro', { email: started.email })}
      </AuthHeader>
      {notice !== null && <Banner tone="success">{notice}</Banner>}
      <form className="flex flex-col gap-space-md" onSubmit={submit} noValidate>
        {formError !== null && <Banner tone="danger">{formError}</Banner>}
        <FormField id="portal-code" label={t('auth.code')} helper={t('auth.code_helper')} error={fieldError}>
          {(control) => (
            <input {...control} ref={input} className={CODE_CLASS} value={code} onChange={(event) => setCode(digitsOnly(event.target.value))}
              onBlur={() => code !== '' && setFieldError(codeProblem(code, t))} inputMode="numeric" autoComplete="one-time-code"
              maxLength={CODE_LENGTH} placeholder="000000" autoFocus />
          )}
        </FormField>
        <Button type="submit" variant="primary" size="lg" icon="login" loading={busy} className="w-full" data-testid="primary-action">{t('auth.sign_in')}</Button>
      </form>
      <AuthFooter>
        <Button variant="tertiary" loading={resending} onClick={resend}>{t('auth.code_new')}</Button>
        <LinkButton variant="tertiary" href={`${PORTAL_SIGN_IN_PATH}${portalQuery(params.get('tenant'), next, 'password')}`}>{t('auth.use_password')}</LinkButton>
      </AuthFooter>
    </>
  )
}
