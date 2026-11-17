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
import { approvalOf, keyLabel, type PolicyKey } from './labels'
import { draftOf, fieldId, PolicyFields, policyValue, type Draft } from './policy-fields'

const KEY_ID = 'version-key'
const DATE_ID = 'version-effective'
const REASON_ID = 'version-reason'

export interface VersionDialogProps {
  /** The policy keys the user may read (and so change). */
  readonly keys: readonly PolicyKey[]
  readonly initialKey: PolicyKey
  /** The values in force by key: a change starts from them. */
  readonly values: Readonly<Record<string, unknown>>
  /** meta.latest_version of GET /v1/settings: the If-Match base. */
  readonly latestVersion: number
  readonly onClose: () => void
  readonly onSaved: () => void
}
const PAST_DATE = 'Enter a date and time from now on: a change cannot take effect in the past.'
/** Server refusals of the effective date (FR-TEN-003): shown on the Effective from field (BUG-055). */
const DATE_REFUSALS: Readonly<Record<string, string | null>> = { SETTING_EFFECTIVE_FROM_INVALID: PAST_DATE, EFFECTIVE_IN_COMMITTED_PERIOD: null }

/**
 * The effective date in ISO form; keys that need an approval (money, visibility policy) need one (FR-TEN-003), other keys
 * apply now when it is empty.
 */
export function effectiveError(key: PolicyKey, local: string, now: number = Date.now()): { iso: string | null; error: string | null } {
  if (local === '') return { iso: null, error: approvalOf(key) === null ? null : 'Enter the date and time the change takes effect.' }
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
 * reason. Keys with an approver (money: Finance approver; visibility policy: DPO) answer 202 with a change request;
 * other keys save a version at once.
 */
export function VersionDialog({ keys, initialKey, values, latestVersion, onClose, onSaved }: VersionDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [key, setKey] = useState<PolicyKey>(initialKey)
  const [draft, setDraft] = useState<Draft>(() => draftOf(initialKey, values[initialKey]))
  const [local, setLocal] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const approval = approvalOf(key)
  // VALIDATION_FAILED issues on value(.x) link to the key's first field.
  const firstField = fieldId(Object.keys(policyValue(key, {}).errors)[0] ?? 'value')
  function submit() {
    const built = policyValue(key, draft)
    const effective = effectiveError(key, local)
    const reasonError = requiredError('the reason for this change', reason)
    const found = { ...Object.fromEntries(Object.entries(built.errors).map(([field, message]) => [fieldId(field), message])), [DATE_ID]: effective.error, [REASON_ID]: reasonError }
    setErrors(found)
    const items: SummaryItem[] = Object.entries(found).flatMap(([id, message]) => (message === null ? [] : [{ fieldId: id, message }]))
    if (items.length > 0) return { items }
    const body = { value: built.value, reason: reason.trim(), ...(effective.iso === null ? {} : { effective_from: effective.iso }) }
    return {
      items,
      fieldIds: { value: firstField, effective_from: DATE_ID, reason: REASON_ID },
      send: async () => {
        // 202 = a change request (a key with an approver); 200 = the version saved.
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
            ? `${keyLabel(key)} change sent. Waiting for ${approval?.short ?? 'second-person'} approval.`
            : `${keyLabel(key)} saved as version ${saved.data.version}.`,
        })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title="Save new version with effective date" size="lg" submitLabel={approval === null ? 'Save new version' : 'Send for approval'} onClose={onClose} onSubmit={submit}>
      <Select
        id={KEY_ID}
        label="Setting"
        options={keys.map((option) => ({ value: option, label: keyLabel(option) }))}
        value={key}
        onChange={(event) => {
          const next = event.target.value as PolicyKey
          setKey(next)
          setDraft(draftOf(next, values[next]))
          setErrors({})
        }}
      />
      <PolicyFields
        policyKey={key}
        draft={draft}
        errors={Object.fromEntries(Object.entries(errors).flatMap(([id, message]) => (message === null || !id.startsWith('version-') ? [] : [[id.slice('version-'.length), message]])))}
        onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
      />
      <TextInput
        id={DATE_ID}
        type="datetime-local"
        label="Effective from"
        optional={approval === null}
        helper={approval === null
          ? 'Your local time. Leave empty to apply it now.'
          : 'Your local time. Not in the past and not inside a period whose results are committed: choose the next period start or later.'}
        value={local}
        error={errors[DATE_ID]}
        onChange={(event) => setLocal(event.target.value)}
      />
      <TextAreaField id={REASON_ID} label="Reason for the change" helper="Kept with the new version in the audit log." value={reason} error={errors[REASON_ID]} onChange={setReason} />
      {approval !== null && (
        <Banner tone="info" title={`Needs ${approval.short} approval`}>
          A {approval.role} who did not request it must approve the change. Nothing changes until then.
        </Banner>
      )}
    </FormDialog>
  )
}
