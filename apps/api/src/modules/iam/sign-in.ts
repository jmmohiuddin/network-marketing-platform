import { withSystem, type Tx } from '@nmp/db'
import type { Config } from '../../config.js'
import { auditInRealm } from '../../lib/audit.js'
import type { Realm } from '../../lib/auth.js'
import { verifyPassword } from '../../lib/passwords.js'
import { insertSession, type IssuedSession } from '../../lib/session.js'
import { recordSuccess, reserveAttempt } from './attempts.js'
import type { FirebaseIdentity } from './firebase.js'
import { asUser, type KnownUser } from './realm.js'

interface SignInRequest {
  readonly realm: Realm
  /** Tenant realm: the tenant's slug (the sign-in hostname, FR-IAM-001). Vendor realm: null. */
  readonly tenantSlug: string | null
  readonly ip: string
  readonly userAgent: string | undefined
  readonly requestId: string
}

export interface SignInInput extends SignInRequest {
  readonly email: string
  readonly password: string
}

export interface FirebaseSignInInput extends SignInRequest {
  /** From a verified Firebase ID token (firebase.ts). */
  readonly identity: FirebaseIdentity
  /** The account's own password: required on the first Firebase sign-in, the one that binds the account. */
  readonly password: string | undefined
}

export type NextStep = 'mfa_enrolment' | 'mfa_verification' | 'none'

export type SignInResult =
  | { readonly ok: true; readonly session: IssuedSession; readonly next: NextStep }
  | { readonly ok: false; readonly failure: 'locked' | 'invalid' | 'identity_in_use' | 'link_required' }

// The unique index of 0250: one account per Firebase subject in a tenant (or among vendor accounts).
const FIREBASE_SUBJECT_KEY = 'user_account_firebase_subject_key'

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

const accountKeyOf = (tenantSlug: string | null, email: string) => `${tenantSlug ?? 'vendor'}:${email}`

// Reserves the attempt (or finds the key locked) and looks the account up, in one system transaction.
async function lookUp(config: Config, input: SignInRequest, email: string, accountKey: string) {
  return withSystem(async (tx) => {
    const failures = await reserveAttempt(tx, config, accountKey, input.ip)
    const users = await tx.query<FoundUser>('SELECT * FROM auth_find_user($1, $2)', [input.tenantSlug, email])
    return { failures, user: users.rows[0] }
  })
}

function known(user: FoundUser): KnownUser {
  return { userId: user.user_id, tenantId: user.tenant_id, realm: user.realm }
}

// Failures are audited only for accounts that exist, in their own tenant's log; unknown accounts leave
// only the login_attempt row (no tenant to write to, no personal data to keep). detail: ids, never personal data.
async function auditFailure(user: FoundUser | undefined, requestId: string, reason: string, lockedNow: boolean, detail = {}) {
  if (user === undefined) return
  await asUser(known(user), requestId, async (tx) => {
    const event = { objectType: 'user_account', objectId: user.user_id, after: { reason, ...detail } }
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

/** How a Firebase sign-in proved who the person is, for the AUTH.SIGN_IN audit event (password: nothing extra). */
interface SignInMethod {
  readonly method: 'firebase'
  readonly provider: string
}

async function startSession(tx: Tx, config: Config, input: SignInRequest, user: FoundUser, method?: SignInMethod) {
  const session = await insertSession(tx, {
    absoluteMinutes: config.sessionAbsoluteMinutes, ip: input.ip, userAgent: input.userAgent,
  })
  await tx.query('UPDATE user_account SET last_sign_in_at = now() WHERE id = $1', [user.user_id])
  const signIn = { action: 'AUTH.SIGN_IN', objectType: 'session', objectId: session.id }
  await auditInRealm(tx, user.realm, method === undefined ? signIn : { ...signIn, after: method })
  const required = await mfaRequiredByRoles(tx, user)
  const next: NextStep = user.mfa_enrolled ? 'mfa_verification' : required ? 'mfa_enrolment' : 'none'
  return { session, next }
}

function openSession(config: Config, input: SignInRequest, user: FoundUser) {
  return asUser(known(user), input.requestId, (tx) => startSession(tx, config, input, user))
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
  const accountKey = accountKeyOf(input.tenantSlug, input.email)
  const { failures, user } = await lookUp(config, input, input.email, accountKey)
  if (failures === null) return locked(user, input.requestId)
  const passwordMatches = await verifyPassword(user?.password_hash ?? null, input.password)
  if (!passwordMatches || !usable(user, input.realm)) {
    return refused(config, user, input.requestId, 'invalid_credentials', failures)
  }
  await recordSuccess(accountKey, input.ip)
  return { ok: true, ...(await openSession(config, input, user)) }
}

async function locked(user: FoundUser | undefined, requestId: string): Promise<SignInResult> {
  await auditFailure(user, requestId, 'locked', false)
  return { ok: false, failure: 'locked' }
}

async function refused(
  config: Config, user: FoundUser | undefined, requestId: string, reason: string, failures: number, detail = {},
): Promise<SignInResult> {
  await auditFailure(user, requestId, reason, failures >= config.lockoutMaxFailures, detail)
  return { ok: false, failure: 'invalid' }
}

type Binding = 'bound' | 'linked' | 'mismatch' | 'unlinked'

// The row lock makes two first sign-ins of one account take turns: the second sees the first one's subject.
async function bindFirebase(tx: Tx, userId: string, subject: string, mayLink: boolean): Promise<Binding> {
  const { rows } = await tx.query<{ firebase_subject: string | null }>(
    'SELECT firebase_subject FROM user_account WHERE id = $1 FOR UPDATE', [userId],
  )
  if (rows.length === 0) return 'mismatch' // the user went away since the look-up
  const current = rows[0]!.firebase_subject
  if (current === subject) return 'bound'
  if (current !== null) return 'mismatch'
  if (!mayLink) return 'unlinked'
  await tx.query('UPDATE user_account SET firebase_subject = $2 WHERE id = $1', [userId, subject])
  return 'linked'
}

/** The audit reference of a Firebase identity: its ids, not the email (the account's own). */
const identityRef = (identity: FirebaseIdentity) => ({ subject: identity.subject, sign_in_provider: identity.provider })

type BindFailure = 'mismatch' | 'unlinked' | 'in_use'

// Binds (when allowed), audits the binding and opens the session in one transaction: a binding is never left unaudited.
async function bindAndOpen(config: Config, input: FirebaseSignInInput, user: FoundUser, mayLink: boolean) {
  const { identity } = input
  try {
    return await asUser(known(user), input.requestId, async (tx) => {
      const binding = await bindFirebase(tx, user.user_id, identity.subject, mayLink)
      if (binding === 'mismatch' || binding === 'unlinked') return { ok: false as const, failure: binding }
      if (binding === 'linked') {
        const after = { provider: 'firebase', ...identityRef(identity) }
        await auditInRealm(tx, user.realm, { action: 'AUTH.IDENTITY_LINKED', objectType: 'user_account', objectId: user.user_id, after })
      }
      const opened = await startSession(tx, config, input, user, { method: 'firebase', provider: identity.provider })
      return { ok: true as const, ...opened }
    })
  } catch (error) {
    if ((error as { constraint?: string }).constraint === FIREBASE_SUBJECT_KEY) return { ok: false as const, failure: 'in_use' as BindFailure }
    throw error
  }
}

const BIND_FAILURES: Readonly<Record<BindFailure, { reason: string; failure: 'invalid' | 'identity_in_use' | 'link_required' }>> = {
  mismatch: { reason: 'identity_mismatch', failure: 'invalid' },
  unlinked: { reason: 'link_required', failure: 'link_required' },
  in_use: { reason: 'identity_in_use', failure: 'identity_in_use' },
}

/**
 * Firebase sign-in: the verified token proves who the person is; everything after is the password path's (lockout on
 * the same account key, usable(), MFA next step, session, audit). An account not yet bound to a Firebase subject is
 * bound only by a sign-in that also proves its password (else 401 FIREBASE_LINK_REQUIRED), so an email address alone
 * never opens an account (AUTH.IDENTITY_LINKED). An account bound to another subject is refused like a wrong password;
 * a subject already bound to another account of the tenant is 409 IDENTITY_IN_USE.
 */
export async function firebaseSignIn(config: Config, input: FirebaseSignInInput): Promise<SignInResult> {
  const { identity, requestId } = input
  const accountKey = accountKeyOf(input.tenantSlug, identity.email)
  const { failures, user } = await lookUp(config, input, identity.email, accountKey)
  if (failures === null) return locked(user, requestId)
  if (!usable(user, input.realm)) return refused(config, user, requestId, 'invalid_credentials', failures)
  const passwordProven = input.password !== undefined && await verifyPassword(user.password_hash, input.password)
  if (input.password !== undefined && !passwordProven) return refused(config, user, requestId, 'invalid_credentials', failures)
  const result = await bindAndOpen(config, input, user, passwordProven)
  if (result.ok) {
    await recordSuccess(accountKey, input.ip)
    return result
  }
  const { reason, failure } = BIND_FAILURES[result.failure]
  await auditFailure(user, requestId, reason, failures >= config.lockoutMaxFailures, identityRef(identity))
  return { ok: false, failure }
}
