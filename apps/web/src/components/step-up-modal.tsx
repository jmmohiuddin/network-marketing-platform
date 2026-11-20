'use client'

import { useState, type FormEvent } from 'react'
import { isApiError } from '../lib/api'
import { errorMessage } from '../lib/messages'
import { useApi } from './api-provider'
import { Banner } from './banner'
import { Button } from './button'
import { CodeInput, type CodeWords } from './code-input'
import { FormField, TOUCH_INPUT_CLASS } from './form-field'
import { Icon } from './icon'
import { Modal } from './modal'
import { TOTP_ENROL_PATH, TotpSteps, type TotpEnrolment } from './totp-steps'

export interface StepUpModalProps {
  readonly open: boolean
  /** true: the code was verified; false: the user cancelled. */
  readonly onDone: (verified: boolean) => void
  /**
   * The prompt in the page's language (the portal's catalogue, D-BM-11): plain strings, so a server layout can pass
   * them. Without words the prompt is English and a user without an authenticator app may set one up here.
   */
  readonly words?: StepUpWords
}

export interface StepUpWords {
  readonly passwordTitle: string
  readonly passwordText: string
  readonly password: string
  readonly passwordRequired: string
  readonly codeTitle: string
  readonly codeText: string
  readonly codeSection: string
  readonly code: CodeWords
  readonly submit: string
  readonly cancel: string
  readonly close: string
  /** Failure texts by API error code; `unknown` for every other failure. */
  readonly errors: Readonly<Record<string, string>> & { readonly unknown: string }
}

/** A failure in the words' language, else the API's message. */
function failureOf(words: StepUpWords | undefined): (error: unknown) => string {
  if (words === undefined) return errorMessage
  return (error) => (isApiError(error) ? words.errors[error.code] : undefined) ?? words.errors.unknown
}

/**
 * Fresh second factor before a sensitive action (sc_02-modal step-up block, TOTP instead of the drawn hardware key:
 * the API supports TOTP only). Opened by ApiProvider on STEP_UP_REQUIRED; the action is then retried once. A user
 * without an authenticator app (a role that does not force one, BUG-110) sets one up here: confirming its first code
 * verifies the session with a fresh step-up time, so the action goes ahead without leaving the page.
 */
export function StepUpModal({ open, onDone, words }: StepUpModalProps) {
  return open && <StepUpPrompt onDone={onDone} words={words} />
}

function StepUpPrompt({ onDone, words }: Omit<StepUpModalProps, 'open'>) {
  const api = useApi()
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancel = <Button onClick={() => onDone(false)} className="w-full">{words?.cancel ?? 'Cancel'}</Button>
  async function setUp() {
    setBusy(true)
    setNotice(null)
    try {
      setEnrolment((await api.post<TotpEnrolment>(TOTP_ENROL_PATH)).data)
    } catch (failure) {
      setNotice(isApiError(failure, 'MFA_ALREADY_ENROLLED') ? 'Your account already has an authenticator app. Enter the code it shows.' : errorMessage(failure))
    }
    setBusy(false)
  }
  if (enrolment !== null) {
    return (
      <Modal open onClose={() => onDone(false)} title="Set up your authenticator app" icon="phonelink_lock" size="sm">
        <p className="font-body-sm text-body-sm text-on-surface-variant">This action needs a code from an authenticator app. Add this account to the app on your phone, then enter the code it shows. Nothing has been changed yet.</p>
        <TotpSteps enrolment={enrolment} idPrefix="step-up-enrol" onVerified={() => onDone(true)} secondaryAction={cancel} />
      </Modal>
    )
  }
  return (
    <Modal open onClose={() => onDone(false)} title={words?.codeTitle ?? 'Confirm with your authenticator app'} icon="lock" size="sm" closeLabel={words?.close}>
      <p className="font-body-sm text-body-sm text-on-surface-variant">{words?.codeText ?? 'This action needs a fresh code from your authenticator app. Nothing has been changed yet.'}</p>
      {notice !== null && <Banner tone="info">{notice}</Banner>}
      <div className="bg-surface-container-low rounded-lg p-space-md space-y-space-md">
        <div className="flex items-center gap-space-xs">
          <Icon name="pin" size={18} className="text-primary" />
          <span className="font-section-heading text-caption uppercase tracking-wider font-bold text-on-surface">{words?.codeSection ?? 'Authenticator code'}</span>
        </div>
        <CodeInput
          idPrefix="step-up"
          endpoint="/v1/auth/sessions/current/step-up"
          submitLabel={words?.submit ?? 'Confirm and continue'}
          onVerified={() => onDone(true)}
          secondaryAction={cancel}
          words={words?.code}
          failureText={failureOf(words)}
        />
      </div>
      {/* A portal user only gets this prompt with an authenticator app (portal/reauth.tsx), so nothing to set up. */}
      {words === undefined && (
        <div className="flex items-center justify-between gap-space-sm flex-wrap">
          <span className="font-body-sm text-body-sm text-on-surface-variant">No authenticator app set up yet?</span>
          <Button variant="tertiary" icon="qr_code_2" loading={busy} onClick={setUp}>Set one up now</Button>
        </div>
      )}
    </Modal>
  )
}

/**
 * D-B5-04 portal re-authentication: the account password (POST /v1/auth/sessions/current/reauth, portal sessions only)
 * opens the same step-up window as a TOTP code. Each opening starts with an empty field.
 */
export function PasswordStepUpModal({ open, onDone, words }: StepUpModalProps) {
  return open && <PasswordForm onDone={onDone} words={words} />
}

function PasswordForm({ onDone, words }: Omit<StepUpModalProps, 'open'>) {
  const api = useApi()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password === '') {
      setError(words?.passwordRequired ?? 'Enter your password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/v1/auth/sessions/current/reauth', { password })
      onDone(true)
    } catch (failure) {
      setError(failureOf(words)(failure))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={() => onDone(false)} title={words?.passwordTitle ?? 'Confirm it is you'} icon="lock" size="sm" closeLabel={words?.close}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-space-md">
        <p className="font-body-lg text-body-lg text-on-surface-variant">{words?.passwordText ?? 'Enter your password to continue. Nothing has been changed yet.'}</p>
        <FormField id="reauth-password" label={words?.password ?? 'Password'} error={error}>
          {(control) => (
            <input {...control} type="password" autoComplete="current-password" data-autofocus className={TOUCH_INPUT_CLASS} value={password}
              onChange={(event) => setPassword(event.target.value)} />
          )}
        </FormField>
        <div className="flex flex-col gap-space-sm">
          <Button type="submit" variant="primary" size="lg" loading={busy}>{words?.submit ?? 'Confirm and continue'}</Button>
          <Button size="lg" onClick={() => onDone(false)}>{words?.cancel ?? 'Cancel'}</Button>
        </div>
      </form>
    </Modal>
  )
}
