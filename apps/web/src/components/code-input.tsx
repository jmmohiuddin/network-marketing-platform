'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isApiError } from '../lib/api'
import { errorMessage } from '../lib/messages'
import { CODE_LENGTH, codeError, digitsOnly } from '../lib/validation'
import { useApi } from './api-provider'
import { Banner } from './banner'
import { Button } from './button'
import { FormField } from './form-field'

// sc_27 l.92 six-slot look as ONE input (pasteable, autofillable: guidelines §6.9); also the portal's emailed sign-in code.
export const CODE_CLASS = 'w-full h-11 text-center font-data-mono-lg text-data-mono-lg tracking-[0.5em] text-on-surface bg-surface-container-lowest rounded shadow-sm border border-outline-variant placeholder:text-outline-variant focus:outline-none focus:bg-surface-container-high focus:ring-1 focus:ring-primary aria-[invalid=true]:border-error aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-error transition-colors'

export interface CodeInputProps {
  /** Prefix of the field id. */
  readonly idPrefix: string
  /** POST endpoint that takes { code }: enrolment confirmation, sign-in verification or step-up. */
  readonly endpoint: string
  readonly submitLabel: string
  readonly onVerified: () => void
  /** A secondary action under the submit button (Cancel, Sign out). */
  readonly secondaryAction?: ReactNode
  /** Focus the field on mount: set when the form is the page's only task (MFA sign-in step); dialogs focus [data-autofocus]. */
  readonly autoFocus?: boolean
  /** The field's words in the page's language (portal re-authentication); English when absent. */
  readonly words?: CodeWords
  /** A failure's text in that language; errorMessage (the API's English message) when absent. */
  readonly failureText?: (error: unknown) => string
}

export interface CodeWords {
  readonly label: string
  readonly helper: string
  /** Shown for an empty field. */
  readonly required: string
  /** Shown for anything other than 6 digits. */
  readonly digits: string
}

function codeProblem(value: string, words: CodeWords | undefined): string | null {
  const english = codeError(value)
  if (english === null || words === undefined) return english
  return value === '' ? words.required : words.digits
}

/** One 6-digit TOTP code field and its submit: numeric keyboard, one-time-code autofill, server errors inline. */
export function CodeInput({ idPrefix, endpoint, submitLabel, onVerified, secondaryAction, autoFocus = false, words, failureText = errorMessage }: CodeInputProps) {
  const api = useApi()
  const input = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = codeProblem(code, words)
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
        setFieldError(failureText(error))
        input.current?.focus()
      } else {
        setFormError(failureText(error))
      }
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-space-md" onSubmit={submit} noValidate>
      {formError !== null && <Banner tone="danger">{formError}</Banner>}
      <FormField id={`${idPrefix}-code`} label={words?.label ?? 'Verification code'} helper={words?.helper ?? 'The 6-digit code your authenticator app shows now.'} error={fieldError}>
        {(control) => (
          <input
            {...control}
            ref={input}
            className={CODE_CLASS}
            value={code}
            onChange={(event) => setCode(digitsOnly(event.target.value))}
            onBlur={() => code !== '' && setFieldError(codeProblem(code, words))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            placeholder="000000"
            data-autofocus
            autoFocus={autoFocus}
          />
        )}
      </FormField>
      <div className="flex flex-col gap-space-sm">
        <Button type="submit" variant="primary" size="lg" icon="login" loading={busy} className="w-full" data-testid="primary-action">{submitLabel}</Button>
        {secondaryAction}
      </div>
    </form>
  )
}
