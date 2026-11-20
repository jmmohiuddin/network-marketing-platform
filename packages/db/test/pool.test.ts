import { beforeAll, describe, expect, test } from 'vitest'
import { closePool, getPool, withSystem, withTenant, withVendor, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertMarket } from './support.js'

let ctx: TenantContext
let vendorUserId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  const tenant = await createTenant()
  ctx = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  vendorUserId = (await createUser({ tenantId: null })).id
})

describe('withTenant', () => {
  test('exposes the context as transaction-local settings', async () => {
    const sessionId = '0193a3c0-0000-7000-8000-000000000001'

    const { rows } = await withTenant({ ...ctx, sessionId }, (tx) =>
      tx.query(
        `SELECT current_setting('app.tenant_id') AS tenant, current_setting('app.user_id') AS "user",
                current_setting('app.session_id') AS session, current_setting('app.realm') AS realm`,
      ),
    )

    expect(rows).toEqual([{ tenant: ctx.tenantId, user: ctx.userId, session: sessionId, realm: 'tenant' }])
  })

  test('rolls back everything when the callback throws', async () => {
    const failure = withTenant(ctx, async (tx) => {
      await insertMarket(tx, ctx.tenantId, 'ZZ')
      throw new Error('boom')
    })

    await expect(failure).rejects.toThrow('boom')
    const { rows } = await getOwnerPool().query(`SELECT 1 FROM market WHERE code = 'ZZ'`)
    expect(rows).toEqual([])
  })

  test('opens a repeatable read transaction when asked (D-B6-06), read committed otherwise', async () => {
    const isolation = (tx: Tx) => tx.query<{ level: string }>("SELECT current_setting('transaction_isolation') AS level").then((result) => result.rows[0]!.level)

    expect(await withTenant(ctx, isolation, { isolation: 'repeatable read' })).toBe('repeatable read')
    expect(await withTenant(ctx, isolation)).toBe('read committed')
  })

  test('rejects ids that are not UUIDs before touching the database', () => {
    const injection = `${ctx.tenantId}'; RESET ROLE; --`

    expect(() => withTenant({ ...ctx, tenantId: injection }, async () => 1)).toThrow('tenantId must be a UUID')
    expect(() => withTenant({ ...ctx, userId: '' }, async () => 1)).toThrow('userId must be a UUID')
    expect(() => withVendor({ userId: 'vendor' }, async () => 1)).toThrow('userId must be a UUID')
  })
})

describe('withVendor and withSystem', () => {
  test('define the whole context, so a tenant id left on the connection gives no tenant access', async () => {
    const readContext = async (tx: Tx) => {
      const { rows } = await tx.query(
        `SELECT pg_backend_pid() AS pid, current_setting('app.tenant_id') AS tenant, current_setting('app.user_id') AS "user",
                current_setting('app.session_id') AS session,
                (SELECT count(*)::int FROM user_account WHERE tenant_id IS NOT NULL) AS tenant_users`,
      )
      return rows[0]
    }
    // Session-level settings outlive the statement: the leak a stray SET would cause on a pooled connection.
    const tainted = await getPool().query<{ pid: number }>(
      `SELECT pg_backend_pid() AS pid, set_config('app.tenant_id', $1, false), set_config('app.user_id', $2, false),
              set_config('app.session_id', $2, false)`,
      [ctx.tenantId, ctx.userId],
    )
    const pid = tainted.rows[0]!.pid

    try {
      const system = await withSystem(readContext)
      const vendor = await withVendor({ userId: vendorUserId }, readContext)

      // Same pid: both transactions ran on the tainted connection.
      expect(system).toEqual({ pid, tenant: '', user: '', session: '', tenant_users: 0 })
      expect(vendor).toEqual({ pid, tenant: '', user: vendorUserId, session: '', tenant_users: 0 })
    } finally {
      // Discard the tainted connection.
      await closePool()
    }
  })
})
