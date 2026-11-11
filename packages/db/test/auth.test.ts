import { createHash, randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { getPool, withSystem, withTenant, withVendor, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { closePoolsAfterAll, count, PERMISSION_DENIED, RLS_VIOLATION } from './support.js'

const ACCOUNT_KEY = 'acme:ada@example.test'

let tenant: TestTenant
let ctx: TenantContext
let otherCtx: TenantContext
let vendorUserId: string

const newTokenHash = () => createHash('sha256').update(randomBytes(32)).digest()

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  tenant = await createTenant({ slug: 'acme' })
  const otherTenant = await createTenant({ slug: 'other' })
  const user = await createUser({ tenantId: tenant.id, email: 'ada@example.test', passwordHash: 'hash-ada' })
  ctx = { tenantId: tenant.id, userId: user.id }
  otherCtx = { tenantId: otherTenant.id, userId: (await createUser({ tenantId: otherTenant.id })).id }
  vendorUserId = (await createUser({ tenantId: null, email: 'ops@example.test', passwordHash: 'hash-ops' })).id
})

function findUser(slug: string | null, email: string) {
  return withSystem((tx) => tx.query('SELECT * FROM auth_find_user($1, $2)', [slug, email]))
}

describe('auth_find_user', () => {
  test('finds a tenant user by tenant slug and email, case-insensitively', async () => {
    const { rows } = await findUser('acme', 'Ada@Example.test')

    expect(rows).toEqual([
      {
        user_id: ctx.userId,
        tenant_id: tenant.id,
        realm: 'tenant',
        state: 'active',
        mfa_enrolled: false,
        password_hash: 'hash-ada',
        tenant_state: 'live',
      },
    ])
  })

  test('does not find the user under another tenant slug or as a vendor', async () => {
    expect((await findUser('other', 'ada@example.test')).rows).toEqual([])
    expect((await findUser(null, 'ada@example.test')).rows).toEqual([])
  })

  test('finds a vendor user only without a tenant slug', async () => {
    expect((await findUser(null, 'ops@example.test')).rows.map((row) => row.user_id)).toEqual([vendorUserId])
    expect((await findUser('acme', 'ops@example.test')).rows).toEqual([])
  })

  test('refuses to run outside the system realm', async () => {
    const call = `SELECT * FROM auth_find_user('acme', 'ada@example.test')`

    await expect(getPool().query(call)).rejects.toThrow(/system realm/)
    await expect(withTenant(otherCtx, (tx) => tx.query(call))).rejects.toThrow(/system realm/)
  })
})

describe('sessions', () => {
  test('a session created in tenant context is found by token hash until revoked', async () => {
    const tokenHash = newTokenHash()
    await withTenant(ctx, (tx) =>
      tx.query(
        `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, expires_at)
         VALUES ($1, $2, $3, 'tenant', 'aal1', now() + interval '12 hours')`,
        [tokenHash, ctx.userId, ctx.tenantId],
      ),
    )
    const find = () => withSystem((tx) => tx.query('SELECT user_id, tenant_id FROM auth_find_session($1)', [tokenHash]))

    const found = await find()
    await withTenant(ctx, (tx) => tx.query('UPDATE session SET revoked_at = now() WHERE token_hash = $1', [tokenHash]))
    const afterRevocation = await find()

    expect(found.rows).toEqual([{ user_id: ctx.userId, tenant_id: ctx.tenantId }])
    expect(afterRevocation.rows).toEqual([])
  })

  test('an expired session is not returned', async () => {
    const tokenHash = newTokenHash()
    await getOwnerPool().query(
      `INSERT INTO session (token_hash, user_id, tenant_id, realm, assurance_level, created_at, expires_at)
       VALUES ($1, $2, $3, 'tenant', 'aal1', now() - interval '2 days', now() - interval '1 day')`,
      [tokenHash, ctx.userId, ctx.tenantId],
    )

    const { rows } = await withSystem((tx) => tx.query('SELECT 1 FROM auth_find_session($1)', [tokenHash]))

    expect(rows).toEqual([])
  })

  test('vendor sessions are visible in the vendor realm only', async () => {
    await withVendor({ userId: vendorUserId }, (tx) =>
      tx.query(
        `INSERT INTO session (token_hash, user_id, realm, assurance_level, expires_at)
         VALUES ($1, $2, 'vendor', 'aal2', now() + interval '1 hour')`,
        [newTokenHash(), vendorUserId],
      ),
    )

    const vendorSees = await withVendor({ userId: vendorUserId }, (tx) => count(tx, 'session'))
    const otherTenantSees = await withTenant(otherCtx, (tx) => count(tx, 'session'))
    expect([vendorSees, otherTenantSees]).toEqual([1, 0])
  })
})

describe('credentials', () => {
  test('are visible and writable only where their user is visible', async () => {
    const own = await withTenant(ctx, (tx) => tx.query('SELECT password_hash FROM password_credential'))
    const other = await withTenant(otherCtx, (tx) => count(tx, 'password_credential'))

    expect(own.rows).toEqual([{ password_hash: 'hash-ada' }])
    expect(other).toBe(0)
    await expect(
      withTenant(otherCtx, (tx) =>
        tx.query(`INSERT INTO mfa_credential (user_id, type, secret_encrypted) VALUES ($1, 'totp', 'x')`, [ctx.userId]),
      ),
    ).rejects.toThrow(RLS_VIOLATION)
  })
})

describe('login attempts', () => {
  const record = (succeeded: boolean) =>
    withSystem((tx) => tx.query(`SELECT auth_record_login_attempt($1, '10.0.0.1', $2)`, [ACCOUNT_KEY, succeeded]))
  const recentFailures = async () => {
    const { rows } = await withSystem((tx) =>
      tx.query<{ n: number }>(`SELECT auth_count_recent_failures($1, now() - interval '15 minutes') AS n`, [ACCOUNT_KEY]),
    )
    return rows[0]!.n
  }

  test('failures are counted per account key and reset by a success', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await record(false)
    const beforeSuccess = await recentFailures()
    await record(true)
    await record(false)

    expect(beforeSuccess).toBe(5)
    expect(await recentFailures()).toBe(1)
  })

  test('the table is not readable by nmp_app in any context', async () => {
    await expect(withTenant(ctx, (tx) => count(tx, 'login_attempt'))).rejects.toThrow(PERMISSION_DENIED)
  })
})
