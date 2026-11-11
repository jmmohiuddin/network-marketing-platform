import pg from 'pg'

/** A client inside an open transaction that already carries the request context. */
export type Tx = pg.PoolClient

export interface TenantContext {
  tenantId: string
  userId: string
  sessionId?: string
}

export interface VendorContext {
  userId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Every helper starts from this, so a transaction never inherits a setting it did not define itself
// (for example a session-level app.tenant_id left on a pooled connection).
const NO_CONTEXT = { 'app.realm': '', 'app.tenant_id': '', 'app.user_id': '', 'app.session_id': '' }

let pool: pg.Pool | undefined

/** Runtime pool (role nmp_app: subject to RLS, no DDL). */
export function getPool(): pg.Pool {
  if (pool !== undefined) return pool
  const connectionString = process.env.DATABASE_URL
  if (connectionString === undefined || connectionString === '') throw new Error('DATABASE_URL is not set')
  pool = new pg.Pool({ connectionString })
  return pool
}

export async function closePool(): Promise<void> {
  const current = pool
  pool = undefined
  await current?.end()
}

function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`${name} must be a UUID`)
}

// Settings are bound parameters of set_config(..., true): transaction-local, never interpolated.
async function inTransaction<T>(settings: Record<string, string>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  let connectionError: Error | undefined
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT set_config(s.name, s.value, true) FROM unnest($1::text[], $2::text[]) AS s(name, value)',
      [Object.keys(settings), Object.values(settings)],
    )
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      // The connection is unusable: discard it instead of returning it to the pool.
      connectionError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
    }
    throw error
  } finally {
    client.release(connectionError)
  }
}

/** Runs fn in one transaction scoped to a tenant. tenantId must come from the authenticated session. */
export function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.tenantId, 'tenantId')
  assertUuid(ctx.userId, 'userId')
  if (ctx.sessionId !== undefined) assertUuid(ctx.sessionId, 'sessionId')
  return inTransaction(
    {
      ...NO_CONTEXT,
      'app.realm': 'tenant',
      'app.tenant_id': ctx.tenantId,
      'app.user_id': ctx.userId,
      'app.session_id': ctx.sessionId ?? '',
    },
    fn,
  )
}

/** Runs fn in one transaction in the vendor realm: tenant metadata and vendor rows only, no business data. */
export function withVendor<T>(ctx: VendorContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  assertUuid(ctx.userId, 'userId')
  return inTransaction({ ...NO_CONTEXT, 'app.realm': 'vendor', 'app.user_id': ctx.userId }, fn)
}

/**
 * Runs fn in one transaction with no tenant: no table rows are visible. Only for the system-realm
 * functions (auth_find_user, auth_find_session, auth_record_login_attempt, auth_count_recent_failures,
 * outbox_claim, outbox_settle).
 */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction({ ...NO_CONTEXT, 'app.realm': 'system' }, fn)
}
