import { createHash, randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { getPool, withSystem, withTenant, withVendor, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { closePoolsAfterAll, count, openSession, PERMISSION_DENIED, RLS_VIOLATION } from './support.js'

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

function findUser(slug: string | null, email: string, realm = slug === null ? 'vendor' : 'tenant') {
  return withSystem((tx) => tx.query('SELECT * FROM auth_find_user($1, $2, $3)', [realm, slug, email]))
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
        participant_id: null,
        participant_active: true,
      },
    ])
  })

  test('does not find the user under another tenant slug, as a vendor or in the portal realm', async () => {
    expect((await findUser('other', 'ada@example.test')).rows).toEqual([])
    expect((await findUser(null, 'ada@example.test')).rows).toEqual([])
    expect((await findUser('acme', 'ada@example.test', 'portal')).rows).toEqual([])
  })

  test('finds a vendor user only without a tenant slug', async () => {
    expect((await findUser(null, 'ops@example.test')).rows.map((row) => row.user_id)).toEqual([vendorUserId])
    expect((await findUser('acme', 'ops@example.test')).rows).toEqual([])
  })

  test('refuses to run outside the system realm', async () => {
    const call = `SELECT * FROM auth_find_user('tenant', 'acme', 'ada@example.test')`

    await expect(getPool().query(call)).rejects.toThrow(/system realm/)
    await expect(withTenant(otherCtx, (tx) => tx.query(call))).rejects.toThrow(/system realm/)
  })
})

describe('sessions', () => {
  test('a session created in tenant context is found by token hash until revoked', async () => {
    const tokenHash = newTokenHash()
    await withTenant(ctx, (tx) => openSession(tx, 720, tokenHash))
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
    await withVendor({ userId: vendorUserId }, (tx) => openSession(tx))

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

  test('BUG-002: another user of the same tenant can neither read nor write them', async () => {
    const colleague = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
    const newcomerId = (await createUser({ tenantId: tenant.id, state: 'invited' })).id
    await withTenant(ctx, (tx) =>
      tx.query(`INSERT INTO mfa_credential (user_id, type, secret_encrypted) VALUES ($1, 'totp', 'sealed')`, [ctx.userId]),
    )

    const seen = await withTenant(colleague, async (tx) => [await count(tx, 'password_credential'), await count(tx, 'mfa_credential')])
    const overwritten = await withTenant(colleague, (tx) =>
      tx.query(`UPDATE password_credential SET password_hash = 'chosen' WHERE user_id = $1`, [ctx.userId]),
    )

    expect(seen).toEqual([0, 0])
    expect(overwritten.rowCount).toBe(0)
    await expect(
      withTenant(colleague, (tx) =>
        tx.query(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'chosen')`, [newcomerId]),
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

describe('vendor invitations (BUG-011, 0042)', () => {
  const invite = (userId: string, tokenHash: Buffer) => withVendor({ userId: vendorUserId }, (tx) =>
    tx.query(
      `INSERT INTO user_invitation (tenant_id, user_id, token_hash, expires_at, created_by)
       VALUES (NULL, $1, $2, now() + interval '1 hour', $3)`,
      [userId, tokenHash, vendorUserId],
    ))

  test('the vendor realm invites vendor users only; the invitation is found and seen in the vendor realm only', async () => {
    const invitee = await createUser({ tenantId: null, state: 'invited' })
    const tokenHash = newTokenHash()

    await invite(invitee.id, tokenHash)
    const found = await withSystem((tx) => tx.query('SELECT tenant_id, user_id FROM auth_find_invitation($1)', [tokenHash]))

    expect(found.rows).toEqual([{ tenant_id: null, user_id: invitee.id }])
    await expect(invite(ctx.userId, newTokenHash())).rejects.toThrow(RLS_VIOLATION)
    expect(await withTenant(ctx, (tx) => count(tx, 'user_invitation'))).toBe(0)
    expect(await withVendor({ userId: vendorUserId }, (tx) => count(tx, 'user_invitation'))).toBe(1)
  })
})

describe('user_account.firebase_subject (0250)', () => {
  const bind = (userId: string, subject: string) =>
    getOwnerPool().query('UPDATE user_account SET firebase_subject = $2 WHERE id = $1', [userId, subject])

  test('one subject binds one account per tenant, and one account in each of several tenants', async () => {
    const [first, second] = [await createUser({ tenantId: tenant.id }), await createUser({ tenantId: tenant.id })]
    const elsewhere = await createUser({ tenantId: otherCtx.tenantId })
    await bind(first.id, 'person-1')

    await expect(bind(second.id, 'person-1')).rejects.toMatchObject({ code: '23505', constraint: 'user_account_firebase_subject_key' })
    await expect(bind(elsewhere.id, 'person-1')).resolves.toMatchObject({ rowCount: 1 })
  })

  test('vendor accounts (no tenant) share one scope; unbound accounts never collide', async () => {
    const [first, second] = [await createUser({ tenantId: null }), await createUser({ tenantId: null })]
    await bind(first.id, 'vendor-person')

    await expect(bind(second.id, 'vendor-person')).rejects.toMatchObject({ code: '23505' })
    expect((await getOwnerPool().query('SELECT 1 FROM user_account WHERE firebase_subject IS NULL')).rowCount).toBeGreaterThan(2)
  })

  test('a subject is 1..128 characters', async () => {
    const user = await createUser({ tenantId: tenant.id })

    for (const subject of ['', 'x'.repeat(129)]) await expect(bind(user.id, subject)).rejects.toMatchObject({ code: '23514' })
  })
})
