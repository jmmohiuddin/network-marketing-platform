import { createHash, randomBytes } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.js'
import { auditInRealm } from './audit.js'
import type { Assurance, AuthContext, Realm, RoleGrant } from './auth.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID, type ActorContext } from './db.js'
import { unauthenticated } from './errors.js'
import { isPermission, type Permission } from './permissions.js'

export const SESSION_COOKIE = 'nmp_session'
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/ // 32 bytes, base64url
const USER_AGENT_MAX = 512
const INSUFFICIENT_PRIVILEGE = '42501'

/** SHA-256 of the opaque session token: the only form stored (session.token_hash). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export interface NewSession {
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

/**
 * Opens a session (aal1, no factor yet) for the transaction's acting user in its own realm and tenant, through
 * auth_open_session (nmp_app cannot insert sessions, migration 0041), and returns its one-time token.
 */
export async function insertSession(tx: Tx, session: NewSession): Promise<IssuedSession> {
  const token = newToken()
  const { rows } = await tx.query<{ session_id: string; session_expires_at: Date }>(
    'SELECT session_id, session_expires_at FROM auth_open_session($1, $2, $3, $4)',
    [hashToken(token), session.absoluteMinutes, session.ip, session.userAgent?.slice(0, USER_AGENT_MAX) ?? null],
  )
  const row = rows[0]!
  return { id: row.session_id, token, expiresAt: row.session_expires_at }
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
 * Records a second factor verified now on the caller's own live session: AAL2 and a fresh step_up_at, through
 * auth_elevate_session (nmp_app cannot write assurance columns, migration 0040). With rotate, the session is
 * replaced by a new one under a new token and the old token stops working at once (ASVS V3.2.1: a token seen
 * before MFA never reaches AAL2); the expiry stays that of the sign-in. Returns the new session, or null without
 * rotate (step-up keeps the token).
 */
export async function elevateSession(tx: Tx, sessionId: string, rotate: boolean): Promise<IssuedSession | null> {
  const token = rotate ? newToken() : null
  let row: { session_id: string; session_expires_at: Date }
  try {
    const { rows } = await tx.query<typeof row>(
      'SELECT session_id, session_expires_at FROM auth_elevate_session($1, $2)',
      [sessionId, token === null ? null : hashToken(token)],
    )
    row = rows[0]!
  } catch (error) {
    // The session ended since this request resolved it (revoked, expired, or replaced by a concurrent verification).
    if ((error as { code?: string }).code === INSUFFICIENT_PRIVILEGE) throw unauthenticated()
    throw error
  }
  return token === null ? null : { id: row.session_id, token, expiresAt: row.session_expires_at }
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
  participant_id: string | null
  /** Portal accounts: the participant is active and not pseudonymised (true otherwise). */
  participant_active: boolean
  /** Portal accounts: no owned position is anything but terminated (D-B5-06). */
  participant_terminated: boolean
}

interface GrantRow {
  assignment_id: string
  role_id: string
  name: string
  permissions: string[]
  mfa_required: boolean
  market_ids: string[] | null
  valid_to: Date | null
}

// Touch the session unless it has been idle too long; an idle session is revoked instead, audited in the same
// transaction (actor: system).
async function touch(tx: Tx, session: SessionRow, idleMinutes: number): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE session SET last_seen_at = now()
     WHERE id = $1 AND revoked_at IS NULL AND last_seen_at > now() - make_interval(mins => $2)`,
    [session.id, idleMinutes],
  )
  if (rowCount === 1) return true
  if (await revokeSession(tx, session.id)) {
    await auditInRealm(tx, session.realm as Realm, {
      action: 'AUTH.SESSION_EXPIRED', objectType: 'session', objectId: session.id, after: { reason: 'idle' },
    })
  }
  return false
}

async function loadUser(tx: Tx, userId: string): Promise<UserRow | undefined> {
  const { rows } = await tx.query<UserRow>(
    `SELECT u.state, u.mfa_enrolled, t.state AS tenant_state, u.participant_id,
            u.participant_id IS NULL OR (p.status = 'active' AND p.pseudonymised_at IS NULL) AS participant_active,
            u.participant_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM position_ownership o JOIN position x ON x.id = o.position_id
              WHERE o.participant_id = u.participant_id AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now())
                AND x.status <> 'terminated') AS participant_terminated
     FROM user_account u LEFT JOIN tenant t ON t.id = u.tenant_id
     LEFT JOIN participant p ON p.tenant_id = u.tenant_id AND p.id = u.participant_id
     WHERE u.id = $1`,
    [userId],
  )
  return rows[0]
}

async function loadGrants(tx: Tx, userId: string): Promise<GrantRow[]> {
  const { rows } = await tx.query<GrantRow>(
    `SELECT ra.id AS assignment_id, r.id AS role_id, r.name, r.permissions, r.mfa_required, ra.market_ids, ra.valid_to
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
    permissions: row.permissions.filter(isPermission), marketIds: row.market_ids, validTo: row.valid_to,
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
    participantId: realm === 'portal' ? user.participant_id : null,
    participantTerminated: realm === 'portal' && user.participant_terminated,
  }
}

// One transaction in the session's own realm: idle check, user still active, tenant not archived, roles.
// auth_find_session skips closed accounts and closing one revokes its sessions (0040); the user check here only
// covers a deactivation or archival that commits while this request resolves.
async function loadContext(tx: Tx, session: SessionRow, idleMinutes: number): Promise<AuthContext | null> {
  if (!(await touch(tx, session, idleMinutes))) return null
  const user = await loadUser(tx, session.user_id)
  if (user === undefined || user.state !== 'active' || user.tenant_state === 'archived' || !user.participant_active) return null
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
  if ((session.realm === 'tenant' || session.realm === 'portal') && session.tenant_id !== null) {
    const ctx = { tenantId: session.tenant_id, userId: SYSTEM_ACTOR_ID, sessionId: session.id }
    return runInTenant(ctx, actor, (tx) => loadContext(tx, session, idle))
  }
  if (session.realm === 'vendor') return runInVendor(SYSTEM_ACTOR_ID, actor, (tx) => loadContext(tx, session, idle))
  return null
}
