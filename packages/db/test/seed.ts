import { randomBytes, randomUUID } from 'node:crypto'
import { withTenant, withVendor, type TenantContext, type Tx } from '../src/index.js'
import { asUser, insertAuditEvent, insertEvidence, insertMarket, insertOutboxEvent, insertRow, openSession } from './support.js'

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
  brandId: string
  calendarId: string
  caseId: string
  endpointId: string
  outboxEventId: string
  serviceAccountId: string
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
    const approvalId = await asUser(tx, secondUserId, () => insertRow(tx, 'approval', {
      tenant_id, object_type: 'role_assignment', object_id: roleId, preparer_id: ctx.userId,
      approver_id: secondUserId, decision: 'approved', decided_at: new Date(),
    }))
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
    await openSession(tx)
    await insertRow(tx, 'mfa_credential', { user_id: ctx.userId, type: 'totp', secret_encrypted: 'seed' })
    // The next two tables have no id column.
    await tx.query(`INSERT INTO password_credential (user_id, password_hash) VALUES ($1, 'seed')`, [ctx.userId])
    await tx.query(
      `INSERT INTO idempotency_key (tenant_id, key, route, request_hash) VALUES ($1, 'seed', 'POST /v1/imports', $2)`,
      [tenant_id, randomBytes(32)],
    )
    await insertAuditEvent(tx, tenant_id, 'TEST.SEED')
    const outboxEventId = await insertOutboxEvent(tx, tenant_id)
    const b1 = await seedB1Rows(tx, ctx, marketId, outboxEventId)
    return { marketId, roleId, approvalId, settingsVersionId, documentId, mappingId, batchId, snapshotId, outboxEventId, ...b1 }
  })
}

/** One row in every B1 tenant table (PLAN B1 section 1), each document referenced once by its uploader. */
async function seedB1Rows(tx: Tx, ctx: TenantContext, marketId: string, outboxEventId: string) {
  const tenant_id = ctx.tenantId
  const evidence = () => insertEvidence(tx, tenant_id, ctx.userId)
  const brandId = await insertRow(tx, 'brand', { tenant_id, name: 'Seed brand' })
  const calendarId = await insertRow(tx, 'calendar', {
    tenant_id, market_id: marketId, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/London',
    first_period_start: '2026-01-01',
  })
  await insertRow(tx, 'period', {
    tenant_id, calendar_id: calendarId, starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-02-01T00:00:00Z',
  })
  await insertRow(tx, 'setting_change_request', {
    tenant_id, key: 'money.rounding_mode', value: JSON.stringify('half_even'), effective_from: inOneHour(),
    reason: 'seed', base_version: 1, state: 'pending', requested_by: ctx.userId,
  })
  await insertRow(tx, 'provider_config', {
    tenant_id, market_id: marketId, kind: 'payout', provider: 'Sandbox payouts', approved_description: 'seed',
    approval_document_id: await evidence(), approved_at: '2026-01-01', funds_holder: 'Provider', state: 'recorded',
    created_by: ctx.userId,
  })
  await insertRow(tx, 'market_checklist_entry', {
    tenant_id, market_id: marketId, item: 'licence_evidence', document_id: await evidence(), recorded_by: ctx.userId,
  })
  await insertRow(tx, 'market_go_live_request', {
    tenant_id, market_id: marketId, state: 'pending', requested_by: ctx.userId, checklist: {},
    risk_document_id: await evidence(),
  })
  const serviceAccountId = await insertRow(tx, 'service_account', {
    tenant_id, name: 'BI export', purpose: 'seed', state: 'active', created_by: ctx.userId,
  })
  await insertRow(tx, 'api_key', {
    tenant_id, service_account_id: serviceAccountId, name: 'seed', key_prefix: 'nmpk_abcdefg',
    key_hash: randomBytes(32).toString('hex'), scopes: ['compliance:read'], rate_tier: 'standard', created_by: ctx.userId,
  })
  const caseId = await insertRow(tx, 'case_file', {
    tenant_id, type: 'adjustment', subject_type: 'test_subject', subject_id: randomUUID(), reason_code: 'seed',
    state: 'open', payload: {}, market_id: marketId, opened_by: ctx.userId,
  })
  await insertRow(tx, 'case_event', { tenant_id, case_id: caseId, actor_id: ctx.userId, kind: 'opened' })
  await insertRow(tx, 'case_evidence', { tenant_id, case_id: caseId, document_id: await evidence(), added_by: ctx.userId })
  const endpointId = await insertRow(tx, 'webhook_endpoint', {
    tenant_id, url: 'https://hooks.example.test/nmp', secret_sealed: 'sealed', topics: ['audit'], state: 'active',
    created_by: ctx.userId,
  })
  await insertRow(tx, 'webhook_delivery', {
    tenant_id, endpoint_id: endpointId, outbox_event_id: outboxEventId, attempt: 1, outcome: 'scheduled',
    next_attempt_at: new Date(),
  })
  return { brandId, calendarId, caseId, endpointId, serviceAccountId }
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
    await openSession(tx)
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
