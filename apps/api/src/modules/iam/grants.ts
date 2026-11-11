import type { Tx } from '@nmp/db'
import type { AuthContext } from '../../lib/auth.js'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { assertAdminRemains } from './admins.js'
import { findRole, holdsWithin, type RoleView } from './roles.js'

export interface GrantInput {
  readonly roleId: string
  readonly marketIds: readonly string[] | null
  readonly validTo: Date | null
}

export interface AssignmentView {
  id: string
  user_id: string
  role_id: string
  market_ids: string[] | null
  valid_from: Date
  valid_to: Date | null
  approval_id: string | null
}

export interface GrantRequestView {
  id: string
  user_id: string
  role_id: string
  market_ids: string[] | null
  valid_to: Date | null
  requested_by: string
  state: 'pending' | 'approved' | 'rejected'
  approval_id: string | null
  decided_at: Date | null
  created_at: Date
}

export type GrantOutcome =
  | { readonly kind: 'assignment'; readonly assignment: AssignmentView }
  | { readonly kind: 'request'; readonly request: GrantRequestView }

const ASSIGNMENT_COLUMNS = 'id, user_id, role_id, market_ids, valid_from, valid_to, approval_id'
const REQUEST_COLUMNS = 'id, user_id, role_id, market_ids, valid_to, requested_by, state, approval_id, decided_at, created_at'
const ADMIN_PERMISSION = 'user.manage'

async function assertGrantee(tx: Tx, userId: string): Promise<void> {
  const { rows } = await tx.query<{ state: string }>('SELECT state FROM user_account WHERE id = $1', [userId])
  if (rows[0] === undefined) throw notFound()
  if (rows[0].state === 'deactivated') {
    throw new ApiError(409, 'USER_DEACTIVATED', 'Roles cannot be granted to a deactivated user.')
  }
}

async function assignableRole(tx: Tx, roleId: string): Promise<RoleView> {
  const role = await findRole(tx, roleId)
  if (role === null) throw new ApiError(422, 'ROLE_UNKNOWN', 'The role does not exist.')
  return role
}

// AC-36.2 scope: every market must be one of the tenant's own (RLS hides other tenants' markets).
async function assertMarkets(tx: Tx, marketIds: readonly string[] | null): Promise<void> {
  if (marketIds === null) return
  const unique = [...new Set(marketIds)]
  const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM market WHERE id = ANY ($1::uuid[])', [unique])
  if (rows[0]!.n !== unique.length) throw new ApiError(422, 'MARKET_UNKNOWN', 'One or more markets do not exist.')
}

async function insertAssignment(tx: Tx, userId: string, input: GrantInput, approvalId: string | null) {
  const { rows } = await tx.query<AssignmentView>(
    `INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from, valid_to, approval_id, created_by)
     VALUES (app_tenant_id(), $1, $2, $3, now(), $4, $5, current_setting('app.user_id')::uuid)
     RETURNING ${ASSIGNMENT_COLUMNS}`,
    [userId, input.roleId, input.marketIds, input.validTo, approvalId],
  )
  return rows[0]!
}

/**
 * API-40 role grant (FR-IAM-003). A role is assigned at once only when it is not an admin or approver role
 * (SEC-27) and the granter holds every permission in it over every market granted (BR-SEC-05, SEC-26).
 * Otherwise it becomes a pending request that a different admin must approve (AC-36.1): nobody grants alone
 * what they do not hold, nor a wider market scope than their own.
 */
export async function grantRole(tx: Tx, auth: AuthContext, userId: string, input: GrantInput): Promise<GrantOutcome> {
  await assertGrantee(tx, userId)
  const role = await assignableRole(tx, input.roleId)
  await assertMarkets(tx, input.marketIds)
  const scope = { role_id: role.id, role: role.name, market_ids: input.marketIds }
  if (!role.privileged && holdsWithin(auth, role.permissions, input.marketIds)) {
    const assignment = await insertAssignment(tx, userId, input, null)
    await recordAudit(tx, { action: 'ROLE.GRANTED', objectType: 'role_assignment', objectId: assignment.id, after: { user_id: userId, ...scope } })
    return { kind: 'assignment', assignment }
  }
  const { rows } = await tx.query<GrantRequestView>(
    `INSERT INTO role_grant_request (tenant_id, user_id, role_id, market_ids, valid_to, requested_by, state)
     VALUES (app_tenant_id(), $1, $2, $3, $4, current_setting('app.user_id')::uuid, 'pending')
     RETURNING ${REQUEST_COLUMNS}`,
    [userId, role.id, input.marketIds, input.validTo],
  )
  const request = rows[0]!
  await recordAudit(tx, { action: 'ROLE_GRANT.REQUESTED', objectType: 'role_grant_request', objectId: request.id, after: { user_id: userId, ...scope } })
  await enqueueOutbox(tx, { type: 'iam.role_grant.requested', key: request.id, payload: { request_id: request.id } })
  return { kind: 'request', request }
}

export interface Decision {
  readonly decision: 'approved' | 'rejected'
  readonly reason: string | null
}

// expired: valid_to has passed (database clock, the one the assignment's CHECK uses).
async function lockRequest(tx: Tx, requestId: string): Promise<GrantRequestView & { expired: boolean }> {
  const { rows } = await tx.query<GrantRequestView & { expired: boolean }>(
    `SELECT ${REQUEST_COLUMNS}, coalesce(valid_to <= now(), false) AS expired FROM role_grant_request WHERE id = $1 FOR UPDATE`,
    [requestId],
  )
  if (rows[0] === undefined) throw notFound()
  if (rows[0].state !== 'pending') throw new ApiError(409, 'REQUEST_ALREADY_DECIDED', 'This request has already been decided.')
  return rows[0]
}

async function insertApproval(tx: Tx, auth: AuthContext, request: GrantRequestView, decision: Decision): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason,
       factor_verified_at, decided_at, created_by)
     VALUES (app_tenant_id(), 'role_grant_request', $1, $2, $3, $4, $5, $6, now(), $3)
     RETURNING id`,
    [request.id, request.requested_by, auth.userId, decision.decision, decision.reason, auth.stepUpAt],
  )
  return rows[0]!.id
}

// SoD for release A (SECURITY_IAM_TENANCY C-3, C-4): neither the preparer nor the grantee decides.
function assertSeparateApprover(auth: AuthContext, request: GrantRequestView): void {
  if (auth.userId === request.requested_by || auth.userId === request.user_id) {
    throw new ApiError(422, 'SOD_SELF_APPROVAL', 'A grant must be decided by an admin who neither requested nor receives it.')
  }
}

async function applyApproval(tx: Tx, request: GrantRequestView, role: RoleView, approvalId: string) {
  await assertGrantee(tx, request.user_id)
  const input = { roleId: request.role_id, marketIds: request.market_ids, validTo: request.valid_to }
  const assignment = await insertAssignment(tx, request.user_id, input, approvalId)
  await recordAudit(tx, {
    action: 'ROLE.GRANTED', objectType: 'role_assignment', objectId: assignment.id,
    after: { user_id: request.user_id, role_id: role.id, role: role.name, approval_id: approvalId },
  })
  if (role.permissions.includes(ADMIN_PERMISSION)) {
    // SEC-27 / T2: alert on every new admin.
    await enqueueOutbox(tx, { type: 'iam.admin.granted', key: request.user_id, payload: { user_id: request.user_id, assignment_id: assignment.id } })
  }
  return assignment
}

/** Second-admin decision on a privileged grant (step-up checked by the route; factor time is recorded). */
export async function decideGrant(tx: Tx, auth: AuthContext, requestId: string, decision: Decision) {
  const request = await lockRequest(tx, requestId)
  assertSeparateApprover(auth, request)
  if (decision.decision === 'approved' && request.expired) {
    throw new ApiError(422, 'GRANT_EXPIRED', 'The requested end date has passed. Reject this request and request the grant again.')
  }
  const role = await assignableRole(tx, request.role_id)
  const approvalId = await insertApproval(tx, auth, request, decision)
  const { rows } = await tx.query<GrantRequestView>(
    `UPDATE role_grant_request SET state = $2, approval_id = $3, decided_at = now() WHERE id = $1 RETURNING ${REQUEST_COLUMNS}`,
    [request.id, decision.decision, approvalId],
  )
  await recordAudit(tx, {
    action: decision.decision === 'approved' ? 'ROLE_GRANT.APPROVED' : 'ROLE_GRANT.REJECTED',
    objectType: 'role_grant_request', objectId: request.id, after: { approval_id: approvalId }, ...(decision.reason === null ? {} : { reason: decision.reason }),
  })
  const assignment = decision.decision === 'approved' ? await applyApproval(tx, request, role, approvalId) : null
  return { request: rows[0]!, assignment }
}

// Cursor = (created_at to the millisecond, id): JSON dates carry milliseconds, so order and filter use the same precision.
export async function listGrantRequests(
  tx: Tx, state: GrantRequestView['state'] | undefined, after: { created_at: string; id: string } | undefined, limit: number,
): Promise<GrantRequestView[]> {
  const { rows } = await tx.query<GrantRequestView>(
    `SELECT ${REQUEST_COLUMNS} FROM role_grant_request
     WHERE ($1::text IS NULL OR state = $1)
       AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds', created_at), id) < ($2::timestamptz, $3::uuid))
     ORDER BY date_trunc('milliseconds', created_at) DESC, id DESC LIMIT $4`,
    [state ?? null, after?.created_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

/** Ends an active assignment now (valid_to); never the last admin grant. */
export async function revokeAssignment(tx: Tx, assignmentId: string): Promise<AssignmentView> {
  const { rows } = await tx.query<AssignmentView>(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignment ra
     WHERE id = $1 AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())`,
    [assignmentId],
  )
  if (rows[0] === undefined) throw notFound()
  await assertAdminRemains(tx, { assignmentId })
  const revoked = await tx.query<AssignmentView>(
    `UPDATE role_assignment SET valid_to = now() WHERE id = $1 RETURNING ${ASSIGNMENT_COLUMNS}`,
    [assignmentId],
  )
  await recordAudit(tx, {
    action: 'ROLE.REVOKED', objectType: 'role_assignment', objectId: assignmentId,
    before: { valid_to: rows[0].valid_to }, after: { user_id: rows[0].user_id, role_id: rows[0].role_id },
  })
  return revoked.rows[0]!
}
