'use client'

import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { RadioGroup, TextInput } from '../../components/form-field'
import { Icon } from '../../components/icon'
import { newIdempotencyKey } from '../../lib/api'
import { tenantSlug } from '../../lib/navigation'
import { emailError, requiredError } from '../../lib/validation'
import { summaryOf, TextAreaField } from '../admin/form-dialog'
import { AuthHeader } from '../auth/auth-card'
import { REQUEST_TYPES, TYPE_HELP, TYPE_LABELS } from './format'
import type { RequestType } from './types'

const IDS = { tenant: 'request-company', type: 'request-type', name: 'request-name', email: 'request-email', ref: 'request-ref', details: 'request-details' } as const
const NAME_MAX = 200
const EMAIL_MAX = 320
const REF_MAX = 100
const DETAILS_MAX = 2000

type Field = keyof typeof IDS
type Values = Readonly<Record<Field, string>>

function validate(values: Values): Readonly<Partial<Record<Field, string>>> {
  const found: Partial<Record<Field, string | null>> = {
    tenant: requiredError('the company name', values.tenant),
    type: values.type === '' ? 'Choose what you ask for.' : null,
    name: requiredError('your full name', values.name),
    email: emailError(values.email),
    details: values.type === 'correction' ? requiredError('what should be corrected', values.details) : null,
  }
  return Object.fromEntries(Object.entries(found).filter(([, message]) => message !== null)) as Partial<Record<Field, string>>
}

const optional = (value: string) => (value.trim() === '' ? undefined : value.trim())

/**
 * SC-41 public privacy request (FR-PRV-001, POST /v1/public/privacy-requests): request type, name, email, member reference
 * and details. The answer is a reference number only: it never says whether the company knows the person.
 */
export function PublicRequestForm() {
  const api = useApi()
  const params = useSearchParams()
  const knownTenant = tenantSlug(params.get('tenant'))
  const [values, setValues] = useState<Values>({ tenant: knownTenant ?? '', type: '', name: '', email: '', ref: '', details: '' })
  const [errors, setErrors] = useState<Readonly<Partial<Record<Field, string>>>>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  // One Idempotency-Key per identical body: a retry after a lost answer is not recorded twice.
  const [attempt, setAttempt] = useState<{ readonly key: string; readonly body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [reference, setReference] = useState<string | null>(null)
  const set = (field: Field) => (value: string) => setValues((current) => ({ ...current, [field]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validate(values)
    setErrors(found)
    const items = (Object.keys(IDS) as Field[]).flatMap((field) => (found[field] === undefined ? [] : [{ fieldId: IDS[field], message: found[field]! }]))
    setSummary(items)
    if (items.length > 0) return
    const body = {
      tenant: values.tenant.trim().toLowerCase(), type: values.type, full_name: values.name.trim(), email: values.email.trim(),
      participant_ref: optional(values.ref), details: optional(values.details),
    }
    const text = JSON.stringify(body)
    const key = attempt !== null && attempt.body === text ? attempt.key : newIdempotencyKey()
    setAttempt({ key, body: text })
    setBusy(true)
    try {
      const { data } = await api.post<{ readonly reference: string }>('/v1/public/privacy-requests', body, { idempotencyKey: key })
      setReference(data.reference)
    } catch (error) {
      setSummary(summaryOf(error, { tenant: IDS.tenant, type: IDS.type, full_name: IDS.name, email: IDS.email, participant_ref: IDS.ref, details: IDS.details }))
    } finally {
      setBusy(false)
    }
  }

  if (reference !== null) {
    return (
      <>
        <AuthHeader eyebrow="Privacy request" icon="shield_person" title="Your request was sent" />
        <div className="bg-tertiary text-on-tertiary p-space-md rounded-lg flex items-start gap-space-sm" role="status" data-testid="request-reference">
          <Icon name="mark_email_read" size={24} className="shrink-0" />
          <div className="flex flex-col gap-space-xxs">
            <span className="font-data-mono-sm text-data-mono-sm text-tertiary-fixed font-medium">Request reference: {reference}</span>
            <p className="font-caption text-caption text-on-tertiary">Keep this reference. The answer comes to the email address you gave.</p>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <AuthHeader eyebrow="Privacy request" icon="shield_person" title="Make a privacy request">
        Ask for a copy of your personal data, a correction, its erasure, or a file you can take elsewhere. The company checks your identity before answering.
      </AuthHeader>
      <form className="flex flex-col gap-space-lg" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        {knownTenant === null && (
          <TextInput id={IDS.tenant} label="Company" helper="The company’s sign-in name, for example acme." autoCapitalize="none" spellCheck={false}
            value={values.tenant} error={errors.tenant} onChange={(event) => set('tenant')(event.target.value)} />
        )}
        <div id={IDS.type} tabIndex={-1}>
          <RadioGroup legend="What do you ask for?" name="request-type" value={values.type} error={errors.type} onChange={set('type')}
            options={REQUEST_TYPES.map((type: RequestType) => ({ value: type, label: TYPE_LABELS[type], helper: TYPE_HELP[type] }))} />
        </div>
        <TextInput id={IDS.name} label="Full name" autoComplete="name" maxLength={NAME_MAX} value={values.name} error={errors.name} onChange={(event) => set('name')(event.target.value)} />
        <TextInput id={IDS.email} label="Email address" type="email" autoComplete="email" maxLength={EMAIL_MAX} helper="The answer is sent here."
          value={values.email} error={errors.email} onChange={(event) => set('email')(event.target.value)} />
        <TextInput id={IDS.ref} label="Member reference" optional maxLength={REF_MAX} helper="Your distributor or customer number, if you have one."
          value={values.ref} onChange={(event) => set('ref')(event.target.value)} />
        <TextAreaField id={IDS.details} label="Details" optional={values.type !== 'correction'} maxLength={DETAILS_MAX}
          helper={values.type === 'correction' ? 'Say which data is wrong and what it should be.' : 'Anything that helps us find your data.'}
          value={values.details} error={errors.details ?? null} onChange={set('details')} />
        <Button type="submit" variant="primary" size="lg" icon="send" loading={busy} className="w-full sm:w-auto sm:self-end" data-testid="primary-action">Send request</Button>
      </form>
    </>
  )
}
