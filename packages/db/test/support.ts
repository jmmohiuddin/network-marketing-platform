import { randomBytes } from 'node:crypto'
import { afterAll } from 'vitest'
import { closePool, getPool, type TenantContext, type Tx } from '../src/index.js'
import { closeOwnerPool } from '../src/testing.js'

export const RLS_VIOLATION = /row-level security policy/
export const PERMISSION_DENIED = /permission denied/
export const FOREIGN_KEY_VIOLATION = '23503'

/** Registers pool shutdown for the calling test file. */
export function closePoolsAfterAll(): void {
  afterAll(async () => {
    await closePool()
    await closeOwnerPool()
  })
}

/** Inserts one row and returns its id. Table and column names are literals from the test source; values are bound. */
export async function insertRow(tx: Tx, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row)
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})
     RETURNING id`,
    Object.values(row),
  )
  return rows[0]!.id
}

export interface OpenedSession {
  id: string
  tokenHash: Buffer
  expiresAt: Date
}

/** Opens an AAL1 session for the transaction's acting user, the only way nmp_app can (auth_open_session, 0041). */
export async function openSession(tx: Tx, minutes = 60, tokenHash: Buffer = randomBytes(32)): Promise<OpenedSession> {
  const { rows } = await tx.query<{ session_id: string; session_expires_at: Date }>(
    'SELECT session_id, session_expires_at FROM auth_open_session($1, $2, NULL, NULL)',
    [tokenHash, minutes],
  )
  return { id: rows[0]!.session_id, tokenHash, expiresAt: rows[0]!.session_expires_at }
}

/** A draft market: the runtime role creates no other (D-B1-17). */
export function insertMarket(tx: Tx, tenantId: string, code = 'GB'): Promise<string> {
  return insertRow(tx, 'market', {
    tenant_id: tenantId, code, currency: 'GBP', minor_unit: 2, time_zone: 'Europe/London', languages: ['en'],
    market_pack: 'gb-1', state: 'draft',
  })
}

/** An evidence document uploaded by the transaction's acting user, referenceable once (D-B1-04). */
export function insertEvidence(tx: Tx, tenantId: string, uploadedBy: string): Promise<string> {
  return insertRow(tx, 'document', {
    tenant_id: tenantId, class: 'evidence', storage_key: 'evidence', sha256: randomBytes(32), mime: 'application/pdf',
    size_bytes: 1, uploaded_by: uploadedBy, version: 1, file_name: 'evidence.pdf',
  })
}

/** Runs write as userId (app.user_id), then restores the transaction's acting user: an approval is the approver's. */
export async function asUser<T>(tx: Tx, userId: string, write: () => Promise<T>): Promise<T> {
  const { rows } = await tx.query<{ previous: string }>(
    `SELECT current_setting('app.user_id', true) AS previous, set_config('app.user_id', $1, true)`,
    [userId],
  )
  const result = await write()
  await tx.query(`SELECT set_config('app.user_id', $1, true)`, [rows[0]!.previous])
  return result
}

export async function insertAuditEvent(tx: Tx, tenantId: string, action: string): Promise<void> {
  await insertRow(tx, 'audit.audit_event', { tenant_id: tenantId, actor_type: 'user', action })
}

export function insertOutboxEvent(tx: Tx, tenantId: string): Promise<string> {
  return insertRow(tx, 'outbox_event', { tenant_id: tenantId, topic: 'audit', key: 'k', payload: { n: 1 } })
}

export async function count(tx: Tx, table: string): Promise<number> {
  // table is a literal from the test source, never external input.
  const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
  return rows[0]!.n
}

/** A raw nmp_app transaction carrying exactly these settings, including combinations the pool helpers never produce. */
export async function withSettings<T>(settings: Record<string, string>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT set_config(s.name, s.value, true) FROM unnest($1::text[], $2::text[]) AS s(name, value)',
      [Object.keys(settings), Object.values(settings)],
    )
    return await fn(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
}

const LOCK_WAIT_MS = 200

/** A tenant-realm transaction on its own connection, acting as ctx's user. */
async function begin(ctx: TenantContext): Promise<Tx> {
  const client = await getPool().connect()
  await client.query('BEGIN')
  await client.query(`SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1, true),
                             set_config('app.user_id', $2, true)`, [ctx.tenantId, ctx.userId])
  return client
}

export interface RaceResult {
  waited: boolean
  outcome: { ok: true } | { ok: false; code: string | undefined }
}

/** Runs first's statement, starts second's (which must wait for first's lock), commits first, then settles second. */
export async function race(ctx: TenantContext, first: (tx: Tx) => Promise<unknown>, second: (tx: Tx) => Promise<unknown>): Promise<RaceResult> {
  const [one, two] = [await begin(ctx), await begin(ctx)]
  try {
    await first(one)
    let settled = false
    const pending = second(two).then(
      () => ({ ok: true as const }),
      (error: { code?: string }) => ({ ok: false as const, code: error.code }),
    ).finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS))
    const waited = !settled
    await one.query('COMMIT')
    const outcome = await pending
    await two.query(outcome.ok ? 'COMMIT' : 'ROLLBACK')
    return { waited, outcome }
  } finally {
    one.release()
    two.release()
  }
}
