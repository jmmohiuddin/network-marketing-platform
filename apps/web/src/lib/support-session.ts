import type { Me } from './me'
import { isAuthPage, realmOf } from './navigation'

/** The vendor console page a support session starts from and returns to. */
export const SUPPORT_SESSIONS_PATH = '/vendor/support-sessions'
/** Names the session on tenant reads (apps/api support/access.ts SUPPORT_SESSION_HEADER). */
export const SUPPORT_SESSION_HEADER = 'X-Support-Session'

// Per browser tab and gone when the tab closes: a session is opened in one tab, on purpose (FR-IAM-005).
const STORAGE_KEY = 'nmp-support-session'

/** The support session a vendor user opened the tenant app with ("Open tenant app" on SC-39). */
export interface SupportSessionFrame {
  readonly id: string
  readonly tenantSlug: string
  /** ISO; the window the tenant approved. */
  readonly endsAt: string
  /** The vendor user (GET /v1/me inside a session does not return it). */
  readonly user: Me['user']
}

function isFrame(value: unknown): value is SupportSessionFrame {
  const frame = value as Partial<SupportSessionFrame> | null
  return typeof frame?.id === 'string' && typeof frame.tenantSlug === 'string' && typeof frame.endsAt === 'string'
    && typeof frame.user?.id === 'string' && typeof frame.user.email === 'string'
}

/** The stored session, or null (none, unreadable, or storage blocked). */
export function storedSupportSession(): SupportSessionFrame | null {
  if (typeof window === 'undefined') return null
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null')
    return isFrame(value) ? value : null
  } catch {
    return null
  }
}

export function enterSupportSession(frame: SupportSessionFrame): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(frame))
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
  return storedSupportSession()?.id ?? null
}

/**
 * The frame to draw around the tenant app: the stored session, once the server has confirmed it (inside a session
 * GET /v1/me answers in the tenant realm with the session as the only role assignment).
 */
export function supportFrameOf(me: Me): SupportSessionFrame | null {
  const frame = storedSupportSession()
  if (frame === null || me.realm !== 'tenant') return null
  return me.roles.some((role) => role.assignment_id === frame.id) ? frame : null
}

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

/** Time left as hh:mm, rounded up to the minute ("02:41"); "00:00" once it has passed. */
export function countdownLabel(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.ceil((Date.parse(endsAt) - now) / MS_PER_MINUTE))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(minutes / MINUTES_PER_HOUR))}:${pad(minutes % MINUTES_PER_HOUR)}`
}
