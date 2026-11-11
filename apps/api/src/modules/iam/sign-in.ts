import { withSystem, type Tx } from '@nmp/db'
import type { Config } from '../../config.js'
import { auditInRealm } from '../../lib/audit.js'
import type { Realm } from '../../lib/auth.js'
import { verifyPassword } from '../../lib/passwords.js'
import { insertSession, type IssuedSession } from '../../lib/session.js'
import { recordSuccess, reserveAttempt } from './attempts.js'
import { asUser, type KnownUser } from './realm.js'

export interface SignInInput {
  readonly realm: Realm
  /** Tenant realm: the tenant's slug (the sign-in hostname, FR-IAM-001). Vendor realm: null. */
  readonly tenantSlug: string | null
  readonly email: string
  readonly password: string
  readonly ip: string
  readonly userAgent: string | undefined
  readonly requestId: string
}

export type NextStep = 'mfa_enrolment' | 'mfa_verification' | 'none'

export type SignInResult =
  | { readonly ok: true; readonly session: IssuedSession; readonly next: NextStep }
  | { readonly ok: false; readonly locked: boolean }

interface FoundUser {
  user_id: string
  tenant_id: string | null
  realm: Realm
  state: string
  mfa_enrolled: boolean
  password_hash: string | null
  tenant_state: string | null
}

// Tenants that are being provisioned or are archived have no staff sign-in.
const CLOSED_TENANT_STATES = new Set(['provisioning', 'archived'])

// Reserves the attempt (or finds the key locked) and looks the account up, in one system transaction.
async function lookUp(config: Config, input: SignInInput, accountKey: string) {
  return withSystem(async (tx) => {
    const failures = await reserveAttempt(tx, config, accountKey, input.ip)
    const users = await tx.query<FoundUser>('SELECT * FROM auth_find_user($1, $2)', [input.tenantSlug, input.email])
    return { failures, user: users.rows[0] }
  })
}

function known(user: FoundUser): KnownUser {
  return { userId: user.user_id, tenantId: user.tenant_id, realm: user.realm }
}

// Failures are audited only for accounts that exist, in their own tenant's log; unknown accounts leave
// only the login_attempt row (no tenant to write to, no personal data to keep).
async function auditFailure(user: FoundUser | undefined, requestId: string, reason: string, lockedNow: boolean) {
  if (user === undefined) return
  await asUser(known(user), requestId, async (tx) => {
    const event = { objectType: 'user_account', objectId: user.user_id, after: { reason } }
    await auditInRealm(tx, user.realm, { ...event, action: 'AUTH.SIGN_IN_FAILED' })
    if (lockedNow) await auditInRealm(tx, user.realm, { ...event, action: 'AUTH.ACCOUNT_LOCKED' })
  })
}

async function mfaRequiredByRoles(tx: Tx, user: FoundUser): Promise<boolean> {
  if (user.realm === 'vendor') return true
  const { rows } = await tx.query<{ required: boolean }>(
    `SELECT coalesce(bool_or(r.mfa_required), false) AS required
     FROM role_assignment ra JOIN role r ON r.id = ra.role_id
     WHERE ra.user_id = $1 AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())`,
    [user.user_id],
  )
  return rows[0]!.required
}

async function openSession(config: Config, input: SignInInput, user: FoundUser) {
  return asUser(known(user), input.requestId, async (tx) => {
    const session = await insertSession(tx, {
      userId: user.user_id, tenantId: user.tenant_id, realm: user.realm,
      absoluteMinutes: config.sessionAbsoluteMinutes, ip: input.ip, userAgent: input.userAgent,
    })
    await tx.query('UPDATE user_account SET last_sign_in_at = now() WHERE id = $1', [user.user_id])
    await auditInRealm(tx, user.realm, { action: 'AUTH.SIGN_IN', objectType: 'session', objectId: session.id })
    const required = await mfaRequiredByRoles(tx, user)
    const next: NextStep = user.mfa_enrolled ? 'mfa_verification' : required ? 'mfa_enrolment' : 'none'
    return { session, next }
  })
}

function usable(user: FoundUser | undefined, realm: Realm): user is FoundUser {
  if (user === undefined || user.realm !== realm || user.state !== 'active') return false
  return user.tenant_state === null || !CLOSED_TENANT_STATES.has(user.tenant_state)
}

/**
 * Password sign-in (FR-IAM-001, AC-35.2). Every failure looks the same to the caller: unknown account,
 * wrong password, inactive user or closed tenant. The attempt is counted as a failure before the password is
 * checked (attempts.ts), so parallel attempts from any number of addresses cannot pass the lockout: after
 * lockoutMaxFailures failures inside the window the account key is locked until the window passes.
 */
export async function signIn(config: Config, input: SignInInput): Promise<SignInResult> {
  const accountKey = `${input.tenantSlug ?? 'vendor'}:${input.email}`
  const { failures, user } = await lookUp(config, input, accountKey)
  if (failures === null) {
    await auditFailure(user, input.requestId, 'locked', false)
    return { ok: false, locked: true }
  }
  const passwordMatches = await verifyPassword(user?.password_hash ?? null, input.password)
  if (!passwordMatches || !usable(user, input.realm)) {
    await auditFailure(user, input.requestId, 'invalid_credentials', failures >= config.lockoutMaxFailures)
    return { ok: false, locked: false }
  }
  await recordSuccess(accountKey, input.ip)
  return { ok: true, ...(await openSession(config, input, user)) }
}
