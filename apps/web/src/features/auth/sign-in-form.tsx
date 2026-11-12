'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { TextField } from '../../components/form-field'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { afterSignInPath, defaultHome, safeNext, tenantSlug, type NextStep, type Realm } from '../../lib/navigation'
import { emailError, requiredError } from '../../lib/validation'

type Field = 'tenant' | 'email' | 'password'
type Values = Readonly<Record<Field, string>>
type Errors = Readonly<Partial<Record<Field, string>>>

interface SignInResponse {
  readonly expires_at: string
  readonly next_step: NextStep
}

const FIELDS: Readonly<Record<Realm, readonly Field[]>> = {
  tenant: ['tenant', 'email', 'password'],
  vendor: ['email', 'password'],
}
const ENDPOINT: Readonly<Record<Realm, string>> = { tenant: '/v1/auth/sessions', vendor: '/v1/auth/vendor-sessions' }
const TITLE: Readonly<Record<Realm, string>> = { tenant: 'Sign in to your company', vendor: 'Sign in to the operations console' }

function validate(field: Field, value: string): string | null {
  if (field === 'email') return emailError(value)
  return requiredError(field === 'tenant' ? 'your company sign-in name' : 'your password', value)
}

function bodyFor(realm: Realm, values: Values) {
  const credentials = { email: values.email.trim(), password: values.password }
  return realm === 'tenant' ? { tenant: values.tenant.trim().toLowerCase(), ...credentials } : credentials
}

const fieldId = (field: Field) => `signin-${field}`

/** SC-27 password step for the tenant realm (company + email + password) or the vendor realm. */
export function SignInForm({ realm }: { readonly realm: Realm }) {
  const api = useApi()
  const router = useRouter()
  const params = useSearchParams()
  const fields = FIELDS[realm]
  // An invitation link names the company: it is filled in and fixed, so nobody has to know the sign-in name.
  const knownTenant = realm === 'tenant' ? tenantSlug(params.get('tenant')) : null
  const [values, setValues] = useState<Values>({ tenant: knownTenant ?? '', email: '', password: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)

  const set = (field: Field, value: string) => setValues((current) => ({ ...current, [field]: value }))
  const blur = (field: Field) => {
    if (values[field] !== '') setErrors((current) => ({ ...current, [field]: validate(field, values[field]) ?? undefined }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found: Errors = Object.fromEntries(fields.flatMap((field) => {
      const message = validate(field, values[field])
      return message === null ? [] : [[field, message]]
    }))
    setErrors(found)
    const invalid = fields.filter((field) => found[field] !== undefined)
    if (invalid.length > 0) {
      setSummary(invalid.map((field) => ({ fieldId: fieldId(field), message: found[field]! })))
      return
    }
    setBusy(true)
    try {
      const { data } = await api.post<SignInResponse>(ENDPOINT[realm], bodyFor(realm, values))
      router.replace(afterSignInPath(data.next_step, safeNext(params.get('next')) ?? defaultHome(realm)))
    } catch (error) {
      const server = fieldErrors(error)
      const items = fields.filter((field) => server[field] !== undefined).map((field) => ({ fieldId: fieldId(field), message: server[field]! }))
      setSummary(items.length > 0 ? items : [{ message: errorMessage(error) }])
      setBusy(false)
    }
  }

  const field = (name: Field, label: string, props: { type: string; autoComplete: string; helper?: string; readOnly?: boolean }) => (
    <TextField
      readOnly={props.readOnly}
      id={fieldId(name)}
      label={label}
      type={props.type}
      autoComplete={props.autoComplete}
      helper={props.helper}
      value={values[name]}
      error={errors[name]}
      onChange={(event) => set(name, event.target.value)}
      onBlur={() => blur(name)}
      autoCapitalize="none"
      spellCheck={false}
    />
  )

  return (
    <>
      <h1 className="card-title">{TITLE[realm]}</h1>
      {params.get('reason') === 'signed_out' && <Banner tone="info">You are signed out.</Banner>}
      <form className="form" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        {realm === 'tenant' && field('tenant', 'Company', knownTenant === null
          ? { type: 'text', autoComplete: 'organization', helper: 'Your company’s sign-in name, for example acme.' }
          : { type: 'text', autoComplete: 'organization', helper: 'From your invitation link.', readOnly: true })}
        {field('email', 'Email address', { type: 'email', autoComplete: 'username' })}
        {field('password', 'Password', { type: 'password', autoComplete: 'current-password' })}
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>Sign in</Button>
        </div>
      </form>
    </>
  )
}
