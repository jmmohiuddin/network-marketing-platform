'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useApi } from '../../components/api-provider'
import { LinkButton, Button } from '../../components/button'
import { ErrorSummary, type SummaryItem } from '../../components/error-summary'
import { TextField } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { isApiError } from '../../lib/api'
import { errorMessage, fieldErrors } from '../../lib/messages'
import { tenantSignInPath, tenantSlug } from '../../lib/navigation'
import { PASSWORD_MIN_LENGTH, passwordError } from '../../lib/validation'

const PASSWORD_ID = 'invitation-password'
const CONFIRM_ID = 'invitation-confirm'
const TOKEN_MAX_LENGTH = 128

/** The one-time token from the URL fragment (#token=...), which browsers never send to a server. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token !== null && token.length > 0 && token.length <= TOKEN_MAX_LENGTH ? token : null
}

function Outcome({ title, children, signIn }: { readonly title: string; readonly children: string; readonly signIn?: string }) {
  return (
    <>
      <h1 className="card-title">{title}</h1>
      <p>{children}</p>
      {signIn !== undefined && <div className="form-actions"><LinkButton href={signIn} variant="primary">Go to sign-in</LinkButton></div>}
    </>
  )
}

function confirmError(password: string, confirm: string): string | null {
  return confirm === password ? null : 'Enter the same password in both fields.'
}

/**
 * ${WEB_URL}/invitation?tenant=<slug>#token=...: the invitee chooses a password (FR-IAM-003 invite), then signs in
 * with the company already filled in from ?tenant=.
 */
export function InvitationForm() {
  const api = useApi()
  // undefined: not read yet (server render); null: the link has no token.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string | null; confirm?: string | null }>({})
  const [summary, setSummary] = useState<readonly SummaryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'done' | 'invalid' | null>(null)
  const [tenant, setTenant] = useState<string | null>(null)

  useEffect(() => {
    const found = tokenFromHash(window.location.hash)
    // Keeps the first token read: a repeated effect (React StrictMode) finds the fragment already removed.
    setToken((current) => current ?? found)
    setTenant(tenantSlug(new URLSearchParams(window.location.search).get('tenant')))
    // The token leaves the address bar and the history entry, so it is not shown, bookmarked or synced.
    if (window.location.hash !== '') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = { password: passwordError(password), confirm: confirmError(password, confirm) }
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
      setOutcome('done')
    } catch (error) {
      if (isApiError(error, 'INVITATION_INVALID')) {
        setOutcome('invalid')
        return
      }
      const serverMessage = fieldErrors(error).password
      setSummary([serverMessage === undefined ? { message: errorMessage(error) } : { fieldId: PASSWORD_ID, message: serverMessage }])
      setBusy(false)
    }
  }

  if (token === undefined) return <LoadingState label="Reading your invitation" />
  if (token === null) {
    return <Outcome title="This invitation link is not complete">Open the link from your invitation email again. If it still does not work, ask your administrator for a new invitation.</Outcome>
  }
  if (outcome === 'done') return <Outcome title="Your password is set" signIn={tenantSignInPath(tenant)}>Sign in with your email address and the new password.</Outcome>
  if (outcome === 'invalid') {
    return <Outcome title="This invitation link does not work">It was already used, has expired or was replaced by a newer invitation. Ask your administrator for a new one.</Outcome>
  }
  return (
    <>
      <h1 className="card-title">Choose your password</h1>
      <p>You were invited to sign in to your company’s staff application. Choose a password to activate your account.</p>
      <form className="form" onSubmit={submit} noValidate>
        <ErrorSummary items={summary} />
        <TextField
          id={PASSWORD_ID}
          label="New password"
          type="password"
          autoComplete="new-password"
          helper={`At least ${PASSWORD_MIN_LENGTH} characters. A longer phrase is easier to remember and harder to guess.`}
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => password !== '' && setErrors((current) => ({ ...current, password: passwordError(password) }))}
        />
        <TextField
          id={CONFIRM_ID}
          label="Repeat the password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={busy}>Set password</Button>
        </div>
      </form>
    </>
  )
}
