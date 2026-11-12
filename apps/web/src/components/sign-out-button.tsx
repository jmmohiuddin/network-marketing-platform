'use client'

import { useState } from 'react'
import { leavePage } from '../lib/leave-page'
import { errorMessage } from '../lib/messages'
import { signedOutPath, type Realm } from '../lib/navigation'
import { leaveSupportSession } from '../lib/support-session'
import { useApi } from './api-provider'
import { Button } from './button'

/** Ends the session (DELETE /v1/auth/sessions/current) and reloads the realm's sign-in page. */
export function SignOutButton({ realm }: { readonly realm: Realm }) {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signOut() {
    setBusy(true)
    setError(null)
    try {
      await api.delete('/v1/auth/sessions/current')
      leaveSupportSession()
      leavePage(signedOutPath(realm))
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }
  return (
    <span className="sign-out">
      <Button variant="tertiary" loading={busy} onClick={signOut}>Sign out</Button>
      {error !== null && <span className="field-error" role="alert">{error}</span>}
    </span>
  )
}
