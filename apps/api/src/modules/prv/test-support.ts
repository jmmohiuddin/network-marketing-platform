import { randomUUID } from 'node:crypto'
import { getOwnerPool } from '@nmp/db/testing'
import { ownerRows } from '../../../test/helpers/index.js'

const SYSTEM = '00000000-0000-0000-0000-000000000000'

/** A participant of the market with a contact email (owner-inserted). */
export async function member(tenantId: string, marketId: string): Promise<{ id: string; ref: string; email: string }> {
  const ref = `m-${randomUUID().slice(0, 8)}`
  const email = `${ref}@example.test`
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $4, $5, now(), $6, 'system') RETURNING id`,
    [tenantId, ref, marketId, `Name of ${ref}`, { email, phone: '+44 20 7946 0000' }, SYSTEM],
  )
  return { id: row!.id, ref, email }
}

/** A settings version in force now with key = value and its approved change request (owner), as the API writes it. */
export async function setSetting(tenantId: string, requesterId: string, approverId: string, key: string, value: unknown): Promise<void> {
  await ownerRows(
    `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                VALUES ($1, 'setting_change_request', $4, $5, $6, 'approved', now(), $6) RETURNING id),
          v AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
                SELECT $1, coalesce((SELECT max(version) FROM tenant_setting_version WHERE tenant_id = $1), 0) + 1, now(),
                       coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}')
                         || jsonb_build_object($2::text, $3::jsonb), 'FIXTURE', $5, (SELECT id FROM a) RETURNING id, effective_from)
     INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, decided_by,
       decided_at, approval_id, version_id)
     SELECT $4, $1, $2, $3::jsonb, v.effective_from, 'FIXTURE', 0, 'approved', $5, $6, now(), a.id, v.id FROM a, v`,
    [tenantId, key, JSON.stringify(value), randomUUID(), requesterId, approverId],
  )
}

/** One statement with triggers and keys off: moving a set-once fixture value (time travel), never a flow under test. */
export async function ownerUnchecked(sql: string, params: unknown[]): Promise<void> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    await client.query(sql, params)
    await client.query('COMMIT')
  } finally {
    client.release()
  }
}
