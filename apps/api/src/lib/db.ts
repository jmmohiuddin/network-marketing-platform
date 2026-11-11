import { withTenant, withVendor, type TenantContext, type Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { currentAuth, type AuthContext } from './auth.js'
import { ApiError } from './errors.js'

export type ActorType = 'user' | 'vendor_user' | 'system'

/** app.user_id for work done by the platform itself (jobs, refused sign-ins); stored as actor NULL in audit. */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

/** Transaction-local facts that recordAudit copies into every audit event. */
export interface ActorContext {
  readonly actorType: ActorType
  readonly requestId: string | null
  readonly supportSessionId: string | null
}

async function setActorContext(tx: Tx, actor: ActorContext): Promise<void> {
  await tx.query(
    `SELECT set_config('app.actor_type', $1, true), set_config('app.request_id', $2, true),
            set_config('app.support_session_id', $3, true)`,
    [actor.actorType, actor.requestId ?? '', actor.supportSessionId ?? ''],
  )
}

/** One tenant transaction with the actor context set. Use inTenant(request, fn) inside routes. */
export function runInTenant<T>(ctx: TenantContext, actor: ActorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(ctx, async (tx) => {
    await setActorContext(tx, actor)
    return fn(tx)
  })
}

/** One vendor-realm transaction with the actor context set. */
export function runInVendor<T>(userId: string, actor: ActorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withVendor({ userId }, async (tx) => {
    await setActorContext(tx, actor)
    return fn(tx)
  })
}

// A vendor user stays a vendor_user actor inside a tenant's support session (the tenant log must not show it as one
// of the tenant's own users).
function actorOf(request: FastifyRequest, auth: AuthContext): ActorContext {
  return {
    actorType: auth.realm === 'vendor' || auth.supportSessionId !== null ? 'vendor_user' : 'user',
    requestId: request.id,
    supportSessionId: auth.supportSessionId,
  }
}

/** Runs fn in a transaction scoped to the caller's tenant (taken from the session, never from input). */
export function inTenant<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const auth = currentAuth(request)
  if (auth.tenantId === null) {
    throw new ApiError(403, 'REALM_FORBIDDEN', 'This endpoint is not available to your account type.')
  }
  const ctx = { tenantId: auth.tenantId, userId: auth.userId, sessionId: auth.sessionId }
  const supportSessionId = auth.supportSessionId
  if (supportSessionId === null) return runInTenant(ctx, actorOf(request, auth), fn)
  return runInTenant(ctx, actorOf(request, auth), async (tx) => {
    await assertSupportSessionOpen(tx, supportSessionId)
    return fn(tx)
  })
}

/**
 * A vendor works in a tenant only while its support session is open (QA E-SEC-04), so every transaction of an
 * in-session request checks it again. FOR SHARE: "End session now" waits for the read in flight.
 * shortcut: core reads support's support_session table directly (the check must run in the handler's own
 * transaction); move behind a hook the support module registers if lib grows a second such check.
 */
async function assertSupportSessionOpen(tx: Tx, id: string): Promise<void> {
  const { rowCount } = await tx.query(
    `SELECT 1 FROM support_session
     WHERE id = $1 AND state IN ('approved', 'active') AND now() >= starts_at AND now() < ends_at FOR SHARE`,
    [id],
  )
  if (rowCount !== 1) throw new ApiError(403, 'SUPPORT_SESSION_INACTIVE', 'Your support session is no longer open.')
}

/** Runs fn in a vendor-realm transaction for a vendor caller. */
export function inVendor<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const auth = currentAuth(request)
  if (auth.realm !== 'vendor') {
    throw new ApiError(403, 'REALM_FORBIDDEN', 'This endpoint is not available to your account type.')
  }
  return runInVendor(auth.userId, actorOf(request, auth), fn)
}

/** The caller's own realm: tenant users in their tenant, vendor users in the vendor realm. */
export function inOwnRealm<T>(request: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return currentAuth(request).realm === 'vendor' ? inVendor(request, fn) : inTenant(request, fn)
}
