'use client'

import { useState, type ReactNode } from 'react'
import { useApi } from '../../../components/api-provider'
import type { SummaryItem } from '../../../components/error-summary'
import { useToast } from '../../../components/toast'
import { requiredError } from '../../../lib/validation'
import { FormDialog, TextAreaField } from '../form-dialog'

export type SettingKey =
  | 'compliance.active_pv_minor'
  | 'compliance.rank_thresholds_pv_minor'
  | 'compliance.late_order_day'
  | 'compliance.personal_share_flag'
  | 'privacy.breach_contacts'

/** What an editor hands over on Save: the value to store, or the field errors to show. */
export interface BuiltValue {
  readonly value?: unknown
  readonly items: readonly SummaryItem[]
}

const REASON_ID = 'setting-reason'
const MINOR_UNITS = /^(0|[1-9]\d{0,18})$/
const INT64_MAX = 9_223_372_036_854_775_807n

/** A non-negative whole number in minor units, sent as a decimal string (the API's bigint string). */
export function minorUnitsError(value: string, what: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return `Enter ${what}.`
  if (!MINOR_UNITS.test(trimmed) || BigInt(trimmed) > INT64_MAX) return `Enter ${what} as a whole number without separators, for example 5000.`
  return null
}

export interface SettingDialogProps {
  readonly settingKey: SettingKey
  readonly title: string
  /** meta.latest_version: sent as If-Match so a change made meanwhile is not overwritten (412). */
  readonly latestVersion: number
  readonly onClose: () => void
  readonly onSaved: () => void
  /** Validates the editor's fields; called on Save. */
  readonly build: () => BuiltValue
  readonly children: ReactNode
}

/**
 * Saves one tenant setting as a new version (API-39 PUT /v1/settings/:key with If-Match and a reason). Breach
 * contacts need a fresh second factor; the API asks and ApiProvider prompts.
 */
export function SettingDialog({ settingKey, title, latestVersion, onClose, onSaved, build, children }: SettingDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  function submit() {
    const built = build()
    const missingReason = requiredError('the reason for this change', reason)
    setReasonError(missingReason)
    const items = [...built.items, ...(missingReason === null ? [] : [{ fieldId: REASON_ID, message: missingReason }])]
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: { reason: REASON_ID },
      send: async () => {
        await api.put(`/v1/settings/${settingKey}`, { value: built.value, reason: reason.trim() }, { headers: { 'If-Match': `"${latestVersion}"` } })
        toast({ message: `${title} saved. It applies from now on.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={`Change ${title.toLowerCase()}`} size="lg" submitLabel="Save change" onClose={onClose} onSubmit={submit}>
      {children}
      <TextAreaField
        id={REASON_ID}
        label="Reason for the change"
        helper="Kept with the new version in the audit log."
        value={reason}
        error={reasonError}
        onChange={setReason}
      />
    </FormDialog>
  )
}
