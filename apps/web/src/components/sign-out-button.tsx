'use client'

import { useState } from 'react'
import { leavePage } from '../lib/leave-page'
import { errorMessage } from '../lib/messages'
import { signedOutPath, type Realm } from '../lib/navigation'
import { leaveSupportSession } from '../lib/support-session'
import { useApi } from './api-provider'
import { FOCUS_RING } from './button'
import { Icon } from './icon'

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
    <span className="relative flex items-center">
      {/* sc_01 sign-out control, with its text shown: only search, close and more may be icon-only. */}
      <button type="button" aria-busy={busy || undefined} disabled={busy} onClick={signOut}
        className={`flex items-center gap-space-xs p-1 text-secondary hover:text-error hover:bg-error-container rounded transition-colors disabled:opacity-60 ${FOCUS_RING}`}>
        <Icon name={busy ? 'sync' : 'logout'} size={18} className={busy ? 'motion-safe:animate-spin' : undefined} />
        <span className="font-body-sm text-body-sm">Sign out</span>
      </button>
      {error !== null && <span className="absolute right-0 top-full mt-1 w-64 p-space-xs rounded bg-error-container text-on-error-container font-caption text-caption shadow-sm" role="alert">{error}</span>}
    </span>
  )
}
