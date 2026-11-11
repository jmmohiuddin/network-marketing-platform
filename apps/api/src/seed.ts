// Local development data (nmp_dev): a vendor operator and two tenants with staff. Idempotent: existing rows
// are kept and their passwords are not changed. Refuses production and any database but the local ones.
import { randomBytes, randomUUID } from 'node:crypto'
import { closePool, withSystem, type Tx } from '@nmp/db'
import { pathToFileURL } from 'node:url'
import { loadConfig, type Config } from './config.js'
import { recordAudit, recordVendorAudit } from './lib/audit.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID, type ActorContext } from './lib/db.js'
import { hashPassword } from './lib/passwords.js'
import type { BaseRoleName } from './lib/permissions.js'
import { seal } from './lib/secret-box.js'
import { generateTotpSecret, totpUri } from './lib/totp.js'

const SYSTEM: ActorContext = { actorType: 'system', requestId: 'seed', supportSessionId: null }
const VENDOR_EMAIL = 'operator@vendor.example'
const TENANTS = [
  { slug: 'acme', legalName: 'Acme Direct Ltd' },
  { slug: 'globex', legalName: 'Globex Wellness Ltd' },
] as const
const STAFF: readonly { local: string; name: string; role: BaseRoleName }[] = [
  { local: 'admin', name: 'Tenant Admin', role: 'Tenant admin' },
  { local: 'admin2', name: 'Second Admin', role: 'Tenant admin' },
  { local: 'compliance', name: 'Compliance Officer', role: 'Compliance officer' },
  { local: 'analyst', name: 'Commission Analyst', role: 'Commission analyst' },
]

type Print = (line: string) => void

async function insertUser(tx: Tx, user: { tenantId: string | null; email: string; name: string; passwordHash: string }) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', NULL) RETURNING id`,
    [user.tenantId, user.tenantId === null ? 'vendor' : 'tenant', `local:${randomUUID()}`, user.email, user.name],
  )
  const id = rows[0]!.id
  await tx.query('INSERT INTO password_credential (user_id, password_hash) VALUES ($1, $2)', [id, user.passwordHash])
  return id
}

async function existingUser(tx: Tx, email: string): Promise<string | undefined> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM user_account WHERE email = $1', [email])
  return rows[0]?.id
}

/** The vendor operator, MFA enrolled (all vendor staff use MFA, SEC-03). */
async function seedVendor(config: Config, passwordHash: string, print: Print): Promise<boolean> {
  return runInVendor(SYSTEM_ACTOR_ID, SYSTEM, async (tx) => {
    if ((await existingUser(tx, VENDOR_EMAIL)) !== undefined) return false
    const id = await insertUser(tx, { tenantId: null, email: VENDOR_EMAIL, name: 'Vendor Operator', passwordHash })
    const secret = generateTotpSecret()
    await tx.query(
      `INSERT INTO mfa_credential (user_id, type, secret_encrypted, confirmed_at) VALUES ($1, 'totp', $2, now())`,
      [id, seal(config.secretKey, secret, id)],
    )
    await tx.query('UPDATE user_account SET mfa_enrolled = true WHERE id = $1', [id])
    await recordVendorAudit(tx, { action: 'SEED.USER_CREATED', objectType: 'user_account', objectId: id })
    print(`vendor: ${VENDOR_EMAIL}`)
    // Development only: the operator needs this once to add the account to an authenticator app.
    if (config.env === 'development') print(`vendor TOTP: ${totpUri(VENDOR_EMAIL, secret)}`)
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

// The two admins are bootstrap grants (provisioning); other privileged grants carry an approval by the
// second admin, prepared by the first, as the API would record them.
async function grantStaffRoles(tx: Tx, ids: ReadonlyMap<string, string>): Promise<void> {
  for (const member of STAFF) {
    const userId = ids.get(member.local)!
    const assignmentId = randomUUID()
    if (member.role !== 'Compliance officer') {
      await grant(tx, assignmentId, userId, member.role, null)
      continue
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, decided_at)
       VALUES (app_tenant_id(), 'role_assignment', $1, $2, $3, 'approved', 'seed', now()) RETURNING id`,
      [assignmentId, ids.get('admin'), ids.get('admin2')],
    )
    await grant(tx, assignmentId, userId, member.role, rows[0]!.id)
  }
}

async function seedTenant(slug: string, legalName: string, passwordHash: string, print: Print): Promise<boolean> {
  const tenantId = await upsertTenant(slug, legalName)
  return runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, SYSTEM, async (tx) => {
    await tx.query(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES (app_tenant_id(), 'DEMO', 'GBP', 2, 'Europe/London', '{en}', 'none', 'live') ON CONFLICT DO NOTHING`,
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

// The seed creates known staff accounts: only the local databases of PROJECT_ENGINEERING_CONTEXT may get them.
const SEEDABLE_DATABASES: ReadonlySet<string> = new Set(['nmp_dev', 'nmp_test', 'nmp_e2e'])

/** Throws unless seeding is allowed: never in production, only into a local database. */
export function assertSeedable(env: Config['env'], database: string): void {
  if (env === 'production') throw new Error('seed refuses to run with NODE_ENV=production')
  if (!SEEDABLE_DATABASES.has(database)) {
    throw new Error(`seed refuses database ${database}: only ${[...SEEDABLE_DATABASES].join(', ')}`)
  }
}

/** Seeds the database behind DATABASE_URL. The password comes from SEED_PASSWORD or is generated and printed. */
export async function seed(config: Config, password: string | undefined, print: Print): Promise<void> {
  const { rows } = await withSystem((tx) => tx.query<{ name: string }>('SELECT current_database() AS name'))
  assertSeedable(config.env, rows[0]!.name)
  const effective = password ?? randomBytes(18).toString('base64url')
  const passwordHash = await hashPassword(effective)
  let created = await seedVendor(config, passwordHash, print)
  for (const tenant of TENANTS) created = (await seedTenant(tenant.slug, tenant.legalName, passwordHash, print)) || created
  if (created && password === undefined) print(`password of the accounts created now: ${effective}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const print: Print = (line) => process.stdout.write(`${line}\n`)
  seed(loadConfig(process.env), process.env.SEED_PASSWORD, print)
    .catch((error: unknown) => {
      process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
    .finally(() => closePool())
}
