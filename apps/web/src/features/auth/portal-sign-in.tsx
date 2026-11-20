'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { TextInput } from '../../components/form-field'
import { leavePage } from '../../lib/leave-page'
import { fieldErrors } from '../../lib/messages'
import { afterSignInPath, PORTAL_HOME_PATH, realmOf, safeNext, tenantSlug } from '../../lib/navigation'
import { errorText } from '../portal/format'
import { translator, type Locale, type Translate } from '../portal/i18n'
import { AuthHeader } from './auth-card'
import { emailProblem, passwordProblem } from './credentials'
import { FirebaseSignIn, type SignInSession } from './firebase-sign-in'

export const PORTAL_CODE_PATH = '/portal/signin/code'

/** A safe path inside the portal (safeNext output: never its sign-in pages). */
const isPortalPath = (path: string | null): boolean => realmOf(path) === 'portal'

/** Where a portal sign-in continues: a safe ?next= inside the portal, else the portal home. */
export function portalTarget(next: string | null): string {
  const target = safeNext(next)
  return target !== null && isPortalPath(target) ? target : PORTAL_HOME_PATH
}

/** ?tenant= and ?next= carried between the portal sign-in pages (and ?method=password to open the password form). */
export function portalQuery(tenant: string | null, next: string | null, method?: 'password'): string {
  const query = new URLSearchParams()
  if (tenant !== null) query.set('tenant', tenant)
  if (next !== null && isPortalPath(safeNext(next))) query.set('next', next)
  if (method !== undefined) query.set('method', method)
  const text = query.toString()
  return text === '' ? '' : `?${text}`
}

/** The company and email of a code sign-in, kept for the code page in this tab only (never in the URL). */
export interface PendingCode {
  readonly tenant: string
  readonly email: string
}

const PENDING_KEY = 'nmp-portal-sign-in'

export function savePendingCode(pending: PendingCode | null): void {
  try {
    if (pending === null) window.sessionStorage.removeItem(PENDING_KEY)
    else window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // Storage blocked: the code page then asks to start again.
  }
}

export function readPendingCode(): PendingCode | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(PENDING_KEY) ?? 'null') as Partial<PendingCode> | null
    return typeof value?.tenant === 'string' && typeof value.email === 'string' ? { tenant: value.tenant, email: value.email } : null
  } catch {
    return null
  }
}

export const PORTAL_CODES_ENDPOINT = '/v1/auth/portal-codes'
export const PORTAL_SESSIONS_ENDPOINT = '/v1/auth/portal-sessions'

type Field = 'tenant' | 'email' | 'password'
type Method = 'code' | 'password'
const fieldId = (field: Field) => `portal-${field}`

function validate(field: Field, value: string, t: Translate): string | null {
  if (field === 'email') return emailProblem(value, t)
  if (field === 'password') return passwordProblem(value, t)
  return value.trim() === '' ? t('auth.company_required') : null
}

/**
 * SC-27 portal sign-in (FR-IAM-007, D-B5-03): the email, then "Email me a code" (the default) or "Use password". Every
 * failure reads the same; the code request always answers alike, so the page never tells whether an account exists.
 */
export function PortalSignIn({ firebase, locale }: { readonly firebase: boolean; readonly locale: Locale }) {
  const api = useApi()
  const t = translator(locale)
  const router = useRouter()
  const params = useSearchParams()
  const knownTenant = tenantSlug(params.get('tenant'))
  const next = params.get('next')
  const [method, setMethod] = useState<Method>(params.get('method') === 'password' ? 'password' : 'code')
  const [values, setValues] = useState<Readonly<Record<Field, string>>>({ tenant: knownTenant ?? '', email: '', password: '' })
  const [errors, setErrors] = useState<Readonly<Partial<Record<Field, string>>>>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const fields: readonly Field[] = [...(knownTenant === null ? ['tenant' as const] : []), 'email', ...(method === 'password' ? ['password' as const] : [])]
  const company = () => values.tenant.trim().toLowerCase()
  const set = (field: Field, value: string) => setValues((current) => ({ ...current, [field]: value }))

  // A full page load: the portal then runs under its own CSP, without the sign-in page's Firebase sources.
  const finish = (session: SignInSession) => leavePage(afterSignInPath(session.next_step, portalTarget(next)))

  function check(only: readonly Field[]): boolean {
    const found = Object.fromEntries(only.flatMap((field) => {
      const message = validate(field, values[field], t)
      return message === null ? [] : [[field, message]]
    })) as Partial<Record<Field, string>>
    setErrors(found)
    setSummary(only.filter((field) => found[field] !== undefined).map((field) => ({ fieldId: fieldId(field), message: found[field]! })))
    return Object.keys(found).length === 0
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!check(fields)) return
    setBusy(true)
    const credentials = { tenant: company(), email: values.email.trim() }
    try {
      if (method === 'code') {
        await api.post(PORTAL_CODES_ENDPOINT, credentials)
        savePendingCode(credentials)
        router.push(`${PORTAL_CODE_PATH}${portalQuery(knownTenant ?? credentials.tenant, next)}`)
        return
      }
      const { data } = await api.post<SignInSession>(PORTAL_SESSIONS_ENDPOINT, { ...credentials, password: values.password })
      finish(data)
    } catch (error) {
      const server = fieldErrors(error)
      const items = fields.filter((field) => server[field] !== undefined).map((field) => ({ fieldId: fieldId(field), message: server[field]! }))
      setSummary(items.length > 0 ? items : [{ message: errorText(error, t) }])
      setBusy(false)
    }
  }

  const switchTo = (other: Method) => {
    setMethod(other)
    setSummary([])
    setErrors({})
  }

  return (
    <>
      <AuthHeader eyebrow={t('auth.eyebrow')} icon="lock" title={t('auth.title')}>
        {method === 'code' ? t('auth.intro_code') : t('auth.intro_password')}
      </AuthHeader>
      {params.get('reason') === 'signed_out' && <Banner tone="info">{t('auth.signed_out')}</Banner>}
      <form className="flex flex-col gap-space-md" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} title={t('auth.problem')} />
        {knownTenant === null
          ? <TextInput id={fieldId('tenant')} label={t('auth.company')} helper={t('auth.company_helper')} autoComplete="organization" autoCapitalize="none" spellCheck={false}
            value={values.tenant} error={errors.tenant} onChange={(event) => set('tenant', event.target.value)} />
          : <TextInput id={fieldId('tenant')} label={t('auth.company')} readOnly value={knownTenant} helper={t('auth.company_from_link')} />}
        <TextInput id={fieldId('email')} label={t('auth.email')} type="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={values.email} error={errors.email} onChange={(event) => set('email', event.target.value)} />
        {method === 'password' && (
          <TextInput id={fieldId('password')} label={t('auth.password')} type="password" autoComplete="current-password"
            value={values.password} error={errors.password} onChange={(event) => set('password', event.target.value)} />
        )}
        <Button type="submit" variant="primary" size="lg" icon={method === 'code' ? 'mail' : 'login'} loading={busy} className="w-full" data-testid="primary-action">
          {method === 'code' ? t('auth.email_code') : t('auth.sign_in')}
        </Button>
        <Button variant="tertiary" className="self-center" onClick={() => switchTo(method === 'code' ? 'password' : 'code')}>
          {method === 'code' ? t('auth.use_password') : t('auth.code_instead')}
        </Button>
      </form>
      {firebase && (
        <FirebaseSignIn realm="portal" company={() => (check(knownTenant === null ? ['tenant'] : []) ? company() : null)} onSignedIn={finish}
          onError={(message) => setSummary(message === null ? [] : [{ message }])} locale={locale} />
      )}
    </>
  )
}
