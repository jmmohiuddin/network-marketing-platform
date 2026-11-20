'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { LinkButton, Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { TextInput } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { isApiError } from '../../lib/api'
import { leavePage } from '../../lib/leave-page'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { PORTAL_SIGN_IN_PATH, tenantSignInPath, tenantSlug, VENDOR_SIGN_IN_PATH, type Realm } from '../../lib/navigation'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/validation'
import { errorText } from '../portal/format'
import { translator, type Locale, type Translate } from '../portal/i18n'
import { AuthHeader } from './auth-card'
import { portalQuery } from './portal-sign-in'

const PASSWORD_ID = 'invitation-password'
const CONFIRM_ID = 'invitation-confirm'
const TOKEN_MAX_LENGTH = 128

/** The one-time token from the URL fragment (#token=...), which browsers never send to a server. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token !== null && token.length > 0 && token.length <= TOKEN_MAX_LENGTH ? token : null
}

function Outcome({ title, children, signIn, t }: { readonly title: string; readonly children: string; readonly signIn?: string; readonly t: Translate }) {
  return (
    <>
      <AuthHeader eyebrow={t('invitation.eyebrow')} icon={signIn === undefined ? 'link_off' : 'how_to_reg'} title={title}>{children}</AuthHeader>
      {signIn !== undefined && <LinkButton href={signIn} variant="primary" size="lg" icon="login" className="w-full" data-testid="primary-action">{t('invitation.go_to_sign_in')}</LinkButton>}
    </>
  )
}

function signInPath(realm: Realm, tenant: string | null): string {
  return { tenant: tenantSignInPath(tenant), vendor: VENDOR_SIGN_IN_PATH, portal: `${PORTAL_SIGN_IN_PATH}${portalQuery(tenant, null, 'password')}` }[realm]
}

function passwordProblem(password: string, t: Translate): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return t('invitation.password_short', { count: PASSWORD_MIN_LENGTH })
  return password.length > PASSWORD_MAX_LENGTH ? t('invitation.password_long', { count: PASSWORD_MAX_LENGTH }) : null
}

function confirmError(password: string, confirm: string, t: Translate): string | null {
  return confirm === password ? null : t('invitation.confirm_mismatch')
}

/**
 * ${WEB_URL}/invitation?tenant=<slug>#token=...: the invitee chooses a password (FR-IAM-003 invite), then signs in
 * with the company already filled in from ?tenant=. A vendor user's link carries ?realm=vendor instead (BUG-011) and
 * leads to the vendor sign-in; a distributor's carries ?realm=portal (D-B5-03) and leads to the portal sign-in, in the
 * negotiated `locale` (D-BM-11; staff and vendor invitations stay English, the default).
 */
export function InvitationForm({ locale = 'en' }: { readonly locale?: Locale }) {
  const api = useApi()
  const t = translator(locale)
  // undefined: not read yet (server render); null: the link has no token.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'done' | 'invalid' | null>(null)
  const [tenant, setTenant] = useState<string | null>(null)
  const [realm, setRealm] = useState<Realm>('tenant')

  useEffect(() => {
    const found = tokenFromHash(window.location.hash)
    // Keeps the first token read: a repeated effect (React StrictMode) finds the fragment already removed.
    setToken((current) => current ?? found)
    const query = new URLSearchParams(window.location.search)
    setTenant(tenantSlug(query.get('tenant')))
    const named = query.get('realm')
    setRealm(named === 'vendor' || named === 'portal' ? named : 'tenant')
    // The token leaves the address bar and the history entry, so it is not shown, bookmarked or synced.
    if (window.location.hash !== '') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = { password: passwordProblem(password, t), confirm: confirmError(password, confirm, t) }
    setErrors(found)
    const items = [
      ...(found.password === null ? [] : [{ fieldId: PASSWORD_ID, message: found.password }]),
      ...(found.confirm === null ? [] : [{ fieldId: CONFIRM_ID, message: found.confirm }]),
    ]
    setSummary(items)
    if (items.length > 0 || typeof token !== 'string') return
    setBusy(true)
    try {
      await api.post('/v1/auth/invitations/accept', { token, password })
      // A member goes straight to the portal sign-in with the password form (PLAN B5 §5 SC-27); staff see the outcome card.
      if (realm === 'portal') {
        leavePage(signInPath('portal', tenant))
        return
      }
      setOutcome('done')
    } catch (error) {
      if (isApiError(error, 'INVITATION_INVALID')) {
        setOutcome('invalid')
        return
      }
      const serverMessage = fieldErrors(error).password
      // The portal words errors by code (D-BM-11); staff read the API's own sentence.
      if (realm === 'portal') setSummary([{ message: errorText(error, t) }])
      else setSummary([serverMessage === undefined ? { message: errorMessage(error) } : { fieldId: PASSWORD_ID, message: serverMessage }])
      setBusy(false)
    }
  }

  if (token === undefined) return <LoadingState label={t('invitation.loading')} />
  if (token === null) return <Outcome t={t} title={t('invitation.incomplete')}>{t('invitation.incomplete_text')}</Outcome>
  if (outcome === 'done') return <Outcome t={t} title={t('invitation.done')} signIn={signInPath(realm, tenant)}>{t('invitation.done_text')}</Outcome>
  if (outcome === 'invalid') return <Outcome t={t} title={t('invitation.invalid')}>{t('invitation.invalid_text')}</Outcome>
  return (
    <>
      <AuthHeader eyebrow={t('invitation.eyebrow')} icon="key" title={t('invitation.title')}>
        {t('invitation.intro', { place: t(`invitation.to.${realm}`) })}
      </AuthHeader>
      <form className="flex flex-col gap-space-md" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} title={t('auth.problem')} />
        <TextInput
          id={PASSWORD_ID}
          label={t('invitation.password')}
          type="password"
          autoComplete="new-password"
          helper={t('invitation.password_helper', { count: PASSWORD_MIN_LENGTH })}
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => password !== '' && setErrors((current) => ({ ...current, password: passwordProblem(password, t) }))}
        />
        <TextInput
          id={CONFIRM_ID}
          label={t('invitation.confirm')}
          type="password"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <Button type="submit" variant="primary" size="lg" icon="check" loading={busy} className="w-full" data-testid="primary-action">{t('invitation.submit')}</Button>
      </form>
    </>
  )
}
