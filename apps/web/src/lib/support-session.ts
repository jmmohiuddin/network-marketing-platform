import type { Me } from './me'
import { isAuthPage, realmOf } from './navigation'

/** The vendor console page a support session starts from and returns to. */
export const SUPPORT_SESSIONS_PATH = '/vendor/support-sessions'
/** Names the session on tenant reads (apps/api support/access.ts SUPPORT_SESSION_HEADER). */
export const SUPPORT_SESSION_HEADER = 'X-Support-Session'

// Per browser tab and gone when the tab closes: a session is opened in one tab, on purpose (FR-IAM-005).
const STORAGE_KEY = 'nmp-support-session-id'

/** The support session the tenant app is read in, as GET /v1/me states it inside that session. */
export interface SupportSessionFrame {
  readonly id: string
  readonly tenantSlug: string
  /** ISO; the window the tenant approved. */
  readonly endsAt: string
}

/** The id of the session this tab opened the tenant app with ("Open tenant app" on SC-39), or null. */
export function storedSupportSession(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const id = window.sessionStorage.getItem(STORAGE_KEY)
    return id === null || id === '' ? null : id
  } catch {
    return null
  }
}

export function enterSupportSession(id: string): void {
  window.sessionStorage.setItem(STORAGE_KEY, id)
}

export function leaveSupportSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: nothing was stored either.
  }
}

/** The session id to send from this page: tenant app pages only, never the vendor console or sign-in pages. */
export function supportSessionFor(pathname: string): string | null {
  if (realmOf(pathname) !== 'tenant' || isAuthPage(pathname)) return null
  return storedSupportSession()
}

/** The frame to draw around the tenant app: only what the server confirms (GET /v1/me inside the session). */
export function supportFrameOf(me: Me): SupportSessionFrame | null {
  const session = me.support_session
  if (session == null || me.realm !== 'tenant') return null
  return { id: session.id, tenantSlug: session.tenant_slug, endsAt: session.ends_at }
}

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

/** Time left as hh:mm, rounded up to the minute ("02:41"); "00:00" once it has passed. */
export function countdownLabel(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / MS_PER_MINUTE))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(minutes / MINUTES_PER_HOUR))}:${pad(minutes % MINUTES_PER_HOUR)}`
}
