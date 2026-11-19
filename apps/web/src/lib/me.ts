import { defaultHome, MFA_ENROL_PATH, MFA_VERIFY_PATH, PORTAL_HOME_PATH, withNext, type NavigationEntry, type Realm } from './navigation'

/** GET /v1/me (iam/me-routes.ts). */
export interface Me {
  readonly user: { readonly id: string; readonly email: string; readonly display_name: string | null }
  readonly tenant: { readonly id: string; readonly slug: string; readonly legal_name: string; readonly region: string; readonly state: string } | null
  readonly realm: Realm
  readonly roles: readonly { readonly assignment_id: string; readonly role_id: string; readonly name: string; readonly market_ids: readonly string[] | null }[]
  readonly permissions: readonly string[]
  readonly mfa: { readonly required: boolean; readonly enrolled: boolean; readonly verified: boolean }
  readonly step_up_at: string | null
  readonly navigation: readonly NavigationEntry[]
  /** Only inside an approved vendor support session; `user` is then the vendor user. */
  readonly support_session?: {
    readonly id: string
    readonly tenant_slug: string
    readonly ends_at: string
    readonly scope: { readonly permissions: readonly string[] }
  } | null
}

/** The MFA page the user must finish first (AC-35.1: no page before a required factor is enrolled), or null. */
export function pendingMfaPath(me: Me): string | null {
  if (me.mfa.required && !me.mfa.enrolled) return MFA_ENROL_PATH
  if (me.mfa.enrolled && !me.mfa.verified) return MFA_VERIFY_PATH
  return null
}

/**
 * Role home: the pending MFA page (carrying the realm's home as next, so a vendor user stays in the vendor realm),
 * else the first navigation entry; null when the user may open no page.
 */
export function homePath(me: Me): string | null {
  const mfa = pendingMfaPath(me)
  if (mfa !== null) return withNext(mfa, defaultHome(me.realm))
  return me.navigation[0]?.path ?? null
}

/** Where a shell for `realm` must send this user instead of rendering, or null: a portal user goes to the portal, others to '/'. */
export function shellRedirect(me: Me, realm: Realm): string | null {
  return pendingMfaPath(me) ?? (me.realm === realm ? null : me.realm === 'portal' ? PORTAL_HOME_PATH : '/')
}
