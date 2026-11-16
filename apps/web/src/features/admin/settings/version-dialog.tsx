'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Select, TextInput } from '../../../components/form-field'
import type { SummaryItem } from '../../../components/error-summary'
import { useToast } from '../../../components/toast'
import { ApiError, type ApiResult } from '../../../lib/api'
import { requiredError } from '../../../lib/validation'
import { FormDialog, TextAreaField } from '../form-dialog'
import { fromLocalInput } from '../format'
import { CLAWBACK_OPTIONS, isMoneyKey, keyLabel, ROUNDING_OPTIONS, type PolicyKey } from './labels'

const KEY_ID = 'version-key'
const VALUE_ID = 'version-value'
const DATE_ID = 'version-effective'
const REASON_ID = 'version-reason'
const NOTICE_MAX_DAYS = 365
const WHOLE = /^\d{1,3}$/

export interface VersionDialogProps {
  /** The policy keys the user may read (and so change). */
  readonly keys: readonly PolicyKey[]
  readonly initialKey: PolicyKey
  /** meta.latest_version of GET /v1/settings: the If-Match base. */
  readonly latestVersion: number
  readonly onClose: () => void
  readonly onSaved: () => void
}

/** The value to PUT for a key from the form text, or the error to show. */
export function policyValue(key: PolicyKey, text: string): { value?: unknown; error: string | null } {
  if (key === 'plan.activation_notice_days') {
    const days = Number(text.trim())
    return WHOLE.test(text.trim()) && days <= NOTICE_MAX_DAYS ? { value: days, error: null } : { error: `Enter a whole number of days from 0 to ${NOTICE_MAX_DAYS}.` }
  }
  if (text === '') return { error: `Choose the ${keyLabel(key).toLowerCase()}.` }
  return { value: key === 'money.clawback_policy' ? { default: text } : text, error: null }
}

const PAST_DATE = 'Enter a date and time from now on: a change cannot take effect in the past.'
/** Server refusals of the effective date (FR-TEN-003): shown on the Effective from field (BUG-055). */
const DATE_REFUSALS: Readonly<Record<string, string | null>> = { SETTING_EFFECTIVE_FROM_INVALID: PAST_DATE, EFFECTIVE_IN_COMMITTED_PERIOD: null }

/** The effective date in ISO form; money keys need one (FR-TEN-003), other keys apply now when it is empty. */
export function effectiveError(key: PolicyKey, local: string, now: number = Date.now()): { iso: string | null; error: string | null } {
  if (local === '') return { iso: null, error: isMoneyKey(key) ? 'Enter the date and time the change takes effect.' : null }
  const iso = fromLocalInput(local)
  if (iso === null) return { iso, error: 'Enter a valid date and time.' }
  return Date.parse(iso) < now ? { iso, error: PAST_DATE } : { iso, error: null }
}

/** A date refusal as a VALIDATION_FAILED issue on effective_from, so the summary links to the field; others unchanged. */
export function asDateIssue(error: unknown): { readonly error: unknown; readonly message: string | null } {
  if (!(error instanceof ApiError) || !Object.hasOwn(DATE_REFUSALS, error.code)) return { error, message: null }
  const message = DATE_REFUSALS[error.code] ?? error.message
  return { error: new ApiError(error.status, 'VALIDATION_FAILED', message, { issues: [{ path: 'effective_from', message }] }, error.requestId), message }
}

/**
 * sc_29 "Save new version with effective date": one policy key, its new value, the instant it takes effect and the
 * reason. Money keys answer 202 with a change request for a Finance approver; other keys save a version at once.
 */
export function VersionDialog({ keys, initialKey, latestVersion, onClose, onSaved }: VersionDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [key, setKey] = useState<PolicyKey>(initialKey)
  const [value, setValue] = useState('')
  const [local, setLocal] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const money = isMoneyKey(key)
  function submit() {
    const built = policyValue(key, value)
    const effective = effectiveError(key, local)
    const reasonError = requiredError('the reason for this change', reason)
    const found = { [VALUE_ID]: built.error, [DATE_ID]: effective.error, [REASON_ID]: reasonError }
    setErrors(found)
    const items: SummaryItem[] = Object.entries(found).flatMap(([fieldId, message]) => (message === null ? [] : [{ fieldId, message }]))
    if (items.length > 0) return { items }
    const body = { value: built.value, reason: reason.trim(), ...(effective.iso === null ? {} : { effective_from: effective.iso }) }
    return {
      items,
      fieldIds: { value: VALUE_ID, effective_from: DATE_ID, reason: REASON_ID },
      send: async () => {
        // 202 = a change request (money key); 200 = the version saved.
        let saved: ApiResult<{ version: number }>
        try {
          saved = await api.put<{ version: number }>(`/v1/settings/${key}`, body, { headers: { 'If-Match': `"${latestVersion}"` } })
        } catch (failure) {
          const refusal = asDateIssue(failure)
          if (refusal.message !== null) setErrors((current) => ({ ...current, [DATE_ID]: refusal.message }))
          throw refusal.error
        }
        toast({
          message: saved.status === 202
            ? `${keyLabel(key)} change sent. Waiting for Finance approval.`
            : `${keyLabel(key)} saved as version ${saved.data.version}.`,
        })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title="Save new version with effective date" size="lg" submitLabel={money ? 'Send for approval' : 'Save new version'} onClose={onClose} onSubmit={submit}>
      <Select
        id={KEY_ID}
        label="Setting"
        options={keys.map((option) => ({ value: option, label: keyLabel(option) }))}
        value={key}
        onChange={(event) => {
          setKey(event.target.value as PolicyKey)
          setValue('')
        }}
      />
      {key === 'plan.activation_notice_days'
        ? <TextInput id={VALUE_ID} label="Days of notice" helper={`0 to ${NOTICE_MAX_DAYS} days before a plan version activates.`} inputMode="numeric" value={value} error={errors[VALUE_ID]} onChange={(event) => setValue(event.target.value)} />
        : (
          <Select
            id={VALUE_ID}
            label={key === 'money.rounding_mode' ? 'Rounding mode' : 'Clawback default'}
            placeholder="Choose"
            options={key === 'money.rounding_mode' ? ROUNDING_OPTIONS : CLAWBACK_OPTIONS}
            value={value}
            error={errors[VALUE_ID]}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      <TextInput
        id={DATE_ID}
        type="datetime-local"
        label="Effective from"
        optional={!money}
        helper={money
          ? 'Your local time. Not in the past and not inside a period whose results are committed: choose the next period start or later.'
          : 'Your local time. Leave empty to apply it now.'}
        value={local}
        error={errors[DATE_ID]}
        onChange={(event) => setLocal(event.target.value)}
      />
      <TextAreaField id={REASON_ID} label="Reason for the change" helper="Kept with the new version in the audit log." value={reason} error={errors[REASON_ID]} onChange={setReason} />
      {money && (
        <Banner tone="info" title="Needs Finance approval">
          A Finance approver who did not request it must approve the change. Nothing changes until then.
        </Banner>
      )}
    </FormDialog>
  )
}
