import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { marketScope, type AuthContext } from '../../lib/auth.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { getSession, REQUEST_TTL_MINUTES, sessionScope, type SupportSessionView } from './sessions.js'
import { inVendorThenTenant } from './vendor-tx.js'

export interface Decision {
  readonly approved: boolean
  /** Required when approving: the window, at most the requested minutes. */
  readonly minutes: number | null
  /** Explicit approval of a requester outside the tenant's region (AC-31.1, TS-57). */
  readonly regionApproved: boolean
  readonly reason: string | null
}

interface LockedRequest {
  state: string
  requested_minutes: number
  scope: unknown
  expired: boolean
  tenant_region: string
}

async function lockRequest(tx: Tx, id: string): Promise<LockedRequest> {
  const { rows } = await tx.query<LockedRequest>(
    `SELECT s.state, s.requested_minutes, s.scope, s.created_at <= now() - make_interval(mins => $2) AS expired,
            t.region AS tenant_region
     FROM support_session s JOIN tenant t ON t.id = s.tenant_id WHERE s.id = $1 FOR UPDATE OF s`,
    [id, REQUEST_TTL_MINUTES],
  )
  const locked = rows[0]
  if (locked === undefined) throw notFound()
  return locked
}

// The decider grants only what they hold over every market (as BR-SEC-05 for role grants); the window fits the
// request; a requester from another region needs the explicit region approval.
function assertApprovable(auth: AuthContext, locked: LockedRequest, decision: Decision): number {
  const minutes = decision.minutes
  if (minutes === null || minutes > locked.requested_minutes) {
    throw new ApiError(422, 'SUPPORT_SESSION_DURATION_INVALID', 'Approve for at most the requested number of minutes.', {
      requested_minutes: locked.requested_minutes,
    })
  }
  const scope = sessionScope.parse(locked.scope)
  if (!scope.permissions.every((permission) => marketScope(auth, permission) === null)) {
    throw new ApiError(422, 'SUPPORT_SCOPE_NOT_HELD', 'You can approve only access you hold yourself for all markets.')
  }
  if (scope.requester_region !== locked.tenant_region && !decision.regionApproved) {
    throw new ApiError(422, 'REGION_APPROVAL_REQUIRED', 'The requester works outside your data region. Approve the region explicitly.', {
      requester_region: scope.requester_region, tenant_region: locked.tenant_region,
    })
  }
  return minutes
}

async function writeDecision(tx: Tx, id: string, minutes: number | null): Promise<void> {
  // The window starts at approval: "approved for a set number of hours" (AC-29.1). First use marks it active.
  await tx.query(
    `UPDATE support_session
     SET state = CASE WHEN $2::int IS NULL THEN 'denied' ELSE 'approved' END,
         decided_by = current_setting('app.user_id')::uuid,
         starts_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
         ends_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(mins => $2) END
     WHERE id = $1`,
    [id, minutes],
  )
}

/** API-08 decision by a tenant admin (vendor_access.decide, step-up checked by the route). */
export async function decideSession(tx: Tx, auth: AuthContext, id: string, decision: Decision): Promise<SupportSessionView> {
  const locked = await lockRequest(tx, id)
  if (locked.state !== 'requested') throw new ApiError(409, 'REQUEST_ALREADY_DECIDED', 'This request has already been decided.')
  if (locked.expired) throw new ApiError(422, 'SUPPORT_REQUEST_EXPIRED', 'This request expired before a decision.')
  const minutes = decision.approved ? assertApprovable(auth, locked, decision) : null
  await writeDecision(tx, id, minutes)
  await recordAudit(tx, {
    action: decision.approved ? 'SUPPORT_SESSION.APPROVED' : 'SUPPORT_SESSION.DENIED',
    objectType: 'support_session', objectId: id, before: { state: locked.state },
    after: { minutes, region_approved: decision.regionApproved, factor_verified_at: auth.stepUpAt },
    ...(decision.reason === null ? {} : { reason: decision.reason }),
  })
  await enqueueOutbox(tx, { type: 'support_session.decided', key: id, payload: { support_session_id: id, approved: decision.approved } })
  return getSession(tx, id)
}

const notOpen = (): ApiError => new ApiError(409, 'SUPPORT_SESSION_NOT_OPEN', 'This support session is not open.')

/** "End session now" by a tenant admin: an approved or active session ends at once. */
export async function endSessionAsTenant(tx: Tx, id: string): Promise<SupportSessionView> {
  const session = await getSession(tx, id)
  const { rowCount } = await tx.query(
    `UPDATE support_session SET state = 'ended', ends_at = least(ends_at, now())
     WHERE id = $1 AND state IN ('approved', 'active')`,
    [id],
  )
  if (rowCount !== 1) throw notOpen()
  await recordAudit(tx, { action: 'SUPPORT_SESSION.ENDED', objectType: 'support_session', objectId: id, before: { state: session.state }, after: { by: 'tenant' } })
  await enqueueOutbox(tx, { type: 'support_session.ended', key: id, payload: { support_session_id: id } })
  return getSession(tx, id)
}

// Policy vendor_end and trigger support_session_vendor_may_only_end (0011): only the requester, active -> ended,
// ends_at only earlier. Vendor ops roles are undefined, so nobody else in the vendor realm ends a session.
async function endInVendorRealm(tx: Tx, id: string): Promise<{ tenantId: string }> {
  const { rows } = await tx.query<{ tenant_id: string }>(
    `UPDATE support_session SET state = 'ended', ends_at = least(ends_at, now())
     WHERE id = $1 AND state = 'active' AND requester_id = current_setting('app.user_id')::uuid
     RETURNING tenant_id`,
    [id],
  )
  if (rows[0] === undefined) {
    const stored = await tx.query<{ mine: boolean }>(
      `SELECT requester_id = current_setting('app.user_id')::uuid AS mine FROM support_session WHERE id = $1`,
      [id],
    )
    if (stored.rows[0] === undefined) throw notFound()
    throw stored.rows[0].mine ? notOpen() : permissionDenied()
  }
  await recordVendorAudit(tx, { action: 'SUPPORT_SESSION.ENDED', objectType: 'support_session', objectId: id, after: { by: 'vendor' } })
  return { tenantId: rows[0].tenant_id }
}

/** The vendor ends its active session: logged in the vendor log and in the tenant's log, one transaction. */
export function endSessionAsVendor(request: FastifyRequest, id: string): Promise<SupportSessionView> {
  return inVendorThenTenant(
    request,
    (tx) => endInVendorRealm(tx, id),
    async (tx) => {
      await recordAudit(tx, { action: 'SUPPORT_SESSION.ENDED', objectType: 'support_session', objectId: id, before: { state: 'active' }, after: { by: 'vendor' } })
      await enqueueOutbox(tx, { type: 'support_session.ended', key: id, payload: { support_session_id: id } })
      return getSession(tx, id)
    },
  )
}
