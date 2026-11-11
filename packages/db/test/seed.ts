import { randomBytes } from 'node:crypto'
import { withTenant, withVendor, type TenantContext } from '../src/index.js'
import { insertAuditEvent, insertMarket, insertOutboxEvent, insertRow } from './support.js'

const PERIOD = { period_from: '2026-01-01', period_to: '2026-01-31' }
const ONE_HOUR_MS = 3_600_000

export const inOneHour = (): Date => new Date(Date.now() + ONE_HOUR_MS)

export interface TenantSeed {
  marketId: string
  roleId: string
  approvalId: string
  settingsVersionId: string
  documentId: string
  mappingId: string
  batchId: string
  snapshotId: string
}

/**
 * Writes one row into every tenant-scoped table as nmp_app in the tenant's own context, so a denial
 * assertion always has a row it could have seen. secondUserId is another user of the same tenant.
 */
export function seedTenantRows(ctx: TenantContext, secondUserId: string): Promise<TenantSeed> {
  const tenant_id = ctx.tenantId
  return withTenant(ctx, async (tx) => {
    const marketId = await insertMarket(tx, tenant_id)
    const roleId = await insertRow(tx, 'role', {
      tenant_id, name: 'Custom', permissions: ['import.manage'], is_base: false, mfa_required: false,
    })
    const approvalId = await insertRow(tx, 'approval', {
      tenant_id, object_type: 'role_assignment', object_id: roleId, preparer_id: ctx.userId,
      approver_id: secondUserId, decision: 'approved', decided_at: new Date(),
    })
    await insertRow(tx, 'role_assignment', {
      tenant_id, user_id: secondUserId, role_id: roleId, valid_from: new Date(), approval_id: approvalId,
    })
    await insertRow(tx, 'role_grant_request', {
      tenant_id, user_id: secondUserId, role_id: roleId, requested_by: ctx.userId, state: 'pending',
    })
    await insertRow(tx, 'user_invitation', {
      tenant_id, user_id: secondUserId, token_hash: randomBytes(32), expires_at: inOneHour(), created_by: ctx.userId,
    })
    const settingsVersionId = await insertRow(tx, 'tenant_setting_version', {
      tenant_id, version: 1, effective_from: new Date(), settings: {}, reason: 'seed', created_by: ctx.userId,
      approval_id: approvalId,
    })
    const documentId = await insertRow(tx, 'document', {
      tenant_id, class: 'evidence', storage_key: 'seed', sha256: randomBytes(32), mime: 'text/csv', size_bytes: 1,
      uploaded_by: ctx.userId, version: 1,
    })
    const mappingId = await insertRow(tx, 'import_mapping', { tenant_id, version: 1, mappings: {}, state: 'draft' })
    const batchId = await insertRow(tx, 'import_batch', {
      tenant_id, market_id: marketId, kind: 'overlay', ...PERIOD, state: 'mapped', mapping_id: mappingId,
      uploaded_by: ctx.userId,
    })
    await insertRow(tx, 'import_row_error', { tenant_id, batch_id: batchId, file: 'orders.csv', code: 'E1' })
    await insertRow(tx, 'cpl_fact_participant', {
      tenant_id, source: 'import', batch_id: batchId, participant_ref: 'p1', type_code: 'distributor',
      counts_as_end_customer: false, can_earn: true, enrolled_month: '2026-01-01', market_id: marketId,
    })
    await insertRow(tx, 'cpl_fact_order', {
      tenant_id, source: 'import', batch_id: batchId, order_ref: 'o1', order_date: '2026-01-05', buyer_ref: 'p1',
      amount_minor: 10000, volume_minor: 8000, purpose: 'customer', is_starter_kit: false, refunded_minor: 0,
    })
    await insertRow(tx, 'cpl_fact_payout_line', {
      tenant_id, source: 'import', batch_id: batchId, line_ref: 'l1', pay_month: '2026-01-01', payee_ref: 'p1',
      bonus_type: 'retail', source_kind: 'retail_sale', amount_minor: 500,
    })
    // Facts are written while the batch is mapped, as the load does (migration 0031).
    await tx.query(`UPDATE import_batch SET state = 'loaded' WHERE id = $1`, [batchId])
    const snapshotId = await insertRow(tx, 'compliance_report_snapshot', {
      tenant_id, market_id: marketId, ...PERIOD, method_version: 'm1', mapping_id: mappingId,
      settings_version_id: settingsVersionId, input_refs: {}, state: 'computing', created_by: ctx.userId,
      inputs_hash: randomBytes(32),
    })
    await insertRow(tx, 'compliance_figure', { tenant_id, snapshot_id: snapshotId, report: 'R1', key: 'k' })
    await insertRow(tx, 'export_job', {
      tenant_id, kind: 'audit', document_id: documentId, requested_by: ctx.userId, state: 'done',
    })
    await insertRow(tx, 'session', {
      token_hash: randomBytes(32), user_id: ctx.userId, tenant_id, realm: 'tenant', assurance_level: 'aal1',
      expires_at: inOneHour(),
    })
    await insertRow(tx, 'mfa_credential', { user_id: ctx.userId, type: 'totp', secret_encrypted: 'seed' })
    // The next two tables have no id column.
    await tx.query(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'seed')`, [ctx.userId])
    await tx.query(
      `INSERT INTO idempotency_key (tenant_id, key, route, request_hash) VALUES ($1, 'seed', 'POST /v1/imports', $2)`,
      [tenant_id, randomBytes(32)],
    )
    await insertAuditEvent(tx, tenant_id, 'TEST.SEED')
    await insertOutboxEvent(tx, tenant_id)
    return { marketId, roleId, approvalId, settingsVersionId, documentId, mappingId, batchId, snapshotId }
  })
}

export interface VendorSeed {
  baseRoleId: string
  vendorRoleId: string
  supportSessionId: string
}

/** Vendor-owned rows, and a support-session request for tenantId, written as nmp_app in the vendor realm. */
export function seedVendorRows(vendorUserId: string, tenantId: string): Promise<VendorSeed> {
  return withVendor({ userId: vendorUserId }, async (tx) => {
    const platformRole = { permissions: ['user.manage'], mfa_required: true, created_by: vendorUserId }
    const baseRoleId = await insertRow(tx, 'role', { ...platformRole, name: 'Tenant admin', is_base: true })
    const vendorRoleId = await insertRow(tx, 'role', { ...platformRole, name: 'Vendor ops', is_base: false })
    await insertRow(tx, 'session', {
      token_hash: randomBytes(32), user_id: vendorUserId, realm: 'vendor', assurance_level: 'aal2',
      expires_at: inOneHour(),
    })
    await tx.query(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'seed')`, [vendorUserId])
    await insertRow(tx, 'audit.vendor_event', {
      actor_type: 'vendor_user', actor_id: vendorUserId, action: 'SUPPORT.REQUEST',
    })
    const supportSessionId = await insertRow(tx, 'support_session', {
      tenant_id: tenantId, requester_id: vendorUserId, reason: 'ticket 1', scope: { modules: ['import'] },
      requested_minutes: 30, state: 'requested',
    })
    return { baseRoleId, vendorRoleId, supportSessionId }
  })
}
