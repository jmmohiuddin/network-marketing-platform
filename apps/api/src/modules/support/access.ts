import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { currentAuth, type AuthContext } from '../../lib/auth.js'
import { inVendor, runInTenant, runInVendor } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { parse } from '../../lib/http.js'
import { sessionScope } from './sessions.js'
import { enterTenant } from './vendor-tx.js'

/** A vendor user names the support session it works in with this header on tenant routes. */
export const SUPPORT_SESSION_HEADER = 'x-support-session'

const READ_METHODS = new Set(['GET', 'HEAD'])
const REFUSAL_STATUSES = new Set([401, 403])
const SESSION_ROLE = 'Support session'
// Decided and inside its window. lib/db.ts inTenant checks the same condition in every handler transaction.
const OPEN = `state IN ('approved', 'active') AND now() >= starts_at AND now() < ends_at`

interface SessionRow {
  id: string
  tenant_id: string
  requester_id: string
  scope: unknown
  open: boolean
}

function loadSession(request: FastifyRequest, id: string): Promise<SessionRow | undefined> {
  return inVendor(request, async (tx) => {
    const { rows } = await tx.query<SessionRow>(
      `SELECT id, tenant_id, requester_id, scope, ${OPEN} AS open FROM support_session WHERE id = $1`,
      [id],
    )
    return rows[0]
  })
}

// What was asked for (AC-29.1 "every query and screen view"): method, route pattern, path params, query string.
const accessed = (request: FastifyRequest) => ({
  method: request.method, route: request.routeOptions.url ?? null, params: request.params ?? null, query: request.query ?? null,
})

const inactive = (): ApiError => new ApiError(403, 'SUPPORT_SESSION_INACTIVE', 'You have no open support session for this tenant.')

interface Refusal {
  readonly sessionId: string | null
  /** The tenant whose log also records the refusal; null = vendor log only. */
  readonly tenantId: string | null
  readonly code: string
}

/**
 * AC-29.3, TS-37: a refused vendor request is logged in the vendor log and, when a session names a tenant, in
 * that tenant's log, in a transaction of its own (it commits although the request fails).
 */
async function logRefusal(request: FastifyRequest, userId: string, refusal: Refusal): Promise<void> {
  const event = {
    action: 'SUPPORT_SESSION.ACCESS_REFUSED',
    ...(refusal.sessionId === null ? {} : { objectType: 'support_session', objectId: refusal.sessionId }),
    after: { ...accessed(request), refusal: refusal.code },
  }
  const actor = { actorType: 'vendor_user' as const, requestId: request.id, supportSessionId: request.auth?.supportSessionId ?? null }
  await runInVendor(userId, actor, async (tx) => {
    await recordVendorAudit(tx, event)
    if (refusal.tenantId === null) return
    await enterTenant(tx, refusal.tenantId)
    await recordAudit(tx, event)
  })
}

async function refuse(request: FastifyRequest, auth: AuthContext, id: string, session: SessionRow | undefined, error: ApiError): Promise<never> {
  await logRefusal(request, auth.userId, { sessionId: id, tenantId: session?.tenant_id ?? null, code: error.code })
  throw error
}

/**
 * In the tenant's transaction, with the session row locked: still open (the tenant may have ended it since
 * loadSession), started on first use, and the access written to the tenant-visible session log (AC-29.1) before
 * the handler runs. false = no longer open, nothing written.
 */
function recordAccess(request: FastifyRequest, auth: AuthContext, session: SessionRow): Promise<boolean> {
  const ctx = { tenantId: session.tenant_id, userId: auth.userId, sessionId: auth.sessionId }
  const actor = { actorType: 'vendor_user' as const, requestId: request.id, supportSessionId: session.id }
  const about = { objectType: 'support_session', objectId: session.id }
  return runInTenant(ctx, actor, async (tx) => {
    const { rows } = await tx.query<{ state: string; open: boolean }>(
      `SELECT state, ${OPEN} AS open FROM support_session WHERE id = $1 FOR UPDATE`,
      [session.id],
    )
    if (rows[0]?.open !== true) return false
    if (rows[0].state === 'approved') {
      await tx.query(`UPDATE support_session SET state = 'active' WHERE id = $1`, [session.id])
      await recordAudit(tx, { action: 'SUPPORT_SESSION.STARTED', ...about, before: { state: 'approved' } })
    }
    await recordAudit(tx, { action: 'SUPPORT_SESSION.ACCESSED', ...about, after: accessed(request) })
    return true
  })
}

/**
 * The vendor caller as a member of the tenant for this request only: the session's permissions over all
 * markets, no step-up (nothing sensitive is confirmed inside a session), every audit event carrying the session.
 */
function inSession(auth: AuthContext, session: SessionRow): AuthContext {
  const { permissions } = sessionScope.parse(session.scope)
  const role = { assignmentId: session.id, roleId: session.id, name: SESSION_ROLE, permissions, marketIds: null }
  return {
    ...auth, realm: 'tenant', tenantId: session.tenant_id, roles: [role], permissions: new Set(permissions),
    stepUpAt: null, supportSessionId: session.id,
  }
}

/**
 * onRequest hook (FR-IAM-005, BR-SEC-01): a vendor user who sends X-Support-Session works in that tenant's
 * realm, read-only, while the session it requested is approved or active and inside its window. Anything else
 * is refused and logged in both logs. Requests without the header are left alone: tenant routes then refuse
 * the vendor realm (logged by logRefusedVendorRequest).
 */
export async function supportSessionAccess(request: FastifyRequest): Promise<void> {
  const header = request.headers[SUPPORT_SESSION_HEADER]
  if (header === undefined || request.auth?.realm !== 'vendor') return
  const auth = currentAuth(request)
  if (!auth.mfaVerified) return // a vendor user with MFA pending stays in the vendor realm (FR-IAM-005 pre-condition)
  const id = parse(z.uuid(), header)
  const session = await loadSession(request, id)
  if (session === undefined || !session.open || session.requester_id !== auth.userId) {
    return refuse(request, auth, id, session, inactive())
  }
  if (!READ_METHODS.has(request.method)) {
    return refuse(request, auth, id, session, new ApiError(403, 'SUPPORT_SESSION_READ_ONLY', 'Support sessions are read-only.'))
  }
  if (!(await recordAccess(request, auth, session))) return refuse(request, auth, id, session, inactive())
  request.auth = inSession(auth, session)
}

// Refusals the onRequest hook cannot see. Inside a session: any 401/403 of the route (a permission outside the
// scope, a session ended mid-request), both logs (FR-IAM-005 "blocked and logged"). A vendor user without a
// session whom a tenant route refuses: vendor log only, as no session names a tenant (E-ADR-22).
function refusalOf(auth: AuthContext, error: ApiError): Refusal | null {
  if (auth.supportSessionId !== null) {
    if (!REFUSAL_STATUSES.has(error.statusCode)) return null
    return { sessionId: auth.supportSessionId, tenantId: auth.tenantId, code: error.code }
  }
  if (auth.realm !== 'vendor' || error.code !== 'REALM_FORBIDDEN') return null
  return { sessionId: null, tenantId: null, code: 'NO_SESSION' }
}

/** onError hook (AC-29.3, TS-37): logs the refusals of refusalOf; the response is the route's own error. */
export async function logRefusedVendorRequest(request: FastifyRequest, _reply: FastifyReply, error: Error): Promise<void> {
  const auth = request.auth
  if (auth === null || !(error instanceof ApiError)) return
  const refusal = refusalOf(auth, error)
  if (refusal === null) return
  try {
    await logRefusal(request, auth.userId, refusal)
  } catch (logError) {
    request.log.error({ err: logError, refusal: refusal.code }, 'a refused vendor request could not be logged')
  }
}

/** Installs in-session access and vendor refusal logging on the whole app; call after session resolution. */
export function registerSupportSessionAccess(app: FastifyInstance): void {
  app.addHook('onRequest', supportSessionAccess)
  app.addHook('onError', logRefusedVendorRequest)
}
