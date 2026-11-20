import { describe, expect, test } from 'vitest'
import { closePoolsAfterAll, ownerRows } from '../../../test/helpers/index.js'
import { EXCLUDED_COLUMNS, EXCLUDED_TABLES, EXPORTED_TABLES, KEPT_INTEGRITY_COLUMNS } from './export-model.js'

// T-B6-10 / AC-INT3-2 (D-B6-06): the published model covers every tenant table and names every secret-like column.

closePoolsAfterAll()

// Pointers into platform stores count too (storage_key); a bare `key$` would flag 17 business keys (rule_key, idempotency_key).
const SECRET_LIKE = /_hash$|_sealed$|secret|token|fingerprint|signature|password|storage|^content$/
const named = (list: readonly { table: string; column: string }[]) => new Set(list.map((c) => `${c.table}.${c.column}`))

async function tenantTables(): Promise<{ schema: string; name: string }[]> {
  return ownerRows(
    `SELECT n.nspname AS schema, c.relname AS name FROM information_schema.columns k
     JOIN pg_namespace n ON n.nspname = k.table_schema JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = k.table_name AND c.relkind = 'r'
     WHERE k.table_schema IN ('public', 'audit') AND k.column_name = 'tenant_id' ORDER BY 1, 2`)
}

describe('full export model (T-B6-10)', () => {
  test('every tenant table of public and audit is exported or excluded, and every listed table exists', async () => {
    const tables = await tenantTables()
    const exported = new Set(EXPORTED_TABLES.map((t) => `${t.schema}.${t.name}`))
    const excluded = new Set(EXCLUDED_TABLES.map((t) => (t.name.includes('.') ? t.name : `public.${t.name}`)))
    const existing = await ownerRows<{ name: string }>(
      `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p')`)
    const all = new Set(existing.map((row) => row.name))

    expect(tables.map((t) => `${t.schema}.${t.name}`).filter((t) => !exported.has(t) && !excluded.has(t))).toEqual([])
    expect([...exported, ...excluded].filter((t) => !all.has(t))).toEqual([])
    expect([...exported].filter((t) => excluded.has(t))).toEqual([])
    expect(new Set(EXPORTED_TABLES.map((t) => t.name)).size).toBe(EXPORTED_TABLES.length)
  })

  test('a secret-like column of an exported table is excluded or kept on purpose; every listed column exists', async () => {
    const columns = await ownerRows<{ table: string; column: string }>(
      `SELECT table_name AS table, column_name AS column FROM information_schema.columns
       WHERE (table_schema, table_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
      [EXPORTED_TABLES.map((t) => t.schema), EXPORTED_TABLES.map((t) => t.name)])
    const excluded = named(EXCLUDED_COLUMNS)
    const kept = named(KEPT_INTEGRITY_COLUMNS)
    const present = named(columns)

    expect(columns.filter((c) => SECRET_LIKE.test(c.column)).map((c) => `${c.table}.${c.column}`).filter((c) => !excluded.has(c) && !kept.has(c))).toEqual([])
    expect(columns.filter((c) => c.column.endsWith('_sealed')).every((c) => excluded.has(`${c.table}.${c.column}`))).toBe(true)
    expect([...excluded, ...kept].filter((c) => !present.has(c))).toEqual([])
    expect([...excluded].filter((c) => kept.has(c))).toEqual([])
  })

  test('D-B6-06 names: credential digests, bank fingerprints and the secret pointer are excluded; integrity values are exported', () => {
    const excluded = named(EXCLUDED_COLUMNS)
    const kept = named(KEPT_INTEGRITY_COLUMNS)

    for (const column of ['user_invitation.token_hash', 'api_key.key_hash', 'bank_detail_request.fingerprint', 'bank_detail_version.fingerprint',
      'provider_config.credentials_secret_ref', 'document.storage_key']) expect(excluded.has(column)).toBe(true)
    for (const column of ['run.inputs_hash', 'plan_version.content_hash', 'audit_event.prev_hash', 'run_snapshot.content']) expect(kept.has(column)).toBe(true)
    expect(EXCLUDED_COLUMNS.every((c) => c.reason.length > 0) && KEPT_INTEGRITY_COLUMNS.every((c) => c.reason.length > 0)).toBe(true)
  })
})
