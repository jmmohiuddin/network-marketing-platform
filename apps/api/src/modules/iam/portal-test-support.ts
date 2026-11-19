import { randomUUID } from 'node:crypto'
import { getOwnerPool } from '@nmp/db/testing'
import { ownerRows } from '../../../test/helpers/index.js'

const SYSTEM = '00000000-0000-0000-0000-000000000000'

export interface MemberOptions {
  /** Contact email; null = none. Default: <ref>@example.test. */
  readonly email?: string | null
  readonly canEarn?: boolean
  /** One owned position in this status; null = no position. Default active. */
  readonly position?: 'active' | 'terminated' | null
}

async function typeOf(tenantId: string, canEarn: boolean): Promise<string> {
  const code = canEarn ? 'FXDIST' : 'FXRETAIL'
  const found = await ownerRows<{ id: string }>('SELECT id FROM participant_type WHERE tenant_id = $1 AND code = $2', [tenantId, code])
  if (found[0] !== undefined) return found[0].id
  // An active type without its approval history: inserted with triggers and keys off (a fixture, not a flow under test).
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state,
         reason, requested_by, decided_by, decided_at, approval_id)
       VALUES ($1, $2, $2, $3, NOT $3, $3, true, 'active', 'fixture', gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid())
       RETURNING id`,
      [tenantId, code, canEarn],
    )
    await client.query('COMMIT')
    return rows[0]!.id
  } finally {
    client.release()
  }
}

/** A participant of the market (owner-inserted): current type, contact email and one owned position by default. */
export async function portalMember(tenantId: string, marketId: string, options: MemberOptions = {}): Promise<{ id: string; ref: string; email: string | null }> {
  const ref = `m-${randomUUID().slice(0, 8)}`
  const email = options.email === undefined ? `${ref}@example.test` : options.email
  const since = new Date(Date.now() - 86_400_000)
  const [participant] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, $4, $5, $6, 'system') RETURNING id`,
    [tenantId, ref, marketId, email === null ? null : { email }, since, SYSTEM],
  )
  const id = participant!.id
  await ownerRows(
    `INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by, created_by_type)
     VALUES ($1, $2, $3, $4, $5, 'system')`,
    [tenantId, id, await typeOf(tenantId, options.canEarn ?? true), since, SYSTEM],
  )
  const status = options.position === undefined ? 'active' : options.position
  if (status !== null) {
    const [position] = await ownerRows<{ id: string }>(
      `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
       VALUES ($1, $2, $3, $4, $5, $6, 'system') RETURNING id`,
      [tenantId, `p-${ref}`, marketId, status, since, SYSTEM],
    )
    await ownerRows(
      `INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
       VALUES ($1, $2, $3, $4, $5, 'system')`,
      [tenantId, position!.id, id, since, SYSTEM],
    )
  }
  return { id, ref, email }
}
