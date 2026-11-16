'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Checkbox, FieldError, RadioGroup, TextInput } from '../../components/form-field'
import { isApiError } from '../../lib/api'
import { errorMessage } from '../../lib/messages'
import { useResource } from '../../lib/use-resource'
import { requiredError } from '../../lib/validation'
import { FormDialog } from '../admin/form-dialog'
import { FIELDSET, LEGEND, NOTE } from '../admin/ui'
import { GraceField, graceError } from './key-dialogs'
import { API_KEY_OPTIONS_PATH, WEBHOOK_ENDPOINTS_PATH, WEBHOOK_TOPICS_PATH, type ApiKeyOptions, type IssuedSecret, type WebhookEndpoint, type WebhookTopic } from './types'

const URL_MAX = 2048
const DESCRIPTION_MAX = 200
const HTTPS = /^https:\/\/\S+$/i
const IDS = { url: 'endpoint-url', topics: 'endpoint-topics', description: 'endpoint-description', state: 'endpoint-state' }

export interface EndpointForm {
  readonly url: string
  readonly topics: ReadonlySet<string>
  readonly description: string
}

export function endpointErrors(form: EndpointForm): Readonly<Record<'url' | 'topics', string | null>> {
  return {
    url: requiredError('the endpoint URL', form.url) ?? (HTTPS.test(form.url.trim()) ? null : 'Enter an address that starts with https://.'),
    topics: form.topics.size === 0 ? 'Choose at least one event.' : null,
  }
}

/** URL, events (GET /v1/webhook-topics) and description; the URL refusal (WEBHOOK_URL_NOT_ALLOWED) shows at the field. */
function EndpointFields({ form, onChange, errors }: {
  readonly form: EndpointForm
  readonly onChange: (patch: Partial<EndpointForm>) => void
  readonly errors: Readonly<Record<string, string | null | undefined>>
}) {
  const topics = useResource<WebhookTopic[]>(WEBHOOK_TOPICS_PATH)
  const toggle = (topic: string, checked: boolean) =>
    onChange({ topics: new Set(checked ? [...form.topics, topic] : [...form.topics].filter((item) => item !== topic)) })
  return (
    <>
      <TextInput
        id={IDS.url} label="Endpoint URL" type="url" inputMode="url" autoComplete="off" maxLength={URL_MAX} placeholder="https://" data-autofocus
        helper="An https address on the public internet. Private, internal and loopback addresses are refused."
        value={form.url} error={errors.url} onChange={(event) => onChange({ url: event.target.value })}
      />
      <fieldset className={FIELDSET} id={IDS.topics} tabIndex={-1}>
        <legend className={LEGEND}>Events</legend>
        {topics.loading && <p className={NOTE}>Loading the events…</p>}
        {topics.error !== null && <FieldError message={errorMessage(topics.error)} />}
        {errors.topics != null && <FieldError message={errors.topics} />}
        {(topics.data ?? []).map((topic) => (
          <Checkbox
            key={topic.topic} label={topic.topic} helper={`${topic.description} Carries ${topic.payload_fields.join(', ')}.`}
            checked={form.topics.has(topic.topic)} onChange={(event) => toggle(topic.topic, event.target.checked)}
          />
        ))}
      </fieldset>
      <TextInput
        id={IDS.description} label="Description" optional maxLength={DESCRIPTION_MAX}
        value={form.description} onChange={(event) => onChange({ description: event.target.value })}
      />
    </>
  )
}

/** Runs a request; a WEBHOOK_URL_NOT_ALLOWED refusal also puts its reason under the URL field before rethrowing. */
async function withUrlRefusal(send: () => Promise<void>, setUrlError: (message: string) => void): Promise<void> {
  try {
    await send()
  } catch (error) {
    if (isApiError(error, 'WEBHOOK_URL_NOT_ALLOWED')) setUrlError(errorMessage(error))
    throw error
  }
}

/** POST /v1/webhook-endpoints (step-up, Idempotency-Key): the signing secret comes back once and goes to onIssued. */
export function CreateEndpointDialog({ onClose, onIssued }: { readonly onClose: () => void; readonly onIssued: (issued: IssuedSecret) => void }) {
  const api = useApi()
  const [form, setForm] = useState<EndpointForm>({ url: '', topics: new Set(), description: '' })
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const change = (patch: Partial<EndpointForm>) => setForm((current) => ({ ...current, ...patch }))
  function submit(idempotencyKey: string) {
    const found = endpointErrors(form)
    setErrors(found)
    const items = (['url', 'topics'] as const).flatMap((field) => (found[field] === null ? [] : [{ fieldId: IDS[field], message: found[field]! }]))
    if (items.length > 0) return { items }
    const body = { url: form.url.trim(), topics: [...form.topics], ...(form.description.trim() === '' ? {} : { description: form.description.trim() }) }
    return {
      items,
      fieldIds: IDS,
      send: () => withUrlRefusal(async () => {
        const { data } = await api.post<IssuedSecret>(WEBHOOK_ENDPOINTS_PATH, body, { idempotencyKey })
        onIssued(data)
      }, (message) => setErrors((current) => ({ ...current, url: message }))),
    }
  }
  return (
    <FormDialog title="Add webhook endpoint" size="lg" submitLabel="Add endpoint" onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>Each request is signed; the signing secret is shown once after the endpoint is added. Payloads carry ids only, never personal data. You may be asked for a code from your authenticator app.</p>
      <EndpointFields form={form} onChange={change} errors={errors} />
    </FormDialog>
  )
}

/** The fields PATCH /v1/webhook-endpoints/:id takes; only changed ones are sent. */
export interface EndpointChange {
  readonly url?: string
  readonly topics?: readonly string[]
  readonly description?: string | null
  readonly state?: 'active' | 'disabled'
}

/** What changed between the endpoint and the form, as the PATCH body. */
export function endpointChange(endpoint: WebhookEndpoint, form: EndpointForm, state: 'active' | 'disabled'): EndpointChange {
  const description = form.description.trim() === '' ? null : form.description.trim()
  const topics = [...form.topics]
  const sameTopics = topics.length === endpoint.topics.length && topics.every((topic) => endpoint.topics.includes(topic))
  return {
    ...(form.url.trim() === endpoint.url ? {} : { url: form.url.trim() }),
    ...(sameTopics ? {} : { topics }),
    ...(description === endpoint.description ? {} : { description }),
    ...(state === endpoint.state ? {} : { state }),
  }
}

/**
 * Edit an endpoint's URL, events, description and state (PATCH /v1/webhook-endpoints/:id). A new URL or enabling asks
 * for step-up; disabling cancels the attempts waiting for it. send runs the PATCH (see webhooks-tab).
 */
export function EditEndpointDialog({ endpoint, send, onClose, onSaved }: {
  readonly endpoint: WebhookEndpoint
  readonly send: (change: EndpointChange) => Promise<void>
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const [form, setForm] = useState<EndpointForm>({ url: endpoint.url, topics: new Set(endpoint.topics), description: endpoint.description ?? '' })
  const [state, setState] = useState(endpoint.state)
  const [errors, setErrors] = useState<Readonly<Record<string, string | null>>>({})
  const change = (patch: Partial<EndpointForm>) => setForm((current) => ({ ...current, ...patch }))
  function submit() {
    const found = endpointErrors(form)
    const body = endpointChange(endpoint, form, state)
    const nothing = Object.keys(body).length === 0 ? 'Nothing was changed.' : null
    setErrors(found)
    const items = [
      ...(['url', 'topics'] as const).flatMap((field) => (found[field] === null ? [] : [{ fieldId: IDS[field], message: found[field]! }])),
      ...(nothing === null ? [] : [{ message: nothing }]),
    ]
    if (items.length > 0) return { items }
    return {
      items,
      fieldIds: IDS,
      send: () => withUrlRefusal(async () => {
        await send(body)
        onSaved()
      }, (message) => setErrors((current) => ({ ...current, url: message }))),
    }
  }
  return (
    <FormDialog title="Edit webhook endpoint" size="lg" submitLabel="Save endpoint" onClose={onClose} onSubmit={submit}>
      <EndpointFields form={form} onChange={change} errors={errors} />
      <div id={IDS.state}>
        <RadioGroup
          legend="State" name="endpoint-state" value={state} onChange={(value) => setState(value === 'disabled' ? 'disabled' : 'active')}
          options={[
            { value: 'active', label: 'Active', helper: 'Events are delivered.' },
            { value: 'disabled', label: 'Disabled', helper: 'Nothing is sent; attempts waiting now are cancelled.' },
          ]}
        />
      </div>
      <p className={NOTE}>A new URL or enabling the endpoint may ask for a code from your authenticator app.</p>
    </FormDialog>
  )
}

/** POST /v1/webhook-endpoints/:id/rotate-secret {grace_minutes} (step-up): new secret shown once; both sign meanwhile. */
export function RotateSecretDialog({ endpoint, onClose, onIssued }: { readonly endpoint: WebhookEndpoint; readonly onClose: () => void; readonly onIssued: (issued: IssuedSecret) => void }) {
  const api = useApi()
  const options = useResource<ApiKeyOptions>(API_KEY_OPTIONS_PATH)
  const [grace, setGrace] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const max = options.data?.max_grace_minutes ?? null
  function submit(idempotencyKey: string) {
    const found = max === null ? 'The rotation limits could not be loaded. Close the dialog and try again.' : graceError(grace, max)
    setError(found)
    if (found !== null) return { items: [{ fieldId: 'secret-grace', message: found }] }
    return {
      items: [],
      fieldIds: { grace_minutes: 'secret-grace' },
      send: async () => {
        const { data } = await api.post<IssuedSecret>(`${WEBHOOK_ENDPOINTS_PATH}/${endpoint.id}/rotate-secret`, { grace_minutes: Number(grace.trim()) }, { idempotencyKey })
        onIssued(data)
      },
    }
  }
  return (
    <FormDialog title="Rotate signing secret" submitLabel="Rotate secret" onClose={onClose} onSubmit={submit}>
      <p>During the grace period each request carries a signature with the old and the new secret, so you can switch your receiver without losing events. You may be asked for a code from your authenticator app.</p>
      <GraceField id="secret-grace" value={grace} error={error} max={max} onChange={setGrace} subject="old secret" />
    </FormDialog>
  )
}
