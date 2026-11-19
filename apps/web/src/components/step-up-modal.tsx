'use client'

import { useState, type FormEvent } from 'react'
import { isApiError } from '../lib/api'
import { errorMessage } from '../lib/messages'
import { useApi } from './api-provider'
import { Banner } from './banner'
import { Button } from './button'
import { CodeInput } from './code-input'
import { FormField, TOUCH_INPUT_CLASS } from './form-field'
import { Icon } from './icon'
import { Modal } from './modal'
import { TOTP_ENROL_PATH, TotpSteps, type TotpEnrolment } from './totp-steps'

export interface StepUpModalProps {
  readonly open: boolean
  /** true: the code was verified; false: the user cancelled. */
  readonly onDone: (verified: boolean) => void
}

/**
 * Fresh second factor before a sensitive action (sc_02-modal step-up block, TOTP instead of the drawn hardware key:
 * the API supports TOTP only). Opened by ApiProvider on STEP_UP_REQUIRED; the action is then retried once. A user
 * without an authenticator app (a role that does not force one, BUG-110) sets one up here: confirming its first code
 * verifies the session with a fresh step-up time, so the action goes ahead without leaving the page.
 */
export function StepUpModal({ open, onDone }: StepUpModalProps) {
  return open && <StepUpPrompt onDone={onDone} />
}

function StepUpPrompt({ onDone }: { readonly onDone: (verified: boolean) => void }) {
  const api = useApi()
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cancel = <Button onClick={() => onDone(false)} className="w-full">Cancel</Button>
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
    <Modal open onClose={() => onDone(false)} title="Confirm with your authenticator app" icon="lock" size="sm">
      <p className="font-body-sm text-body-sm text-on-surface-variant">This action needs a fresh code from your authenticator app. Nothing has been changed yet.</p>
      {notice !== null && <Banner tone="info">{notice}</Banner>}
      <div className="bg-surface-container-low rounded-lg p-space-md space-y-space-md">
        <div className="flex items-center gap-space-xs">
          <Icon name="pin" size={18} className="text-primary" />
          <span className="font-section-heading text-caption uppercase tracking-wider font-bold text-on-surface">Authenticator code</span>
        </div>
        <CodeInput
          idPrefix="step-up"
          endpoint="/v1/auth/sessions/current/step-up"
          submitLabel="Confirm and continue"
          onVerified={() => onDone(true)}
          secondaryAction={cancel}
        />
      </div>
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <span className="font-body-sm text-body-sm text-on-surface-variant">No authenticator app set up yet?</span>
        <Button variant="tertiary" icon="qr_code_2" loading={busy} onClick={setUp}>Set one up now</Button>
      </div>
    </Modal>
  )
}

/**
 * D-B5-04 portal re-authentication: the account password (POST /v1/auth/sessions/current/reauth, portal sessions only)
 * opens the same step-up window as a TOTP code. Each opening starts with an empty field.
 */
export function PasswordStepUpModal({ open, onDone }: StepUpModalProps) {
  return open && <PasswordForm onDone={onDone} />
}

function PasswordForm({ onDone }: { readonly onDone: (verified: boolean) => void }) {
  const api = useApi()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password === '') {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/v1/auth/sessions/current/reauth', { password })
      onDone(true)
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={() => onDone(false)} title="Confirm it is you" icon="lock" size="sm">
      <form noValidate onSubmit={submit} className="flex flex-col gap-space-md">
        <p className="font-body-lg text-body-lg text-on-surface-variant">Enter your password to continue. Nothing has been changed yet.</p>
        <FormField id="reauth-password" label="Password" error={error}>
          {(control) => (
            <input {...control} type="password" autoComplete="current-password" data-autofocus className={TOUCH_INPUT_CLASS} value={password}
              onChange={(event) => setPassword(event.target.value)} />
          )}
        </FormField>
        <div className="flex flex-col gap-space-sm">
          <Button type="submit" variant="primary" size="lg" loading={busy}>Confirm and continue</Button>
          <Button size="lg" onClick={() => onDone(false)}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}
