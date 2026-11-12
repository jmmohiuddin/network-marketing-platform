import { readFile } from 'node:fs/promises'
import pg from 'pg'

const URL = process.env.SPIKE_DATABASE_URL ?? 'postgres://127.0.0.1:5432/nmp_spike'
// Guard: this spike may only ever touch its own disposable database.
if (new globalThis.URL(URL).pathname !== '/nmp_spike') throw new Error(`spike ledger must use database nmp_spike, got ${URL}`)

const SCHEMA_NAME = /^spike_ledger_[a-z0-9_]+$/

export function ledgerPool(schema: string, max = 4): pg.Pool {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`bad schema name ${schema}`)
  return new pg.Pool({ connectionString: URL, max, application_name: 'spike-ledger', options: `-c search_path=${schema}` })
}

/** Drops and recreates the schema. Disposable data only. */
export async function resetSchema(pool: pg.Pool, schema: string): Promise<void> {
  if (!SCHEMA_NAME.test(schema)) throw new Error(`bad schema name ${schema}`)
  const ddl = await readFile(new globalThis.URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}; SET search_path TO ${schema};\n${ddl}`)
}

export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined) // connection may already be broken; the original error matters
    throw error
  } finally {
    client.release()
  }
}
