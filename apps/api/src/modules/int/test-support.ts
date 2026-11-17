import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import { ownerRows } from '../../../test/helpers/index.js'

// shortcut: a module test may not import another module's test-support (boundaries.test), so the order fixtures the
// connector tests need repeat ord/test-support.ts in brief; move both into test/helpers when the integrator next touches it.

async function activeType(tenantId: string, code: string, endCustomer: boolean, requesterId: string, approverId: string): Promise<string> {
  const [type] = await ownerRows<{ id: string }>(
    `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason, requested_by)
     VALUES ($1, $2, $2, $3, $4, $3, $3, 'pending', 'fixture', $5) RETURNING id`,
    [tenantId, code, !endCustomer, endCustomer, requesterId],
  )
  const [approval] = await ownerRows<{ id: string }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at)
     VALUES ($1, 'participant_type', $2, $3, $4, 'approved', now()) RETURNING id`,
    [tenantId, type!.id, requesterId, approverId],
  )
  await ownerRows(`UPDATE participant_type SET state = 'active', decided_by = $2, decided_at = now(), approval_id = $3 WHERE id = $1`, [
    type!.id, approverId, approval!.id,
  ])
  return type!.id
}

/** Adds a settings version in force since 2000: the latest values plus `values` (null removes a key). */
export async function setSettings(tenantId: string, userId: string, values: Record<string, unknown>): Promise<void> {
  await ownerRows(
    `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, '2000-01-01T00:00:00Z',
            jsonb_strip_nulls(coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}') || $2),
            'fixture', $3
     FROM tenant_setting_version WHERE tenant_id = $1`,
    [tenantId, values, userId],
  )
}

/** Types DIST and RETAIL, the order settings, and volumes for SKU-A and SKU-B in the market; returns the DIST type. */
export async function commerceTenant(tenantId: string, marketId: string, adminId: string, approverId: string): Promise<string> {
  const distributorType = await activeType(tenantId, 'DIST', false, adminId, approverId)
  await activeType(tenantId, 'RETAIL', true, adminId, approverId)
  await setSettings(tenantId, adminId, {
    'orders.crediting_event': 'paid', 'orders.attribution_precedence': ['link', 'code', 'servicing'], 'orders.new_buyer_type': 'RETAIL',
  })
  for (const [sku, volumes] of [['SKU-A', { qv: '150' }], ['SKU-B', { qv: '100' }]] as const) {
    await ownerRows(
      `INSERT INTO product_volume_map (tenant_id, market_id, sku, item_class, volumes, valid_from, reason, created_by)
       VALUES ($1, $2, $3, 'product', $4, '2020-01-01T00:00:00Z', 'fixture', $5)`,
      [tenantId, marketId, sku, volumes, adminId],
    )
  }
  return distributorType
}

/** A participant of the type with an active position since 2020. */
export async function distributor(tenantId: string, userId: string, marketId: string, typeId: string): Promise<{ externalRef: string; positionId: string; positionRef: string }> {
  const positionRef = `P${randomUUID().slice(0, 8)}`
  const externalRef = `ext-${positionRef}`
  return withTenant({ tenantId, userId }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at) VALUES (app_tenant_id(), $1, 'individual', $2, '2020-01-01') RETURNING id`,
      [externalRef, marketId],
    )
    await tx.query(`INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from) VALUES (app_tenant_id(), $1, $2, '2020-01-01')`, [rows[0]!.id, typeId])
    const position = await tx.query<{ id: string }>(`SELECT gen_create_position($1, $2, NULL, $3, 'active', '2020-01-01') AS id`, [rows[0]!.id, marketId, positionRef])
    return { externalRef, positionId: position.rows[0]!.id, positionRef }
  })
}
