'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Checkbox, SelectField, TextField } from '../../../components/form-field'
import type { SummaryItem } from '../../../components/error-summary'
import { useToast } from '../../../components/toast'
import { errorMessage } from '../../../lib/messages'
import { requiredError } from '../../../lib/validation'
import { durationLabel, supportScopeLabel } from '../format'
import { FormDialog, TextAreaField } from '../form-dialog'
import { useResource } from '../../../lib/use-resource'
import type { TenantView } from '../types'

const TENANT_ID = 'session-tenant'
const REASON_ID = 'session-reason'
const SCOPE_ID = 'session-scope'
const MINUTES_ID = 'session-minutes'
const WHOLE_NUMBER = /^\d+$/
// Only tenants whose staff can decide (support/requests.ts SUPPORTED_TENANT_STATES).
const SUPPORTED_STATES = new Set(['implementation', 'live'])
// shortcut: the tenant choice lists the first 200 tenants by slug; switch to a searchable combobox when there are more.
const TENANT_PAGE_SIZE = 200

/** GET /v1/support-sessions/limits: the longest session and the areas a vendor user may ask to read. */
export interface SupportSessionLimits {
  readonly max_minutes: number
  readonly scopes: readonly string[]
}

export function sessionMinutesError(value: string, maxMinutes: number): string | null {
  const trimmed = value.trim()
  if (!WHOLE_NUMBER.test(trimmed)) return 'Enter the duration in minutes as a whole number.'
  const minutes = Number(trimmed)
  return minutes >= 1 && minutes <= maxMinutes ? null : `Ask for 1 to ${maxMinutes} minutes (${durationLabel(maxMinutes)}).`
}

export interface RequestSessionDialogProps {
  /** Asked from a tenant's page: that tenant; from the sessions page: chosen here. */
  readonly tenant?: TenantView
  readonly onClose: () => void
  readonly onRequested: () => void
}

/**
 * SC-39 Request support session (FR-IAM-005, API-08): POST /v1/support-sessions {tenant, reason, scope, minutes}
 * with an Idempotency-Key. Read-only access; the tenant's admins decide; nothing is accessible before that.
 */
export function RequestSessionDialog({ tenant, onClose, onRequested }: RequestSessionDialogProps) {
  const api = useApi()
  const toast = useToast()
  const tenants = useResource<TenantView[]>(tenant === undefined ? '/v1/tenants' : null, { limit: TENANT_PAGE_SIZE })
  const limits = useResource<SupportSessionLimits>('/v1/support-sessions/limits')
  const scopes = limits.data?.scopes ?? []
  const [tenantId, setTenantId] = useState(tenant?.id ?? '')
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<ReadonlySet<string>>(new Set())
  const [minutes, setMinutes] = useState('')
  const [errors, setErrors] = useState<Partial<Record<'tenant' | 'reason' | 'scope' | 'minutes', string | null>>>({})
  const choices = (tenants.data ?? []).filter((candidate) => SUPPORTED_STATES.has(candidate.state))

  function toggle(permission: string, checked: boolean) {
    setScope((current) => new Set(checked ? [...current, permission] : [...current].filter((item) => item !== permission)))
  }
  function submit(idempotencyKey: string) {
    const found = {
      tenant: tenantId === '' ? 'Choose the tenant.' : null,
      reason: requiredError('why you need access', reason),
      scope: scope.size === 0 ? 'Choose at least one area to see.' : null,
      minutes: limits.data === null ? 'The session limits could not be loaded. Close the dialog and try again.' : sessionMinutesError(minutes, limits.data.max_minutes),
    }
    setErrors(found)
    const ids = { tenant: TENANT_ID, reason: REASON_ID, scope: SCOPE_ID, minutes: MINUTES_ID } as const
    const items: SummaryItem[] = (Object.keys(ids) as (keyof typeof ids)[]).flatMap((key) => {
      const message = found[key]
      return message === null ? [] : [{ fieldId: ids[key], message }]
    })
    if (items.length > 0) return { items }
    const body = { tenant: tenantId, reason: reason.trim(), scope: { permissions: scopes.filter((item) => scope.has(item)) }, minutes: Number(minutes.trim()) }
    return {
      items,
      fieldIds: { tenant: TENANT_ID, reason: REASON_ID, 'scope.permissions': SCOPE_ID, minutes: MINUTES_ID },
      send: async () => {
        await api.post('/v1/support-sessions', body, { idempotencyKey })
        toast({ message: 'Support session requested. Nothing can be accessed until the tenant approves it.', tone: 'info' })
        onRequested()
      },
    }
  }

  return (
    <FormDialog title="Request support session" size="lg" submitLabel="Send request" onClose={onClose} onSubmit={submit}>
      <p>The tenant’s admins see your reason and what you ask for. Access is read-only, time-boxed and every view is logged for them.</p>
      {tenant === undefined
        ? (
          <SelectField
            id={TENANT_ID}
            label="Tenant"
            placeholder={tenants.loading ? 'Loading tenants…' : 'Choose a tenant'}
            helper={tenants.error === null ? 'Only tenants in implementation or live can be supported.' : errorMessage(tenants.error)}
            data-autofocus
            value={tenantId}
            error={errors.tenant}
            options={choices.map((choice) => ({ value: choice.id, label: `${choice.legal_name} (${choice.slug})` }))}
            onChange={(event) => setTenantId(event.target.value)}
          />
        )
        : <p>Tenant: {tenant.legal_name} ({tenant.slug})</p>}
      <TextAreaField id={REASON_ID} label="Reason" helper="For example the ticket number and what you need to check." value={reason} error={errors.reason} onChange={setReason} />
      <fieldset className="admin-fieldset" id={SCOPE_ID} tabIndex={-1} aria-describedby={errors.scope ? `${SCOPE_ID}-error` : undefined}>
        <legend>Areas you need to see</legend>
        <p className="admin-note">View only: nothing can be changed in a support session.</p>
        {errors.scope && <p id={`${SCOPE_ID}-error`} className="field-error">{errors.scope}</p>}
        {limits.loading && <p className="admin-note">Loading the areas you may ask for…</p>}
        {limits.error !== null && <p className="field-error">{errorMessage(limits.error)}</p>}
        <div className="admin-check-grid">
          {scopes.map((permission) => (
            <Checkbox key={permission} label={supportScopeLabel(permission)} checked={scope.has(permission)} onChange={(event) => toggle(permission, event.target.checked)} />
          ))}
        </div>
      </fieldset>
      <TextField
        id={MINUTES_ID}
        label="Duration in minutes"
        helper={limits.data === null
          ? 'The window starts when the tenant approves.'
          : `Up to ${limits.data.max_minutes} minutes (${durationLabel(limits.data.max_minutes)}). The window starts when the tenant approves.`}
        inputMode="numeric"
        value={minutes}
        error={errors.minutes}
        onChange={(event) => setMinutes(event.target.value)}
      />
    </FormDialog>
  )
}
