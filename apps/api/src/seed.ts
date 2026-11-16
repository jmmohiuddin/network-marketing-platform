// Local development data (nmp_dev) and the browser-test seed (nmp_e2e, `pnpm --filter @nmp/api seed:e2e`): two
// independent vendor operators with MFA (BUG-031: bootstrap users, no inviter, so either can be the other's second
// person) and two tenants with staff (no MFA: their forced enrolment is part of the browser test).
// Idempotent: existing rows are kept and their passwords are not changed. Refuses production, any database but the
// local ones, and any database server not on this machine.
import { randomBytes, randomUUID } from 'node:crypto'
import { closePool, withSystem, type Tx } from '@nmp/db'
import { closeOwnerPool, getOwnerPool } from '@nmp/db/testing'
import { pathToFileURL } from 'node:url'
import { loadConfig, type Config } from './config.js'
import { recordAudit, recordVendorAudit } from './lib/audit.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID, type ActorContext } from './lib/db.js'
import { hashPassword } from './lib/passwords.js'
import { BASE_ROLES, isPrivileged, type BaseRoleName } from './lib/permissions.js'
import { seal } from './lib/secret-box.js'
import { generateTotpSecret, totpUri } from './lib/totp.js'

const SYSTEM: ActorContext = { actorType: 'system', requestId: 'seed', supportSessionId: null }
const VENDORS = [
  { email: 'operator@vendor.example', name: 'Vendor Operator' },
  { email: 'operator2@vendor.example', name: 'Second Vendor Operator' },
] as const
const TENANTS = [
  { slug: 'acme', legalName: 'Acme Direct Ltd' },
  { slug: 'globex', legalName: 'Globex Wellness Ltd' },
] as const
const STAFF: readonly { local: string; name: string; role: BaseRoleName }[] = [
  { local: 'admin', name: 'Tenant Admin', role: 'Tenant admin' },
  { local: 'admin2', name: 'Second Admin', role: 'Tenant admin' },
  { local: 'compliance', name: 'Compliance Officer', role: 'Compliance officer' },
  { local: 'finance', name: 'Finance Approver', role: 'Finance approver' },
  { local: 'analyst', name: 'Commission Analyst', role: 'Commission analyst' },
]

// The two admins are the bootstrap grants of provisioning; every other privileged grant needs a second admin's approval.
const needsApproval = (role: BaseRoleName): boolean =>
  role !== 'Tenant admin' && isPrivileged(BASE_ROLES.find((base) => base.name === role)!.permissions)

type Print = (line: string) => void

// Credentials are reachable only by their own user (0040, BUG-002): the seed writes them as that user, then acts as
// the system again.
async function asSelf<T>(tx: Tx, userId: string, write: () => Promise<T>): Promise<T> {
  await tx.query(`SELECT set_config('app.user_id', $1, true)`, [userId])
  const result = await write()
  await tx.query(`SELECT set_config('app.user_id', $1, true)`, [SYSTEM_ACTOR_ID])
  return result
}

async function insertUser(tx: Tx, user: { tenantId: string | null; email: string; name: string; passwordHash: string }) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', NULL) RETURNING id`,
    [user.tenantId, user.tenantId === null ? 'vendor' : 'tenant', `local:${randomUUID()}`, user.email, user.name],
  )
  const id = rows[0]!.id
  await asSelf(tx, id, () =>
    tx.query('INSERT INTO password_credential (user_id, password_hash) VALUES ($1, $2)', [id, user.passwordHash]),
  )
  return id
}

async function existingUser(tx: Tx, email: string): Promise<string | undefined> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM user_account WHERE email = $1', [email])
  return rows[0]?.id
}

/** A vendor operator, MFA enrolled (all vendor staff use MFA, SEC-03). printTotp: print its otpauth URI once. */
async function seedVendor(
  config: Config, vendor: (typeof VENDORS)[number], passwordHash: string, printTotp: boolean, print: Print,
): Promise<boolean> {
  return runInVendor(SYSTEM_ACTOR_ID, SYSTEM, async (tx) => {
    if ((await existingUser(tx, vendor.email)) !== undefined) return false
    const id = await insertUser(tx, { tenantId: null, email: vendor.email, name: vendor.name, passwordHash })
    const secret = generateTotpSecret()
    await asSelf(tx, id, () =>
      tx.query(
        `INSERT INTO mfa_credential (user_id, type, secret_encrypted, confirmed_at) VALUES ($1, 'totp', $2, now())`,
        [id, seal(config.secretKey, secret, id)],
      ),
    )
    await tx.query('UPDATE user_account SET mfa_enrolled = true WHERE id = $1', [id])
    await recordVendorAudit(tx, { action: 'SEED.USER_CREATED', objectType: 'user_account', objectId: id })
    print(`vendor: ${vendor.email}`)
    // Local databases only (assertSeedable): the operator, or the browser test, needs it once for an authenticator.
    if (printTotp) print(`vendor TOTP: ${totpUri(vendor.email, secret)}`)
    return true
  })
}

async function upsertTenant(slug: string, legalName: string): Promise<string> {
  return runInVendor(SYSTEM_ACTOR_ID, SYSTEM, async (tx) => {
    await tx.query(
      `INSERT INTO tenant (legal_name, slug, region, isolation_tier, db_route, state)
       VALUES ($1, $2, 'eu', 'pooled', 'pooled', 'implementation') ON CONFLICT (slug) DO NOTHING`,
      [legalName, slug],
    )
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM tenant WHERE slug = $1', [slug])
    return rows[0]!.id
  })
}

async function grant(tx: Tx, assignmentId: string, userId: string, role: BaseRoleName, approvalId: string | null) {
  await tx.query(
    `INSERT INTO role_assignment (id, tenant_id, user_id, role_id, valid_from, approval_id)
     SELECT $1, app_tenant_id(), $2, r.id, now(), $4 FROM role r WHERE r.tenant_id IS NULL AND r.name = $3`,
    [assignmentId, userId, role, approvalId],
  )
  await recordAudit(tx, {
    action: 'ROLE.GRANTED', objectType: 'role_assignment', objectId: assignmentId, after: { user_id: userId, role, approval_id: approvalId },
  })
}

// Privileged grants carry an approval by the second admin, prepared by the first, as the API would record them;
// the approval is written as its approver (0107: approver_id = app.user_id).
async function grantStaffRoles(tx: Tx, ids: ReadonlyMap<string, string>): Promise<void> {
  for (const member of STAFF) {
    const userId = ids.get(member.local)!
    const assignmentId = randomUUID()
    if (!needsApproval(member.role)) {
      await grant(tx, assignmentId, userId, member.role, null)
      continue
    }
    const approver = ids.get('admin2')!
    const { rows } = await asSelf(tx, approver, () =>
      tx.query<{ id: string }>(
        `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at)
         VALUES (app_tenant_id(), 'role_assignment', $1, $2, $3, 'approved', 'seed', now()) RETURNING id`,
        [assignmentId, ids.get('admin'), approver],
      ),
    )
    await grant(tx, assignmentId, userId, member.role, rows[0]!.id)
  }
}

async function seedTenant(slug: string, legalName: string, passwordHash: string, print: Print): Promise<boolean> {
  const tenantId = await upsertTenant(slug, legalName)
  return runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    // D-B1-17: a market starts draft and goes live only through its launch checklist.
    await tx.query(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES (app_tenant_id(), 'DEMO', 'GBP', 2, 'Europe/London', '{en}', 'none', 'draft') ON CONFLICT DO NOTHING`,
    )
    if ((await existingUser(tx, `admin@${slug}.example`)) !== undefined) return false
    const ids = new Map<string, string>()
    for (const member of STAFF) {
      const email = `${member.local}@${slug}.example`
      ids.set(member.local, await insertUser(tx, { tenantId, email, name: member.name, passwordHash }))
      print(`${slug}: ${email} (${member.role})`)
    }
    await grantStaffRoles(tx, ids)
    return true
  })
}

const E2E_DATABASE = 'nmp_e2e'
export const E2E_FIXTURE_PACK = 'e2e-fixture'

/**
 * PLAN B1 section 6: a labelled fixture market pack for the browser tests (no real pack data ships, DEC-14). Pack
 * rules are platform tables only migrations or the owner write, so this goes through the owner connection, which
 * must point at the same database as the app (MIGRATE_DATABASE_URL). Idempotent.
 */
export async function seedFixturePack(expectedDatabase: string): Promise<void> {
  const owner = getOwnerPool()
  const { rows } = await owner.query<{ name: string }>('SELECT current_database() AS name')
  if (rows[0]?.name !== expectedDatabase) {
    throw new Error(`seed refuses the fixture pack: the owner connection is on ${rows[0]?.name}, not ${expectedDatabase}`)
  }
  await owner.query(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status,
       source_ref, effective_from)
     VALUES ('e2e-enrolment-only-bonus@2026-01-01', $1, 'E2E FIXTURE — enrolment-only bonus', 'blocked',
       '{"fixture": "enrolment_only_bonus"}', false, true, 'E2E fixture basis, not a real market rule', 'screening',
       'E2E fixture, not a real market rule', '2026-01-01')
     ON CONFLICT (id) DO NOTHING`,
    [E2E_FIXTURE_PACK],
  )
  await owner.query(
    `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, rounding, mandatory, effective_from, basis,
       basis_status, source_ref)
     VALUES ('e2e-withholding@2026-01-01', $1, 'E2E FIXTURE — withholding', 'withholding', '{}', NULL, 'none', true,
       '2026-01-01', 'E2E fixture basis, not a real tax rule', 'counsel_confirmed', 'E2E fixture')
     ON CONFLICT (id) DO NOTHING`,
    [E2E_FIXTURE_PACK],
  )
}

// The seed creates known staff accounts: only the local databases of PROJECT_ENGINEERING_CONTEXT may get them.
const SEEDABLE_DATABASES: ReadonlySet<string> = new Set(['nmp_dev', 'nmp_test', 'nmp_test_1', 'nmp_test_2', 'nmp_test_3', 'nmp_test_4', 'nmp_test_5', 'nmp_test_6', 'nmp_e2e'])
// A fixed password (SEED_PASSWORD) makes every seeded account known: development and browser-test databases only.
const FIXED_PASSWORD_DATABASES: ReadonlySet<string> = new Set(['nmp_dev', 'nmp_e2e'])

/** The database the seed is connected to: its name and the server's address (null over a Unix socket). */
export interface SeedTarget {
  readonly database: string
  readonly serverAddress: string | null
}

const isLoopback = (address: string | null): boolean =>
  address === null || address === '::1' || /^(::ffff:)?127\./.test(address)

/** One of the local databases of PROJECT_ENGINEERING_CONTEXT, on a server reached over a Unix socket or loopback. */
export const isLocalDatabase = (target: SeedTarget): boolean => isLoopback(target.serverAddress) && SEEDABLE_DATABASES.has(target.database)

/**
 * Throws unless seeding is allowed: never in production, only into a local database on a server reached over a
 * Unix socket or loopback, a fixed password only where listed.
 */
export function assertSeedable(env: Config['env'], target: SeedTarget, fixedPassword: boolean): void {
  if (env === 'production') throw new Error('seed refuses to run with NODE_ENV=production')
  if (!isLoopback(target.serverAddress)) {
    throw new Error(`seed refuses the database server at ${target.serverAddress}: only a local server (Unix socket or loopback)`)
  }
  const { database } = target
  if (!SEEDABLE_DATABASES.has(database)) {
    throw new Error(`seed refuses database ${database}: only ${[...SEEDABLE_DATABASES].join(', ')}`)
  }
  if (fixedPassword && !FIXED_PASSWORD_DATABASES.has(database)) {
    throw new Error(`seed refuses SEED_PASSWORD for database ${database}: only ${[...FIXED_PASSWORD_DATABASES].join(', ')}`)
  }
}

/**
 * Seeds the database behind DATABASE_URL. password (SEED_PASSWORD) is used for every account created now; without
 * it a random one is generated and printed. The vendor's otpauth URI is printed in development or with a password.
 */
export async function seed(config: Config, password: string | undefined, print: Print): Promise<void> {
  const { rows } = await withSystem((tx) =>
    tx.query<SeedTarget>('SELECT current_database() AS database, host(inet_server_addr()) AS "serverAddress"'),
  )
  const target = rows[0]!
  assertSeedable(config.env, target, password !== undefined)
  const effective = password ?? randomBytes(18).toString('base64url')
  const passwordHash = await hashPassword(effective)
  const printTotp = config.env === 'development' || password !== undefined
  let created = false
  for (const vendor of VENDORS) created = (await seedVendor(config, vendor, passwordHash, printTotp, print)) || created
  for (const tenant of TENANTS) created = (await seedTenant(tenant.slug, tenant.legalName, passwordHash, print)) || created
  if (target.database === E2E_DATABASE) {
    await seedFixturePack(E2E_DATABASE)
    print(`market pack: ${E2E_FIXTURE_PACK} (fixture)`)
  }
  if (created && password === undefined) print(`password of the accounts created now: ${effective}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const print: Print = (line) => process.stdout.write(`${line}\n`)
  const fixedPassword = process.env.SEED_PASSWORD
  seed(loadConfig(process.env), fixedPassword === '' ? undefined : fixedPassword, print)
    .catch((error: unknown) => {
      process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(() => Promise.all([closePool(), closeOwnerPool()]))
}
