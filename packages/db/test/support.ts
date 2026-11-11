import { afterAll } from 'vitest'
import { closePool, getPool, type Tx } from '../src/index.js'
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

export function insertMarket(tx: Tx, tenantId: string, code = 'GB'): Promise<string> {
  return insertRow(tx, 'market', {
    tenant_id: tenantId, code, currency: 'GBP', minor_unit: 2, time_zone: 'Europe/London', languages: ['en'],
    market_pack: 'gb-1', state: 'live',
  })
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
