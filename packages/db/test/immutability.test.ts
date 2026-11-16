import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertAuditEvent, insertMarket, insertOutboxEvent, PERMISSION_DENIED } from './support.js'

let ctx: TenantContext
let otherUserId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  const tenant = await createTenant()
  ctx = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  otherUserId = (await createUser({ tenantId: tenant.id })).id
})

function asTenant(sql: string, params: unknown[] = []) {
  return withTenant(ctx, (tx) => tx.query(sql, params))
}

// Given by the acting user, as recordApproval does.
function insertApproval(preparerId: string, approverId: string) {
  return withTenant({ ...ctx, userId: approverId }, (tx) => tx.query(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at)
     VALUES ($1, 'role_assignment', gen_random_uuid(), $2, $3, 'approved', now()) RETURNING id`,
    [ctx.tenantId, preparerId, approverId],
  ))
}

describe('audit log', () => {
  test('nmp_app cannot update, delete or truncate audit events', async () => {
    await withTenant(ctx, (tx) => insertAuditEvent(tx, ctx.tenantId, 'AUTH.SIGN_IN'))

    await expect(asTenant(`UPDATE audit.audit_event SET action = 'X'`)).rejects.toThrow(PERMISSION_DENIED)
    await expect(asTenant('DELETE FROM audit.audit_event')).rejects.toThrow(PERMISSION_DENIED)
    await expect(asTenant('TRUNCATE audit.audit_event')).rejects.toThrow(PERMISSION_DENIED)
  })

  test('the owner role is blocked by the trigger as well', async () => {
    const owner = getOwnerPool()

    await expect(owner.query(`UPDATE audit.audit_event SET action = 'X'`)).rejects.toThrow(
      /UPDATE on audit_event is not allowed/,
    )
    await expect(owner.query('DELETE FROM audit.audit_event')).rejects.toThrow(/DELETE on audit_event is not allowed/)
  })

  test('the database assigns a gapless per-tenant sequence and hash chain that the caller cannot forge', async () => {
    await asTenant(
      `INSERT INTO audit.audit_event (tenant_id, actor_type, action, seq, prev_hash, hash)
       VALUES ($1, 'user', 'ROLE.GRANT', 999, '\\x00', '\\x00')`,
      [ctx.tenantId],
    )

    const result = await withTenant(ctx, async (tx) => {
      // The hash must not depend on the session time zone.
      await tx.query(`SET LOCAL timezone = 'Asia/Dhaka'`)
      const events = await tx.query<{ seq: string; linked: boolean }>(
        `SELECT seq, prev_hash IS NOT DISTINCT FROM lag(hash) OVER (ORDER BY seq) AS linked
         FROM audit.audit_event ORDER BY seq`,
      )
      const broken = await tx.query<{ at: string | null }>('SELECT audit.verify_audit_chain($1) AS at', [ctx.tenantId])
      return { events: events.rows, brokenAt: broken.rows[0]!.at }
    })

    expect(result).toEqual({
      events: [
        { seq: '1', linked: true },
        { seq: '2', linked: true },
      ],
      brokenAt: null,
    })
  })

  test('chain verification reports the first tampered event', async () => {
    const owner = await getOwnerPool().connect()
    try {
      await owner.query('BEGIN')
      await owner.query('ALTER TABLE audit.audit_event DISABLE TRIGGER audit_event_no_mutation')
      await owner.query(`UPDATE audit.audit_event SET action = 'TAMPERED' WHERE tenant_id = $1 AND seq = 2`, [ctx.tenantId])
      await owner.query('ALTER TABLE audit.audit_event ENABLE TRIGGER audit_event_no_mutation')
      await owner.query('COMMIT')
    } finally {
      owner.release()
    }

    const { rows } = await asTenant('SELECT audit.verify_audit_chain($1) AS at', [ctx.tenantId])

    expect(rows).toEqual([{ at: '2' }])
  })
})

describe('outbox', () => {
  test('nmp_app cannot update or delete outbox events', async () => {
    await withTenant(ctx, (tx) => insertOutboxEvent(tx, ctx.tenantId))

    await expect(asTenant(`UPDATE outbox_event SET payload = '{}'`)).rejects.toThrow(PERMISSION_DENIED)
    await expect(asTenant('UPDATE outbox_event SET dispatched_at = now()')).rejects.toThrow(PERMISSION_DENIED)
    await expect(asTenant('DELETE FROM outbox_event')).rejects.toThrow(PERMISSION_DENIED)
  })

  test('the dispatcher claims due events across tenants and settles them once', async () => {
    const claimed = await withSystem(async (tx) => {
      const { rows } = await tx.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM outbox_claim(10)')
      for (const row of rows) await tx.query('SELECT outbox_settle($1, true)', [row.id])
      return rows
    })
    const remaining = await withSystem((tx) => tx.query('SELECT 1 FROM outbox_claim(10)'))

    expect(claimed.map((row) => row.tenant_id)).toEqual([ctx.tenantId])
    expect(remaining.rowCount).toBe(0)
    await expect(withSystem((tx) => tx.query('SELECT outbox_settle($1, true)', [claimed[0]!.id]))).rejects.toThrow(
      /already dispatched/,
    )
  })

  test('a failed delivery is rescheduled, then marked dead when no retry time is given', async () => {
    const id = await withTenant(ctx, (tx) => insertOutboxEvent(tx, ctx.tenantId))

    await withSystem((tx) => tx.query(`SELECT outbox_settle($1, false, now() + interval '1 hour')`, [id]))
    const whileWaiting = await withSystem((tx) => tx.query('SELECT 1 FROM outbox_claim(10)'))
    await withSystem((tx) => tx.query('SELECT outbox_settle($1, false)', [id]))

    const { rows } = await getOwnerPool().query('SELECT attempts, dead, dispatched_at FROM outbox_event WHERE id = $1', [id])
    expect(whileWaiting.rowCount).toBe(0)
    expect(rows).toEqual([{ attempts: 2, dead: true, dispatched_at: null }])
  })

  test('the dispatch functions refuse to run outside the system realm', async () => {
    await expect(asTenant('SELECT 1 FROM outbox_claim(10)')).rejects.toThrow(/system realm/)
  })

  test('the trigger blocks deletes, payload edits and edits of dispatched rows even for the owner', async () => {
    const owner = getOwnerPool()

    await expect(owner.query('DELETE FROM outbox_event')).rejects.toThrow(/DELETE on outbox_event is not allowed/)
    await expect(owner.query(`UPDATE outbox_event SET payload = '{}' WHERE dispatched_at IS NULL`)).rejects.toThrow(
      /only dispatch fields/,
    )
    await expect(owner.query('UPDATE outbox_event SET attempts = 9 WHERE dispatched_at IS NOT NULL')).rejects.toThrow(
      /already dispatched/,
    )
  })
})

describe('approval', () => {
  test('self-approval is rejected', async () => {
    await expect(insertApproval(ctx.userId, ctx.userId)).rejects.toThrow(/approval_approver_is_not_preparer/)
  })

  test('an approval by a second person is stored and is then immutable', async () => {
    const { rows } = await insertApproval(ctx.userId, otherUserId)

    expect(rows).toHaveLength(1)
    await expect(asTenant(`UPDATE approval SET decision = 'rejected'`)).rejects.toThrow(PERMISSION_DENIED)
    await expect(getOwnerPool().query('DELETE FROM approval')).rejects.toThrow(/DELETE on approval is not allowed/)
  })
})

describe('state-dependent immutability', () => {
  test('an approved import mapping can no longer be changed or deleted', async () => {
    await withTenant(ctx, async (tx) => {
      await tx.query(`INSERT INTO import_mapping (tenant_id, version, mappings, state) VALUES ($1, 1, '{}', 'draft')`, [
        ctx.tenantId,
      ])
      await tx.query(`UPDATE import_mapping SET mappings = '{"a":"b"}'`)
      await tx.query(`UPDATE import_mapping SET state = 'approved', approved_by = $1`, [otherUserId])
    })

    await expect(asTenant(`UPDATE import_mapping SET notes = 'late edit'`)).rejects.toThrow(/approved versions are immutable/)
    await expect(asTenant('DELETE FROM import_mapping')).rejects.toThrow(/approved versions are immutable/)
  })

  test('a report snapshot only moves through its states and keeps its inputs', async () => {
    await withTenant(ctx, async (tx) => {
      const marketId = await insertMarket(tx, ctx.tenantId)
      await tx.query(
        `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version,
           input_refs, state, created_by, inputs_hash)
         VALUES ($1, $2, '2026-01-01', '2026-03-31', 'm1', '{}', 'computing', $3, '\\x01')`,
        [ctx.tenantId, marketId, ctx.userId],
      )
      await tx.query(`UPDATE compliance_report_snapshot SET state = 'ready'`)
    })

    await expect(asTenant(`UPDATE compliance_report_snapshot SET method_version = 'm2'`)).rejects.toThrow(
      /may change only state/,
    )
    await expect(asTenant(`UPDATE compliance_report_snapshot SET state = 'computing'`)).rejects.toThrow(
      /cannot change from ready to computing/,
    )
    await expect(asTenant('DELETE FROM compliance_report_snapshot')).rejects.toThrow(PERMISSION_DENIED)
    expect((await asTenant(`UPDATE compliance_report_snapshot SET state = 'outdated'`)).rowCount).toBe(1)
  })

  test('tenant.region cannot change after the first data load', async () => {
    const owner = getOwnerPool()
    await owner.query(`UPDATE tenant SET region = 'uk' WHERE id = $1`, [ctx.tenantId])
    await owner.query(
      `INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, uploaded_by)
       SELECT $1, id, 'overlay', '2026-01-01', '2026-01-31', 'loaded', $2 FROM market WHERE tenant_id = $1`,
      [ctx.tenantId, ctx.userId],
    )

    await expect(owner.query(`UPDATE tenant SET region = 'eu' WHERE id = $1`, [ctx.tenantId])).rejects.toThrow(
      /region cannot change after the first data load/,
    )
  })
})
