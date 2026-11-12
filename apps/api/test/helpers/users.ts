import { randomBytes } from 'node:crypto'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '@nmp/db/testing'
import { authenticator } from 'otplib'
import { renderBaseRoleSeed, type BaseRoleName } from '../../src/lib/permissions.js'
import { seal } from '../../src/lib/secret-box.js'
import { hashToken, SESSION_COOKIE } from '../../src/lib/session.js'
import { TEST_SECRET_KEY, type Caller } from './app.js'

const SESSION_MINUTES = 60

/**
 * Empties the test database and seeds the platform base roles (resetTestDb also truncates role). Queued jobs go too:
 * resetTestDb leaves the pgboss schema, so a job a previous run left queued would be picked up by runQueuedJobs.
 */
export async function resetApiDb(): Promise<void> {
  await resetTestDb()
  await getOwnerPool().query('TRUNCATE pgboss.job')
  await getOwnerPool().query(renderBaseRoleSeed())
}

export { createTenant, type TestTenant }

export async function baseRoleId(name: BaseRoleName): Promise<string> {
  const { rows } = await getOwnerPool().query<{ id: string }>(
    'SELECT id FROM role WHERE tenant_id IS NULL AND is_base AND name = $1',
    [name],
  )
  if (rows[0] === undefined) throw new Error(`base role ${name} is not seeded: call resetApiDb() first`)
  return rows[0].id
}

export async function createMarket(tenantId: string, code = 'GB'): Promise<string> {
  const { rows } = await getOwnerPool().query<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, $2, 'GBP', 2, 'Europe/London', '{en}', 'none', 'live') RETURNING id`,
    [tenantId, code],
  )
  return rows[0]!.id
}

export type MfaState = 'none' | 'unverified' | 'verified'

export interface TestUserOptions {
  /** null = a vendor user. */
  readonly tenantId: string | null
  readonly roles?: readonly BaseRoleName[]
  /** Market scope for every role given (null = all markets). */
  readonly marketIds?: readonly string[] | null
  /** End of every role given (default: open-ended). */
  readonly validTo?: Date
  /** 'verified' (default): enrolled and verified in this session. 'unverified': enrolled, not yet verified. */
  readonly mfa?: MfaState
  /** A second factor verified just now (step-up fresh). Implies mfa 'verified'. */
  readonly stepUp?: boolean
  readonly email?: string
  readonly passwordHash?: string
}

export interface TestUser extends Caller {
  readonly id: string
  readonly tenantId: string | null
  readonly email: string
  readonly sessionId: string
  /** TOTP seed when MFA is enrolled; use totpCode(secret) to produce codes. */
  readonly totpSecret: string | null
}

async function enrol(userId: string): Promise<string> {
  const secret = authenticator.generateSecret(20)
  const owner = getOwnerPool()
  await owner.query(
    `INSERT INTO mfa_credential (user_id, type, secret_encrypted, confirmed_at) VALUES ($1, 'totp', $2, now())`,
    [userId, seal(Buffer.from(TEST_SECRET_KEY, 'base64'), secret, userId)],
  )
  await owner.query('UPDATE user_account SET mfa_enrolled = true WHERE id = $1', [userId])
  return secret
}

async function grantRoles(user: { id: string; tenantId: string }, roles: readonly BaseRoleName[], options: TestUserOptions) {
  for (const role of roles) {
    await getOwnerPool().query(
      `INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from, valid_to) VALUES ($1, $2, $3, $4, now(), $5)`,
      [user.tenantId, user.id, await baseRoleId(role), options.marketIds ?? null, options.validTo ?? null],
    )
  }
}

async function openSession(user: { id: string; tenantId: string | null }, mfa: MfaState, stepUp: boolean) {
  const token = randomBytes(32).toString('base64url')
  const verified = mfa === 'verified' || stepUp
  const { rows } = await getOwnerPool().query<{ id: string }>(
    `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, mfa_verified_at, step_up_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => $8)) RETURNING id`,
    [hashToken(token), user.id, user.tenantId, user.tenantId === null ? 'vendor' : 'tenant', verified ? 'aal2' : 'aal1',
      verified ? new Date() : null, stepUp ? new Date() : null, SESSION_MINUTES],
  )
  return { token, sessionId: rows[0]!.id }
}

/**
 * A signed-in user created directly in the database (no argon2, no approvals): active, with the given base
 * roles granted, MFA in the requested state and a live session. Pass `as: user` to call().
 */
export async function createSignedInUser(options: TestUserOptions): Promise<TestUser> {
  const created = await createUser({
    tenantId: options.tenantId,
    ...(options.email === undefined ? {} : { email: options.email.toLowerCase() }),
    ...(options.passwordHash === undefined ? {} : { passwordHash: options.passwordHash }),
  })
  const tenantId = options.tenantId
  if (tenantId !== null) await grantRoles({ id: created.id, tenantId }, options.roles ?? [], options)
  const mfa = options.stepUp === true ? 'verified' : (options.mfa ?? 'verified')
  const totpSecret = mfa === 'none' ? null : await enrol(created.id)
  const { token, sessionId } = await openSession({ id: created.id, tenantId }, mfa, options.stepUp === true)
  return { id: created.id, tenantId, email: created.email, sessionId, totpSecret, cookie: `${SESSION_COOKIE}=${token}` }
}

/** The current TOTP code for a seed (offsetSteps -1 = the previous 30-second step). */
export function totpCode(secret: string, offsetSteps = 0): string {
  return authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 }).generate(secret)
}

/** Rows of a table as the owner sees them (bypasses RLS): for assertions only. */
export async function ownerRows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getOwnerPool().query<T>(sql, params)
  return rows
}

/** Audit actions recorded for a tenant, oldest first. */
export async function auditActions(tenantId: string): Promise<string[]> {
  const rows = await ownerRows<{ action: string }>('SELECT action FROM audit.audit_event WHERE tenant_id = $1 ORDER BY seq', [tenantId])
  return rows.map((row) => row.action)
}
