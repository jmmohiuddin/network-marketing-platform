'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import type { SummaryItem } from '../../components/error-summary'
import { Checkbox, FieldError, RadioGroup, TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { durationLabel, fromLocalInput } from '../admin/format'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { FIELDSET, LEGEND, NOTE } from '../admin/ui'
import { isNetwork, MAX_IP_NETWORKS, parseNetworks } from './format'
import { API_KEY_OPTIONS_PATH, SERVICE_ACCOUNTS_PATH, type ApiKey, type ApiKeyOptions, type IssuedKey, type RateTier, type ServiceAccount } from './types'

const NAME_MAX = 100
const TIER_LABELS: Readonly<Record<RateTier, string>> = { standard: 'Standard', high: 'High' }

type Errors = Readonly<Record<string, string | null>>

/** Summary items for the fields that have an error, in field order. */
function itemsOf(errors: Errors, ids: Readonly<Record<string, string>>): SummaryItem[] {
  return Object.entries(ids).flatMap(([field, fieldId]) => {
    const message = errors[field]
    return message === null || message === undefined ? [] : [{ fieldId, message }]
  })
}

/** POST /v1/service-accounts {name, purpose}: the identity keys belong to (FR-IAM-006, purpose required). */
export function CreateServiceAccountDialog({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const ids = { name: 'service-account-name', purpose: 'service-account-purpose' }
  function submit(idempotencyKey: string) {
    const found = { name: requiredError('a name', name), purpose: requiredError('the purpose', purpose) }
    setErrors(found)
    const items = itemsOf(found, ids)
    if (items.length > 0) return { items }
    const body = { name: name.trim(), purpose: purpose.trim() }
    return {
      items,
      fieldIds: ids,
      send: async () => {
        await api.post(SERVICE_ACCOUNTS_PATH, body, { idempotencyKey })
        toast({ message: `Service account ${body.name} was created. Create a key for it next.` })
        onCreated()
      },
    }
  }
  return (
    <FormDialog title="Create service account" submitLabel="Create service account" onClose={onClose} onSubmit={submit}>
      <p>A service account is the system that reads your data with an API key, for example a BI export. Its keys carry only the scopes you give them.</p>
      <TextInput id={ids.name} label="Name" maxLength={NAME_MAX} data-autofocus value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
      <TextAreaField id={ids.purpose} label="Purpose" helper="What the system does with the data. Shown in the audit log." value={purpose} error={errors.purpose} onChange={setPurpose} />
    </FormDialog>
  )
}

interface KeyForm {
  readonly name: string
  readonly scopes: ReadonlySet<string>
  readonly tier: RateTier
  readonly networks: string
  readonly expires: string
}

function networkError(networks: readonly string[]): string | null {
  if (networks.length > MAX_IP_NETWORKS) return `Enter at most ${MAX_IP_NETWORKS} addresses or networks.`
  const invalid = networks.filter((entry) => !isNetwork(entry))
  return invalid.length === 0 ? null : `Not an IP address or network (CIDR, for example 203.0.113.0/24): ${invalid.join(', ')}.`
}

// The API reports allow-list entries by index (ip_allow.2, host bits set); all point at the one field.
const networkEntryIds = (fieldId: string): Record<string, string> => Object.fromEntries(Array.from({ length: MAX_IP_NETWORKS }, (_, index) => [`ip_allow.${index}`, fieldId]))

function keyErrors(form: KeyForm, now: number): Errors {
  const networks = parseNetworks(form.networks)
  const expiresAt = fromLocalInput(form.expires)
  return {
    name: requiredError('a name for the key', form.name),
    scopes: form.scopes.size === 0 ? 'Choose at least one scope.' : null,
    ip_allow: networkError(networks),
    expires_at: form.expires === '' ? null : expiresAt === null ? 'Enter a date and time.' : Date.parse(expiresAt) <= now ? 'Choose a time in the future.' : null,
  }
}

/**
 * POST /v1/service-accounts/:id/keys (step-up, Idempotency-Key): scopes and rate tiers from GET /v1/api-keys/options,
 * optional IP allow-list and expiry. The token comes back once and goes to onIssued.
 */
export function CreateKeyDialog({ account, onClose, onIssued }: { readonly account: ServiceAccount; readonly onClose: () => void; readonly onIssued: (issued: IssuedKey) => void }) {
  const api = useApi()
  const options = useResource<ApiKeyOptions>(API_KEY_OPTIONS_PATH)
  const [form, setForm] = useState<KeyForm>({ name: '', scopes: new Set(), tier: 'standard', networks: '', expires: '' })
  const [errors, setErrors] = useState<Errors>({})
  const ids = { name: 'key-name', scopes: 'key-scopes', rate_tier: 'key-tier', ip_allow: 'key-networks', expires_at: 'key-expires' }
  const change = (patch: Partial<KeyForm>) => setForm((current) => ({ ...current, ...patch }))
  function toggle(scope: string, checked: boolean) {
    change({ scopes: new Set(checked ? [...form.scopes, scope] : [...form.scopes].filter((item) => item !== scope)) })
  }
  function submit(idempotencyKey: string) {
    const found = keyErrors(form, Date.now())
    setErrors(found)
    const items = itemsOf(found, ids)
    if (items.length > 0) return { items }
    const networks = parseNetworks(form.networks)
    const expiresAt = fromLocalInput(form.expires)
    const body = {
      name: form.name.trim(),
      scopes: (options.data?.scopes ?? []).map((option) => option.scope).filter((scope) => form.scopes.has(scope)),
      rate_tier: form.tier,
      ...(networks.length === 0 ? {} : { ip_allow: networks }),
      ...(expiresAt === null ? {} : { expires_at: expiresAt }),
    }
    return {
      items,
      fieldIds: { ...ids, ...networkEntryIds(ids.ip_allow) },
      send: async () => {
        const { data } = await api.post<IssuedKey>(`${SERVICE_ACCOUNTS_PATH}/${account.id}/keys`, body, { idempotencyKey })
        onIssued(data)
      },
    }
  }
  return (
    <FormDialog title={`Create API key for ${account.name}`} size="lg" submitLabel="Create key" onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>The key is shown once after it is created. You may be asked for a code from your authenticator app.</p>
      <TextInput id={ids.name} label="Key name" helper="Where the key is used, for example the server name." maxLength={NAME_MAX} data-autofocus value={form.name} error={errors.name} onChange={(event) => change({ name: event.target.value })} />
      <fieldset className={FIELDSET} id={ids.scopes} tabIndex={-1}>
        <legend className={LEGEND}>Scopes</legend>
        {options.loading && <p className={NOTE}>Loading the scopes…</p>}
        {options.error !== null && <FieldError message={errorMessage(options.error)} />}
        {errors.scopes != null && <FieldError message={errors.scopes} />}
        {(options.data?.scopes ?? []).map((option) => (
          <Checkbox
            key={option.scope} label={`${option.description} (${option.scope})`}
            helper={option.personal_data ? 'Includes personal data.' : 'No personal data.'}
            checked={form.scopes.has(option.scope)} onChange={(event) => toggle(option.scope, event.target.checked)}
          />
        ))}
      </fieldset>
      <div id={ids.rate_tier}>
        <RadioGroup
          legend="Rate limit" name="key-tier" value={form.tier} onChange={(tier) => change({ tier: tier === 'high' ? 'high' : 'standard' })}
          options={(options.data?.rate_tiers ?? []).map((tier) => ({ value: tier.tier, label: TIER_LABELS[tier.tier], helper: `${tier.requests_per_minute} requests per minute` }))}
        />
      </div>
      <TextAreaField
        id={ids.ip_allow} label="IP allow-list" optional value={form.networks} error={errors.ip_allow} onChange={(networks) => change({ networks })}
        helper={`One IP address or network (CIDR, for example 203.0.113.0/24) per line, at most ${MAX_IP_NETWORKS}. Empty: any address.`}
      />
      <TextInput id={ids.expires_at} label="Expires" optional type="datetime-local" helper="Your local time. Empty: the key does not expire." value={form.expires} error={errors.expires_at} onChange={(event) => change({ expires: event.target.value })} />
    </FormDialog>
  )
}

const WHOLE_NUMBER = /^\d+$/

/** Grace minutes from 0 to the API's maximum. */
export function graceError(value: string, max: number): string | null {
  const trimmed = value.trim()
  if (!WHOLE_NUMBER.test(trimmed)) return 'Enter the grace period in minutes as a whole number.'
  return Number(trimmed) <= max ? null : `Enter at most ${max} minutes (${durationLabel(max)}).`
}

/** Grace period field shared by key rotation and webhook secret rotation. */
export function GraceField({ id, value, error, max, onChange, subject }: {
  readonly id: string
  readonly value: string
  readonly error: string | null | undefined
  readonly max: number | null
  readonly onChange: (value: string) => void
  /** "old key", "old secret". */
  readonly subject: string
}) {
  return (
    <TextInput
      id={id} label="Grace period in minutes" inputMode="numeric" data-autofocus value={value} error={error} onChange={(event) => onChange(event.target.value)}
      helper={`How long the ${subject} keeps working beside the new one${max === null ? '' : `, 0 to ${max} minutes`}. 0 stops it now.`}
    />
  )
}

/** POST /v1/api-keys/:id/rotate {grace_minutes} (step-up, Idempotency-Key): a new key, shown once; the old one ends. */
export function RotateKeyDialog({ apiKey, onClose, onIssued }: { readonly apiKey: ApiKey; readonly onClose: () => void; readonly onIssued: (issued: IssuedKey) => void }) {
  const api = useApi()
  const options = useResource<ApiKeyOptions>(API_KEY_OPTIONS_PATH)
  const [grace, setGrace] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const max = options.data?.max_grace_minutes ?? null
  function submit(idempotencyKey: string) {
    const found = max === null ? 'The rotation limits could not be loaded. Close the dialog and try again.' : graceError(grace, max)
    setError(found)
    if (found !== null) return { items: [{ fieldId: 'key-grace', message: found }] }
    return {
      items: [],
      fieldIds: { grace_minutes: 'key-grace' },
      send: async () => {
        const { data } = await api.post<IssuedKey>(`/v1/api-keys/${apiKey.id}/rotate`, { grace_minutes: Number(grace.trim()) }, { idempotencyKey })
        onIssued(data)
      },
    }
  }
  return (
    <FormDialog title={`Rotate key ${apiKey.key_prefix}`} submitLabel="Rotate key" onClose={onClose} onSubmit={submit}>
      <p>A new key with the same scopes, rate limit, allow-list and expiry replaces {apiKey.name}. The new key is shown once. You may be asked for a code from your authenticator app.</p>
      <GraceField id="key-grace" value={grace} error={error} max={max} onChange={setGrace} subject="old key" />
    </FormDialog>
  )
}

export interface ReasonDialogProps {
  readonly title: string
  readonly intro: string
  readonly submitLabel: string
  /** POST path that takes {reason}. */
  readonly path: string
  readonly doneMessage: string
  readonly onClose: () => void
  readonly onDone: () => void
}

/** Revoke a key or disable a service account: irreversible, a stated reason (audited), step-up. */
export function ReasonDialog({ title, intro, submitLabel, path, doneMessage, onClose, onDone }: ReasonDialogProps) {
  const api = useApi()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const found = requiredError('the reason', reason)
    setError(found)
    if (found !== null) return { items: [{ fieldId: 'action-reason', message: found }] }
    return {
      items: [],
      fieldIds: { reason: 'action-reason' },
      send: async () => {
        await api.post(path, { reason: reason.trim() })
        toast({ message: doneMessage })
        onDone()
      },
    }
  }
  return (
    <FormDialog title={title} submitLabel={submitLabel} submitVariant="destructive-solid" onClose={onClose} onSubmit={submit}>
      <p>{intro} This cannot be undone. You may be asked for a code from your authenticator app.</p>
      <TextAreaField id="action-reason" label="Reason" helper="Recorded in the audit log." value={reason} error={error} onChange={setReason} />
    </FormDialog>
  )
}
