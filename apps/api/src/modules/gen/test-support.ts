// TEST FIXTURE ONLY: genealogy rows for GEN integration tests. Rows another module owns (types, participants, settings,
// periods, documents) are written through the owner pool; positions and relationships through the SQL contracts in
// the tenant realm, as PAR enrolment and the case hooks write them. Never import this file from a module index.
import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import fastify from 'fastify'
import { ownerRows, testConfig, type TestUser } from '../../../test/helpers/index.js'
import { runInTenant } from '../../lib/db.js'
import type { Kind } from './read-model.js'
import { rebuildStaleModels } from './rebuild.js'

const DAY_MS = 86_400_000

/** An instant `days` days ago (negative = in the future), ISO text. */
export const daysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString()

/** The database clock now, as timestamptz text (microseconds kept): a known_at between two transactions. */
export async function dbNow(): Promise<string> {
  const [row] = await ownerRows<{ now: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)
  return row!.now
}

export interface TypeFlags {
  readonly holdsPositions: boolean
  readonly endCustomer: boolean
}

/** An active participant type proposed by `preparer` and approved by `approver` (D-B2-09). */
export async function activeType(preparer: TestUser, approver: TestUser, code: string, flags: TypeFlags): Promise<string> {
  const id = randomUUID()
  const [approval] = await ownerRows<{ id: string }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at)
     VALUES ($1, 'participant_type', $2, $3, $4, 'approved', now()) RETURNING id`,
    [preparer.tenantId, id, preparer.id, approver.id],
  )
  await ownerRows(
    `INSERT INTO participant_type (id, tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions,
       state, reason, requested_by, decided_by, decided_at, approval_id)
     VALUES ($1, $2, $3, $3, $4, $5, $4, $4, 'active', 'test', $6, $7, now(), $8)`,
    [id, preparer.tenantId, code, flags.holdsPositions, flags.endCustomer, preparer.id, approver.id, approval!.id],
  )
  return id
}

export interface ParticipantInput {
  readonly displayName?: string
  readonly contact?: Record<string, string>
  readonly at?: string
}

/** A participant of the type from `at` (default 60 days ago). */
export async function participant(by: TestUser, marketId: string, typeId: string, ref: string, input: ParticipantInput = {}): Promise<string> {
  const at = input.at ?? daysAgo(60)
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, contact, enrolled_at, created_by)
     VALUES ($1, $2, 'individual', $3, $4, $5, $6, $7) RETURNING id`,
    [by.tenantId, ref, marketId, input.displayName ?? `Name ${ref}`, input.contact ?? null, at, by.id],
  )
  await ownerRows(
    'INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by) VALUES ($1, $2, $3, $4, $5)',
    [by.tenantId, row!.id, typeId, at, by.id],
  )
  return row!.id
}

/** fn in a tenant transaction acting as the user (the realm the SQL contracts run in). */
export function asUser<T>(user: TestUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTenant({ tenantId: user.tenantId!, userId: user.id }, { actorType: 'user', requestId: null, supportSessionId: null }, fn)
}

async function value<T>(user: TestUser, sql: string, params: unknown[]): Promise<T> {
  return asUser(user, async (tx) => Object.values((await tx.query(sql, params)).rows[0] as object)[0] as T)
}

/** G1: an active position of the participant from `at` (default 60 days ago). */
export function position(by: TestUser, owner: string, marketId: string, ref?: string, at = daysAgo(60)): Promise<string> {
  return value(by, `SELECT gen_create_position($1, $2, NULL, $3, 'active', $4)`, [owner, marketId, ref ?? null, at])
}

/** G2 enrolment row: child under parent from `at` (default 60 days ago). */
export function enrol(by: TestUser, kind: Kind, child: string, parent: string, at = daysAgo(60), leg: string | null = null): Promise<string> {
  return value(by, `SELECT gen_apply_relationship($1, $2, $3, $4, $5, 'enrolment', NULL, NULL)`, [kind, child, parent, leg, at])
}

/** Builds every stale path model now, as the job's run does. */
export function rebuildNow() {
  return rebuildStaleModels({ jobId: randomUUID(), log: fastify({ logger: false }).log, config: testConfig() })
}

/** Marks a model stale, as a write the model does not know about would. */
export async function markStale(tenantId: string, kind: Kind): Promise<void> {
  await ownerRows(
    `INSERT INTO path_model (tenant_id, kind, stale_since) VALUES ($1, $2, now())
     ON CONFLICT (tenant_id, kind) DO UPDATE SET stale_since = coalesce(path_model.stale_since, now())`,
    [tenantId, kind],
  )
}

/**
 * A new settings version with `values` merged into the one in force, effective now. A key that needs an approval
 * (genealogy.visibility_policy) gets an approved setting change request by `approval.approver` in the same transaction.
 */
export async function saveSettings(
  by: TestUser, values: Record<string, unknown>, approval?: { readonly key: string; readonly approver: TestUser },
): Promise<string> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ version: number; settings: Record<string, unknown>; now: Date }>(
      `SELECT coalesce(max(version), 0) AS version, coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1
         ORDER BY effective_from DESC, version DESC LIMIT 1), '{}') AS settings, now() AS now
       FROM tenant_setting_version WHERE tenant_id = $1`,
      [by.tenantId],
    )
    const base = rows[0]!
    const versionId = randomUUID()
    const requestId = randomUUID()
    let approvalId: string | null = null
    if (approval !== undefined) {
      const { rows: approved } = await client.query<{ id: string }>(
        `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at)
         VALUES ($1, 'setting_change_request', $2, $3, $4, 'approved', now()) RETURNING id`,
        [by.tenantId, requestId, by.id, approval.approver.id],
      )
      approvalId = approved[0]!.id
    }
    await client.query(
      `INSERT INTO tenant_setting_version (id, tenant_id, version, effective_from, settings, reason, created_by, approval_id)
       VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)`,
      [versionId, by.tenantId, base.version + 1, { ...base.settings, ...values }, by.id, approvalId],
    )
    if (approval !== undefined) {
      await client.query(
        `INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by,
           decided_by, decided_at, approval_id, version_id)
         VALUES ($1, $2, $3, $4, now(), 'test', $5, 'approved', $6, $7, now(), $8, $9)`,
        [requestId, by.tenantId, approval.key, JSON.stringify(values[approval.key]), base.version, by.id, approval.approver.id, approvalId, versionId],
      )
    }
    await client.query('COMMIT')
    return versionId
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** A committed period [startsAt, endsAt) of the market's calendar (one calendar per market). */
export async function committedPeriod(tenantId: string, marketId: string, startsAt: string, endsAt: string): Promise<string> {
  const [calendar] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, 'Monthly', 'monthly', 'UTC', '2020-01-01')
     ON CONFLICT (tenant_id, market_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [tenantId, marketId],
  )
  const [period] = await ownerRows<{ id: string }>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) VALUES ($1, $2, $3, $4, 'committed') RETURNING id`,
    [tenantId, calendar!.id, startsAt, endsAt],
  )
  return period!.id
}

/** An evidence document uploaded by the user, attachable to one case. */
export async function evidenceDocument(user: TestUser): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, file_name)
     VALUES ($1, 'evidence', 'documents/fixture', sha256(gen_random_uuid()::text::bytea), 'application/pdf', 1, $2, 1, 'fixture.pdf')
     RETURNING id`,
    [user.tenantId, user.id],
  )
  return row!.id
}

/** A G2 correction with a case of its own (the CHECK needs one), in one transaction as the user. */
export function correct(by: TestUser, kind: Kind, child: string, parent: string, validFrom: string): Promise<string> {
  return asUser(by, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by)
       SELECT app_tenant_id(), 'genealogy_correction', 'position', p.id, 'DATA_ENTRY_ERROR', 'open', 'null'::jsonb, p.market_id,
         app_user_id() FROM position p WHERE p.id = $1 RETURNING id`,
      [child],
    )
    const applied = await tx.query<{ id: string }>(
      `SELECT gen_apply_relationship($1, $2, $3, NULL, $4, 'correction', $5, NULL) AS id`,
      [kind, child, parent, validFrom, rows[0]!.id],
    )
    return applied.rows[0]!.id
  })
}

