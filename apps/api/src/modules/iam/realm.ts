import type { Tx } from '@nmp/db'
import type { Realm } from '../../lib/auth.js'
import { runInTenant, runInVendor } from '../../lib/db.js'

/** A user identified before a session exists (sign-in, invitation). */
export interface KnownUser {
  readonly userId: string
  readonly tenantId: string | null
  readonly realm: Realm
  /** Portal accounts: their participant (D-B5-02), else null. */
  readonly participantId: string | null
}

/**
 * Runs fn as that user in their own realm: tenant users in their tenant, vendor users in the vendor realm, portal users
 * in their tenant with their participant set (the self-scope policies apply, and auth_open_session opens a portal session).
 */
export function asUser<T>(user: KnownUser, requestId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (user.realm === 'vendor' || user.tenantId === null) {
    return runInVendor(user.userId, { actorType: 'vendor_user', requestId, supportSessionId: null }, fn)
  }
  const ctx = { tenantId: user.tenantId, userId: user.userId, ...(user.participantId === null ? {} : { participantId: user.participantId }) }
  return runInTenant(ctx, { actorType: 'user', requestId, supportSessionId: null }, fn)
}
