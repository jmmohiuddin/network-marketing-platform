import { beforeAll, describe, expect, test } from 'vitest'
import { getPool, withSystem, withTenant, withVendor, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { seedTenantRows, seedVendorRows, type TenantSeed } from './seed.js'
import {
  closePoolsAfterAll, count, insertAuditEvent, insertMarket, insertOutboxEvent, insertRow, RLS_VIOLATION, withSettings,
} from './support.js'

const TENANT_ID_TABLES = [
  'market', 'tenant_setting_version', 'user_account', 'role', 'role_assignment', 'approval', 'support_session',
  'session', 'audit.audit_event', 'document', 'import_batch', 'import_row_error', 'import_mapping',
  'cpl_fact_participant', 'cpl_fact_order', 'cpl_fact_payout_line', 'compliance_report_snapshot',
  'compliance_figure', 'outbox_event', 'export_job', 'idempotency_key', 'role_grant_request', 'user_invitation',
  'brand', 'calendar', 'period', 'setting_change_request', 'provider_config', 'market_checklist_entry',
  'market_go_live_request', 'service_account', 'api_key', 'case_file', 'case_event', 'case_evidence',
  'webhook_endpoint', 'webhook_delivery',
  // PLAN B2 section 1
  'participant_type', 'participant', 'participant_type_assignment', 'participant_signal', 'agreement_version',
  'agreement_acceptance', 'position', 'position_status_history', 'position_ownership', 'relationship', 'path_model',
  'path_node', 'customer_servicing', 'product_volume_map', 'inbound_event', 'sales_order', 'order_line', 'order_event',
  'late_transaction',
  // PLAN B3 section 1
  'plan', 'plan_market', 'plan_calendar', 'plan_version', 'plan_rule', 'plan_transition', 'golden_dataset',
  'guardrail_decision', 'run_snapshot', 'run', 'result_line', 'qualification_state', 'simulation', 'sim_result_line',
  'adjustment_origin', 'restatement',
  // PLAN B4 section 1
  'ledger_account', 'journal_entry', 'posting', 'gl_account_map', 'journal_export', 'run_settlement',
  'user_related_participant', 'bank_detail_request', 'bank_detail_version', 'payout_batch', 'payout_batch_line',
  'payout_instruction', 'sandbox_provider_payment', 'payout_exception', 'payout_hold', 'tax_profile',
  // PLAN B5 section 1
  'portal_sign_in_code', 'notification', 'notification_preference', 'privacy_request', 'privacy_export',
  // PLAN B6 section 1
  'plan_version_filing', 'data_export', 'data_export_file', 'saved_view', 'migration', 'migration_opening_balance',
  'migration_opening_state', 'parallel_run', 'parallel_run_difference',
  // PLAN B-MKT section 1
  'tax_line', 'tax_form_generation', 'tax_form',
]
// Platform tables (no tenant): every realm reads them, none writes them (pack-rules.test.ts).
const PLATFORM_TABLES = ['guardrail_rule', 'tax_rule', 'pack_rule']
// No tenant_id column: rows follow their user.
const USER_OWNED_TABLES = ['password_credential', 'mfa_credential']
const TENANT_TABLES = ['tenant', ...TENANT_ID_TABLES, ...USER_OWNED_TABLES]
// Tables that also hold vendor-owned rows after the seed (platform roles, vendor users and their sessions).
const VENDOR_TABLES = ['user_account', 'role', 'session', 'password_credential', 'audit.vendor_event']
// All the vendor realm may read of a tenant: metadata, markets and support sessions.
const VENDOR_READABLE_TENANT_TABLES = ['tenant', 'market', 'support_session']

type Probe = [table: string, where: string, value: string]
type Run = (fn: (tx: Tx) => Promise<string[]>) => Promise<string[]>

let a: TenantContext
let b: TenantContext
let vendorUserId: string
let seedA: TenantSeed

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  const [tenantA, tenantB] = [await createTenant(), await createTenant()]
  a = { tenantId: tenantA.id, userId: (await createUser({ tenantId: tenantA.id })).id }
  b = { tenantId: tenantB.id, userId: (await createUser({ tenantId: tenantB.id })).id }
  vendorUserId = (await createUser({ tenantId: null })).id
  // Seeded as nmp_app in its own context: also proves every permitted write path works.
  seedA = await seedTenantRows(a, (await createUser({ tenantId: a.tenantId })).id)
  await seedVendorRows(vendorUserId, a.tenantId)
})

const tenantARows = (): Probe[] => [
  ['tenant', 'id = $1', a.tenantId],
  ...TENANT_ID_TABLES.map((table): Probe => [table, 'tenant_id = $1', a.tenantId]),
  ...USER_OWNED_TABLES.map((table): Probe => [table, 'user_id = $1', a.userId]),
]

const vendorRows = (): Probe[] => [
  ['user_account', 'id = $1', vendorUserId],
  ['role', 'created_by = $1 AND NOT is_base', vendorUserId],
  ['session', 'user_id = $1', vendorUserId],
  ['password_credential', 'user_id = $1', vendorUserId],
  ['audit.vendor_event', 'actor_id = $1', vendorUserId],
]

/** Tables in which the transaction sees at least one of the probed rows. */
async function tablesShowing(tx: Tx, probes: Probe[]): Promise<string[]> {
  const tables: string[] = []
  for (const [table, where, value] of probes) {
    const { rowCount } = await tx.query(`SELECT 1 FROM ${table} WHERE ${where}`, [value])
    if (rowCount !== 0) tables.push(table)
  }
  return tables
}

describe('row visibility as nmp_app', () => {
  test('the seed leaves a tenant A row and a vendor row in every table the runtime role can read', async () => {
    const owner = await getOwnerPool().connect()
    try {
      const readable = await owner.query<{ name: string }>(
        `SELECT replace(c.oid::regclass::text, '"', '') AS name FROM pg_class c
         WHERE c.relkind IN ('r', 'p') AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace)
           AND has_table_privilege('nmp_app', c.oid, 'SELECT')`,
      )

      expect(readable.rows.map((row) => row.name).sort()).toEqual(
        [...new Set([...TENANT_TABLES, ...VENDOR_TABLES, ...PLATFORM_TABLES])].sort(),
      )
      expect(await tablesShowing(owner, tenantARows())).toEqual(TENANT_TABLES)
      expect(await tablesShowing(owner, vendorRows())).toEqual(VENDOR_TABLES)
    } finally {
      owner.release()
    }
  })

  // Each context lists the tables in which it may see tenant A rows and vendor rows; everything else is a leak.
  test.each<[string, () => Run, string[], string[]]>([
    ['tenant A', () => (fn) => withTenant(a, fn), TENANT_TABLES, []],
    ['tenant B', () => (fn) => withTenant(b, fn), [], []],
    ['a connection with no context', () => (fn) => withSettings({}, fn), [], []],
    ['a tenant id without a realm', () => (fn) => withSettings({ 'app.tenant_id': a.tenantId }, fn), [], []],
    ['the system realm', () => withSystem, [], []],
    [
      'the system realm carrying tenant A id',
      () => (fn) => withSettings({ 'app.realm': 'system', 'app.tenant_id': a.tenantId }, fn),
      [],
      [],
    ],
    ['the vendor realm', () => (fn) => withVendor({ userId: vendorUserId }, fn), VENDOR_READABLE_TENANT_TABLES, VENDOR_TABLES],
    [
      'the vendor realm carrying tenant A id',
      () => (fn) => withSettings({ 'app.realm': 'vendor', 'app.tenant_id': a.tenantId }, fn),
      VENDOR_READABLE_TENANT_TABLES,
      VENDOR_TABLES.filter((table) => table !== 'password_credential'), // no acting user: no credential (BUG-002)
    ],
  ])('%s sees only the rows it is entitled to', async (_context, run, tenantTables, vendorTables) => {
    const seesOfTenantA = await run()((tx) => tablesShowing(tx, tenantARows()))
    const seesOfVendor = await run()((tx) => tablesShowing(tx, vendorRows()))

    expect(seesOfTenantA).toEqual(tenantTables)
    expect(seesOfVendor).toEqual(vendorTables)
  })

  test('a pooled connection keeps no tenant context after its transaction ends', async () => {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.realm', 'tenant', true)`, [
        a.tenantId,
      ])
      const inside = await client.query('SELECT 1 FROM market')
      await client.query('COMMIT')
      const after = await client.query('SELECT 1 FROM market')

      expect([inside.rowCount, after.rowCount]).toEqual([1, 0])
    } finally {
      client.release()
    }
  })
})

describe('tenant writes', () => {
  test('tenant B cannot insert a row carrying tenant A id', async () => {
    await expect(withTenant(b, (tx) => insertMarket(tx, a.tenantId, 'FR'))).rejects.toThrow(RLS_VIOLATION)
    await expect(withTenant(b, (tx) => insertAuditEvent(tx, a.tenantId, 'FORGED'))).rejects.toThrow(RLS_VIOLATION)
    await expect(withTenant(b, (tx) => insertOutboxEvent(tx, a.tenantId))).rejects.toThrow(RLS_VIOLATION)
  })

  test('tenant B cannot update, delete or re-home tenant A rows', async () => {
    const affected = await withTenant(b, async (tx) => {
      const updated = await tx.query(`UPDATE market SET state = 'suspended' WHERE id = $1`, [seedA.marketId])
      const deleted = await tx.query('DELETE FROM cpl_fact_order WHERE tenant_id = $1', [a.tenantId])
      return [updated.rowCount, deleted.rowCount]
    })
    const ownMarket = await withTenant(b, (tx) => insertMarket(tx, b.tenantId, 'DE'))

    expect(affected).toEqual([0, 0])
    await expect(
      withTenant(b, (tx) => tx.query('UPDATE market SET tenant_id = $1 WHERE id = $2', [a.tenantId, ownMarket])),
    ).rejects.toThrow(RLS_VIOLATION)
    const { rows } = await getOwnerPool().query('SELECT state FROM market WHERE id = $1', [seedA.marketId])
    expect(rows).toEqual([{ state: 'draft' }])
  })

  test('a tenant reads its own tenant row only and cannot change it', async () => {
    const result = await withTenant(a, async (tx) => {
      const visible = await tx.query<{ id: string }>('SELECT id FROM tenant')
      const updated = await tx.query(`UPDATE tenant SET state = 'archived'`)
      return { ids: visible.rows.map((row) => row.id), updated: updated.rowCount }
    })

    expect(result).toEqual({ ids: [a.tenantId], updated: 0 })
  })

  test('inserts fail without a context, and with a tenant id but no tenant realm', async () => {
    const forge = (settings: Record<string, string>) =>
      withSettings(settings, async (tx) => {
        await insertMarket(tx, a.tenantId, 'US')
      })

    await expect(forge({})).rejects.toThrow(RLS_VIOLATION)
    await expect(forge({ 'app.tenant_id': a.tenantId })).rejects.toThrow(RLS_VIOLATION)
    await expect(forge({ 'app.realm': 'system', 'app.tenant_id': a.tenantId })).rejects.toThrow(RLS_VIOLATION)
    await expect(withSettings({}, (tx) => insertAuditEvent(tx, a.tenantId, 'X'))).rejects.toThrow(RLS_VIOLATION)
  })
})

describe('vendor realm writes', () => {
  test('cannot write business data or change a market, even when carrying a tenant id', async () => {
    const insertBatch = (tx: Tx) =>
      insertRow(tx, 'import_batch', {
        tenant_id: a.tenantId, market_id: seedA.marketId, kind: 'overlay', period_from: '2026-02-01',
        period_to: '2026-02-28', state: 'uploaded', uploaded_by: a.userId,
      })
    const vendor = { userId: vendorUserId }

    await expect(withVendor(vendor, insertBatch)).rejects.toThrow(RLS_VIOLATION)
    await expect(
      withSettings({ 'app.realm': 'vendor', 'app.tenant_id': a.tenantId }, insertBatch),
    ).rejects.toThrow(RLS_VIOLATION)
    await expect(withVendor(vendor, (tx) => insertAuditEvent(tx, a.tenantId, 'FORGED'))).rejects.toThrow(RLS_VIOLATION)
    const updated = await withVendor(vendor, (tx) => tx.query(`UPDATE market SET state = 'suspended'`))
    expect(updated.rowCount).toBe(0)
  })
})

describe('roles (E-ADR-08)', () => {
  test('tenants read base roles but can neither change them nor create platform roles', async () => {
    const rogueBaseRole = { name: 'Rogue', permissions: [], is_base: true, mfa_required: false }

    const result = await withTenant(a, async (tx) => {
      const names = await tx.query<{ name: string }>('SELECT name FROM role ORDER BY name')
      const updated = await tx.query(`UPDATE role SET permissions = '{everything}' WHERE tenant_id IS NULL`)
      const deleted = await tx.query('DELETE FROM role WHERE tenant_id IS NULL')
      return { names: names.rows.map((row) => row.name), changed: [updated.rowCount, deleted.rowCount] }
    })

    expect(result).toEqual({ names: ['Custom', 'Tenant admin'], changed: [0, 0] })
    await expect(withTenant(a, (tx) => insertRow(tx, 'role', rogueBaseRole))).rejects.toThrow(RLS_VIOLATION)
    expect(await withTenant(b, (tx) => count(tx, 'role'))).toBe(1)
  })
})
