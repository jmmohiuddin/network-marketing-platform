'use client'

import { useState } from 'react'
import { leavePage } from '../lib/leave-page'
import { errorMessage } from '../lib/messages'
import { signedOutPath, type Realm } from '../lib/navigation'
import { leaveSupportSession } from '../lib/support-session'
import { useApi } from './api-provider'
import { FOCUS_RING } from './button'
import { Icon } from './icon'

export interface SignOut {
  readonly busy: boolean
  readonly error: string | null
  readonly signOut: () => Promise<void>
}

/**
 * Ends the session (DELETE /v1/auth/sessions/current) and reloads the realm's sign-in page; `tenant` (the company slug)
 * prefills the portal sign-in. For controls in another look than SignOutButton (the portal's More page).
 */
export function useSignOut(realm: Realm, tenant: string | null = null): SignOut {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signOut() {
    setBusy(true)
    setError(null)
    try {
      await api.delete('/v1/auth/sessions/current')
      leaveSupportSession()
      leavePage(signedOutPath(realm, tenant))
    } catch (failure) {
      setError(errorMessage(failure))
      setBusy(false)
    }
  }
  return { busy, error, signOut }
}

export function SignOutButton({ realm, tenant = null }: { readonly realm: Realm; readonly tenant?: string | null }) {
  const { busy, error, signOut } = useSignOut(realm, tenant)
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
