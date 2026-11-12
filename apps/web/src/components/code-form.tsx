'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isApiError } from '../lib/api'
import { errorMessage } from '../lib/messages'
import { CODE_LENGTH, codeError, digitsOnly } from '../lib/validation'
import { useApi } from './api-provider'
import { Banner } from './banner'
import { Button } from './button'
import { TextField } from './form-field'

export interface CodeFormProps {
  /** Prefix of the field id. */
  readonly idPrefix: string
  /** POST endpoint that takes { code }: enrolment confirmation, sign-in verification or step-up. */
  readonly endpoint: string
  readonly submitLabel: string
  readonly onVerified: () => void
  /** A secondary button placed before the submit button (Cancel, Sign out). */
  readonly secondaryAction?: ReactNode
  /** Focus the field on mount: set when the form is the page's only task (MFA sign-in step); dialogs focus [data-autofocus]. */
  readonly autoFocus?: boolean
}

/** One 6-digit TOTP code field: pasteable, numeric keyboard, one-time-code autofill (UX-05 §6.1 Auth). */
export function CodeForm({ idPrefix, endpoint, submitLabel, onVerified, secondaryAction, autoFocus = false }: CodeFormProps) {
  const api = useApi()
  const input = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = codeError(code)
    setFieldError(invalid)
    setFormError(null)
    if (invalid !== null) {
      input.current?.focus()
      return
    }
    setBusy(true)
    try {
      await api.post(endpoint, { code })
      onVerified()
    } catch (error) {
      if (isApiError(error, 'MFA_CODE_INVALID')) {
        setFieldError(errorMessage(error))
        input.current?.focus()
      } else {
        setFormError(errorMessage(error))
      }
      setBusy(false)
    }
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      {formError !== null && <Banner tone="danger">{formError}</Banner>}
      <TextField
        ref={input}
        id={`${idPrefix}-code`}
        label="Verification code"
        helper="The 6-digit code your authenticator app shows now."
        error={fieldError}
        value={code}
        onChange={(event) => setCode(digitsOnly(event.target.value))}
        onBlur={() => code !== '' && setFieldError(codeError(code))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LENGTH}
        data-autofocus
        autoFocus={autoFocus}
        className="input-code"
      />
      <div className="form-actions">
        {secondaryAction}
        <Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  )
}
