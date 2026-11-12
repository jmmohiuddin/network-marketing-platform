'use client'

import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Button, type ButtonVariant } from '../../components/button'
import { Dialog, type DialogSize } from '../../components/dialog'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { FormField, type FieldLabelProps } from '../../components/form-field'
import { newIdempotencyKey } from '../../lib/api'
import { errorMessage, fieldErrors } from '../../lib/messages'

/**
 * Summary items for a failed request: VALIDATION_FAILED issues linked to their fields (body path -> field id),
 * otherwise the error's message (server rule failures name the rule).
 */
export function summaryOf(error: unknown, fieldIds: Readonly<Record<string, string>> = {}): SummaryItem[] {
  const issues = Object.entries(fieldErrors(error))
  if (issues.length === 0) return [{ message: errorMessage(error) }]
  return issues.map(([path, message]) => {
    const fieldId = fieldIds[path]
    return fieldId === undefined ? { message: `${path}: ${message}` } : { fieldId, message }
  })
}

export interface FormSubmission {
  /** Field errors found before sending; empty to send. */
  readonly items: readonly SummaryItem[]
  /** Sends the request; a rejection is shown in the summary and the dialog stays open. */
  readonly send?: () => Promise<void>
  /** Body path -> field id, for VALIDATION_FAILED issues. */
  readonly fieldIds?: Readonly<Record<string, string>>
}

export interface FormDialogProps {
  readonly title: string
  readonly size?: DialogSize
  readonly submitLabel: string
  readonly submitVariant?: ButtonVariant
  readonly onClose: () => void
  /**
   * Validates and returns what to send. idempotencyKey is one key per attempt at the same values: a retry after a
   * failure reuses it, any edit to a field drops it (so a corrected request is not refused as a reused key).
   */
  readonly onSubmit: (idempotencyKey: string) => FormSubmission
  readonly children: ReactNode
}

/**
 * A dialog holding one form (UX-05 6.4 short creation forms and decisions): fields, an error summary that takes
 * focus on a failed submit, Cancel and one submit button. Mount it only while open, so each opening starts with
 * fresh fields.
 */
export function FormDialog({ title, size = 'md', submitLabel, submitVariant = 'primary', onClose, onSubmit, children }: FormDialogProps) {
  const formId = useId()
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = idempotencyKey ?? newIdempotencyKey()
    setIdempotencyKey(key)
    const submission = onSubmit(key)
    setSummary(submission.items)
    if (submission.items.length > 0 || submission.send === undefined) return
    setBusy(true)
    try {
      await submission.send()
    } catch (error) {
      setSummary(summaryOf(error, submission.fieldIds))
      setBusy(false)
    }
  }
  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" form={formId} variant={submitVariant} loading={busy}>{submitLabel}</Button>
    </>
  )
  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={title} size={size} footer={footer}>
      <form id={formId} className="form" onSubmit={submit} onChange={() => setIdempotencyKey(null)} noValidate>
        <ErrorSummary items={summary} />
        {children}
      </form>
    </Dialog>
  )
}

/** The API's limit on reasons and notes. */
export const REASON_MAX_LENGTH = 500

export interface TextAreaFieldProps extends FieldLabelProps {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly maxLength?: number
}

/** A reason or note (at most 500 characters unless maxLength says otherwise) with label, helper and error. */
export function TextAreaField({ value, onChange, maxLength = REASON_MAX_LENGTH, ...field }: TextAreaFieldProps) {
  return (
    <FormField {...field}>
      {(control) => (
        <textarea {...control} className="input admin-textarea" value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
      )}
    </FormField>
  )
}
