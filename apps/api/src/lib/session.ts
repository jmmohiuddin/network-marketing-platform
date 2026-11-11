import { createHash, randomBytes } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.js'
import { auditInRealm } from './audit.js'
import type { Assurance, AuthContext, Realm, RoleGrant } from './auth.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID, type ActorContext } from './db.js'
import { isPermission, type Permission } from './permissions.js'

export const SESSION_COOKIE = 'nmp_session'
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/ // 32 bytes, base64url
const USER_AGENT_MAX = 512

/** SHA-256 of the opaque session token: the only form stored (session.token_hash). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export interface NewSession {
  readonly userId: string
  readonly tenantId: string | null
  readonly realm: Realm
  readonly absoluteMinutes: number
  readonly ip: string
  readonly userAgent: string | undefined
}

export interface IssuedSession {
  readonly id: string
  readonly token: string
  readonly expiresAt: Date
}

const newToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url')

/** Inserts a session (aal1, no factor yet) in the caller's realm transaction and returns its one-time token. */
export async function insertSession(tx: Tx, session: NewSession): Promise<IssuedSession> {
  const token = newToken()
  const { rows } = await tx.query<{ id: string; expires_at: Date }>(
    `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, 'aal1', now() + make_interval(mins => $5), $6, $7)
     RETURNING id, expires_at`,
    [hashToken(token), session.userId, session.tenantId, session.realm, session.absoluteMinutes, session.ip,
      session.userAgent?.slice(0, USER_AGENT_MAX) ?? null],
  )
  const row = rows[0]!
  return { id: row.id, token, expiresAt: row.expires_at }
}

/** HttpOnly, SameSite=Strict, Secure unless COOKIE_SECURE=false; lives no longer than the session's absolute expiry. */
export function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/', expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' })
}

/**
 * A new token for a live session; the old token stops working at once (ASVS V3.2.1: a new token when the
 * session is elevated by the second factor, so a token seen before MFA never reaches AAL2).
 */
export async function rotateSessionToken(tx: Tx, sessionId: string): Promise<IssuedSession> {
  const token = newToken()
  const { rows } = await tx.query<{ expires_at: Date }>(
    'UPDATE session SET token_hash = $2 WHERE id = $1 RETURNING expires_at',
    [sessionId, hashToken(token)],
  )
  return { id: sessionId, token, expiresAt: rows[0]!.expires_at }
}

/** Revokes a live session; false when it was already revoked. */
export async function revokeSession(tx: Tx, sessionId: string): Promise<boolean> {
  const { rowCount } = await tx.query('UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId])
  return rowCount === 1
}

interface SessionRow {
  id: string
  user_id: string
  tenant_id: string | null
  realm: string
  assurance_level: Assurance
  mfa_verified_at: Date | null
  step_up_at: Date | null
}

interface UserRow {
  state: string
  mfa_enrolled: boolean
  tenant_state: string | null
}

interface GrantRow {
  assignment_id: string
  role_id: string
  name: string
  permissions: string[]
  mfa_required: boolean
  market_ids: string[] | null
}

// Revoked by the platform, audited in the same transaction (actor: system).
async function revokeAudited(tx: Tx, session: SessionRow, action: string, reason: string): Promise<void> {
  if (!(await revokeSession(tx, session.id))) return
  await auditInRealm(tx, session.realm as Realm, { action, objectType: 'session', objectId: session.id, after: { reason } })
}

// Touch the session unless it has been idle too long; an idle session is revoked instead.
async function touch(tx: Tx, session: SessionRow, idleMinutes: number): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE session SET last_seen_at = now()
     WHERE id = $1 AND revoked_at IS NULL AND last_seen_at > now() - make_interval(mins => $2)`,
    [session.id, idleMinutes],
  )
  if (rowCount === 0) await revokeAudited(tx, session, 'AUTH.SESSION_EXPIRED', 'idle')
  return rowCount === 1
}

async function loadUser(tx: Tx, userId: string): Promise<UserRow | undefined> {
  const { rows } = await tx.query<UserRow>(
    `SELECT u.state, u.mfa_enrolled, t.state AS tenant_state
     FROM user_account u LEFT JOIN tenant t ON t.id = u.tenant_id WHERE u.id = $1`,
    [userId],
  )
  return rows[0]
}

async function loadGrants(tx: Tx, userId: string): Promise<GrantRow[]> {
  const { rows } = await tx.query<GrantRow>(
    `SELECT ra.id AS assignment_id, r.id AS role_id, r.name, r.permissions, r.mfa_required, ra.market_ids
     FROM role_assignment ra JOIN role r ON r.id = ra.role_id
     WHERE ra.user_id = $1 AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())
     ORDER BY r.name, ra.id`,
    [userId],
  )
  return rows
}

function toGrant(row: GrantRow): RoleGrant {
  return {
    assignmentId: row.assignment_id, roleId: row.role_id, name: row.name,
    permissions: row.permissions.filter(isPermission), marketIds: row.market_ids,
  }
}

function buildAuth(session: SessionRow, user: UserRow, grants: GrantRow[]): AuthContext {
  const realm = session.realm as Realm
  const roles = grants.map(toGrant)
  return {
    realm, tenantId: session.tenant_id, userId: session.user_id, sessionId: session.id, roles,
    permissions: new Set<Permission>(roles.flatMap((role) => role.permissions)),
    assurance: session.assurance_level,
    mfaRequired: realm === 'vendor' || grants.some((grant) => grant.mfa_required),
    mfaEnrolled: user.mfa_enrolled,
    mfaVerified: session.mfa_verified_at !== null,
    stepUpAt: session.step_up_at,
    supportSessionId: null,
  }
}

// One transaction in the session's own realm: idle check, user still active, tenant not archived, roles.
async function loadContext(tx: Tx, session: SessionRow, idleMinutes: number): Promise<AuthContext | null> {
  if (!(await touch(tx, session, idleMinutes))) return null
  const user = await loadUser(tx, session.user_id)
  if (user === undefined || user.state !== 'active' || user.tenant_state === 'archived') {
    const reason = user?.tenant_state === 'archived' ? 'tenant_archived' : 'user_inactive'
    await revokeAudited(tx, session, 'AUTH.SESSION_REVOKED', reason)
    return null
  }
  const grants = session.realm === 'tenant' ? await loadGrants(tx, session.user_id) : []
  return buildAuth(session, user, grants)
}

/** Resolves the session cookie into the caller's context, or null (no, unknown, expired or revoked session). */
export async function resolveAuth(request: FastifyRequest, config: Config): Promise<AuthContext | null> {
  const token = request.cookies[SESSION_COOKIE]
  if (token === undefined || !TOKEN_PATTERN.test(token)) return null
  const { rows } = await withSystem((tx) =>
    tx.query<SessionRow>(
      `SELECT id, user_id, tenant_id, realm, assurance_level, mfa_verified_at, step_up_at
       FROM auth_find_session($1)`,
      [hashToken(token)],
    ),
  )
  const session = rows[0]
  if (session === undefined) return null
  const idle = config.sessionIdleMinutes
  // The platform acts here (expiry, revocation), so the transaction's actor is the system, not the user.
  const actor: ActorContext = { actorType: 'system', requestId: request.id, supportSessionId: null }
  if (session.realm === 'tenant' && session.tenant_id !== null) {
    const ctx = { tenantId: session.tenant_id, userId: SYSTEM_ACTOR_ID, sessionId: session.id }
    return runInTenant(ctx, actor, (tx) => loadContext(tx, session, idle))
  }
  if (session.realm === 'vendor') return runInVendor(SYSTEM_ACTOR_ID, actor, (tx) => loadContext(tx, session, idle))
  return null // portal realm arrives in release B
}
