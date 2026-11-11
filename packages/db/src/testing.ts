// Integration-test helpers. They use the owner connection (bypasses RLS) and refuse non-test databases.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { migrate } from './migrate.js'

const TEST_DATABASE = /^nmp_(test|e2e)$/

let ownerPool: pg.Pool | undefined
let prepared: Promise<void> | undefined

function migrateUrl(): string {
  const url = process.env.MIGRATE_DATABASE_URL
  if (url === undefined || url === '') throw new Error('MIGRATE_DATABASE_URL is not set')
  return url
}

/** Owner pool for arranging and inspecting test data. Never use it in production code. */
export function getOwnerPool(): pg.Pool {
  ownerPool ??= new pg.Pool({ connectionString: migrateUrl(), max: 2 })
  return ownerPool
}

export async function closeOwnerPool(): Promise<void> {
  const current = ownerPool
  ownerPool = undefined
  prepared = undefined
  await current?.end()
}

async function prepare(): Promise<void> {
  const { rows } = await getOwnerPool().query<{ name: string }>('SELECT current_database() AS name')
  const database = rows[0]?.name ?? ''
  if (!TEST_DATABASE.test(database)) {
    throw new Error(`Refusing to reset database "${database}": test helpers run only on nmp_test or nmp_e2e`)
  }
  await migrate(migrateUrl())
}

/** Brings the test database to the current schema (once per process) and empties every table. */
export async function resetTestDb(): Promise<void> {
  prepared ??= prepare()
  await prepared
  const owner = getOwnerPool()
  const { rows } = await owner.query<{ name: string }>(
    `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables
     WHERE schemaname IN ('public', 'audit') AND tablename <> 'schema_migration'`,
  )
  if (rows.length === 0) throw new Error('No tables found: the schema is not migrated')
  // Identifiers come from the catalogue and are quoted by format('%I').
  await owner.query(`TRUNCATE ${rows.map((row) => row.name).join(', ')} RESTART IDENTITY CASCADE`)
}

export interface TestTenant {
  id: string
  slug: string
}

export async function createTenant(overrides: { slug?: string; state?: string; region?: string } = {}): Promise<TestTenant> {
  const slug = overrides.slug ?? `t-${randomUUID().slice(0, 8)}`
  const { rows } = await getOwnerPool().query<TestTenant>(
    `INSERT INTO tenant (legal_name, slug, region, isolation_tier, db_route, state)
     VALUES ($1, $2, $3, 'pooled', 'pooled', $4) RETURNING id, slug`,
    [`Tenant ${slug}`, slug, overrides.region ?? 'eu', overrides.state ?? 'live'],
  )
  const tenant = rows[0]
  if (tenant === undefined) throw new Error('createTenant: insert returned no row')
  return tenant
}

export interface TestUser {
  id: string
  tenantId: string | null
  email: string
}

/** tenantId null creates a vendor-realm user. passwordHash, when given, is stored as the user's credential. */
export async function createUser(input: {
  tenantId: string | null
  email?: string
  state?: string
  passwordHash?: string
}): Promise<TestUser> {
  const email = input.email ?? `user-${randomUUID().slice(0, 8)}@example.test`
  const owner = getOwnerPool()
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.tenantId, input.tenantId === null ? 'vendor' : 'tenant', randomUUID(), email, input.state ?? 'active'],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('createUser: insert returned no row')
  if (input.passwordHash !== undefined) {
    await owner.query('INSERT INTO password_credential (user_id, password_hash) VALUES ($1, $2)', [
      id,
      input.passwordHash,
    ])
  }
  return { id, tenantId: input.tenantId, email }
}
