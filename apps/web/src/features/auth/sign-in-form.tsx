'use client'

import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { TextInput } from '../../components/form-field'
import { leavePage } from '../../lib/leave-page'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { afterSignInPath, defaultHome, safeNext, tenantSlug, type Realm } from '../../lib/navigation'
import { emailError, requiredError } from '../../lib/validation'
import { AuthHeader } from './auth-card'
import { FirebaseSignIn, type SignInSession } from './firebase-sign-in'

type Field = 'tenant' | 'email' | 'password'
type Values = Readonly<Record<Field, string>>
type Errors = Readonly<Partial<Record<Field, string>>>

const FIELDS: Readonly<Record<Realm, readonly Field[]>> = {
  tenant: ['tenant', 'email', 'password'],
  vendor: ['email', 'password'],
}
const ENDPOINT: Readonly<Record<Realm, string>> = { tenant: '/v1/auth/sessions', vendor: '/v1/auth/vendor-sessions' }
const TITLE: Readonly<Record<Realm, string>> = { tenant: 'Sign in to your company', vendor: 'Sign in to the operations console' }
const INTRO: Readonly<Record<Realm, string>> = {
  tenant: 'Enter your company’s sign-in name, your email address and your password.',
  vendor: 'Vendor staff only. Enter your email address and your password.',
}

function validate(field: Field, value: string): string | null {
  if (field === 'email') return emailError(value)
  return requiredError(field === 'tenant' ? 'your company sign-in name' : 'your password', value)
}

const companyOf = (values: Values) => values.tenant.trim().toLowerCase()

function bodyFor(realm: Realm, values: Values) {
  const credentials = { email: values.email.trim(), password: values.password }
  return realm === 'tenant' ? { tenant: companyOf(values), ...credentials } : credentials
}

const fieldId = (field: Field) => `signin-${field}`

export interface SignInFormProps {
  readonly realm: Realm
  /** The web server has FIREBASE_AUTH_DOMAIN (the CSP admits Firebase): only then is Firebase sign-in offered. */
  readonly firebase: boolean
}

/** SC-27 password step for the tenant realm (company + email + password) or the vendor realm. */
export function SignInForm({ realm, firebase }: SignInFormProps) {
  const api = useApi()
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

  // A full page load, not router.replace: the next page gets its own CSP, without the sign-in page's Firebase sources.
  const finish = (session: SignInSession) => leavePage(afterSignInPath(session.next_step, safeNext(params.get('next')) ?? defaultHome(realm)))

  /** Firebase sign-in needs the company first: its value, or null after showing what is wrong. */
  function requireCompany(): string | null {
    const message = validate('tenant', values.tenant)
    setErrors((current) => ({ ...current, tenant: message ?? undefined }))
    setSummary(message === null ? [] : [{ fieldId: fieldId('tenant'), message }])
    return message === null ? companyOf(values) : null
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
      const { data } = await api.post<SignInSession>(ENDPOINT[realm], bodyFor(realm, values))
      finish(data)
    } catch (error) {
      const server = fieldErrors(error)
      const items = fields.filter((field) => server[field] !== undefined).map((field) => ({ fieldId: fieldId(field), message: server[field]! }))
      setSummary(items.length > 0 ? items : [{ message: errorMessage(error) }])
      setBusy(false)
    }
  }

  const field = (name: Field, label: string, props: { type: string; autoComplete: string; helper?: string; readOnly?: boolean }) => (
    <TextInput
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
      <AuthHeader eyebrow={realm === 'vendor' ? 'Operations console' : 'Staff sign-in'} icon="lock" title={TITLE[realm]}>{INTRO[realm]}</AuthHeader>
      {params.get('reason') === 'signed_out' && <Banner tone="info">You are signed out.</Banner>}
      <form className="flex flex-col gap-space-md" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        {realm === 'tenant' && field('tenant', 'Company', knownTenant === null
          ? { type: 'text', autoComplete: 'organization', helper: 'Your company’s sign-in name, for example acme.' }
          : { type: 'text', autoComplete: 'organization', helper: 'From your invitation link.', readOnly: true })}
        {field('email', 'Email address', { type: 'email', autoComplete: 'username' })}
        {field('password', 'Password', { type: 'password', autoComplete: 'current-password' })}
        <Button type="submit" variant="primary" size="lg" icon="login" loading={busy} className="w-full" data-testid="primary-action">Sign in</Button>
      </form>
      {firebase && (
        <FirebaseSignIn realm={realm} company={realm === 'tenant' ? requireCompany : undefined} onSignedIn={finish}
          onError={(message) => setSummary(message === null ? [] : [{ message }])} />
      )}
    </>
  )
}
