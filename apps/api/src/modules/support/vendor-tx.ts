import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { inVendor } from '../../lib/db.js'
import { notFound } from '../../lib/errors.js'

/** Tenant metadata the vendor realm may read (FR-OPS-001, AC-57.1): no business data. */
export interface TenantRow {
  readonly id: string
  readonly slug: string
  readonly legal_name: string
  readonly region: string
  readonly isolation_tier: string
  readonly state: string
  readonly created_by: string | null
}

/** The tenant row, locked for the rest of the vendor transaction; 404 when there is none. */
export async function lockTenant(tx: Tx, tenantId: string): Promise<TenantRow> {
  const { rows } = await tx.query<TenantRow>(
    'SELECT id, slug, legal_name, region, isolation_tier, state, created_by FROM tenant WHERE id = $1 FOR UPDATE',
    [tenantId],
  )
  const tenant = rows[0]
  if (tenant === undefined) throw notFound()
  return tenant
}

/** What the vendor part hands on: the tenant (from a row it read or wrote, never unchecked input) and its own result. */
export interface VendorPartResult {
  readonly tenantId: string
}

/**
 * Moves a vendor-realm transaction into one tenant's realm for the rest of the transaction (E-ADR-21). The actor
 * stays the vendor user (actor type vendor_user), so migration 0011's guard still lets it only request, start
 * and end its own support sessions. tenantId must come from a row the vendor part read or wrote.
 */
export async function enterTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.query(`SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1, true)`, [tenantId])
}

/**
 * One transaction for a vendor action on one tenant (FR-OPS-001: vendor log, and the tenant's log when the
 * tenant is affected). The vendor part runs in the vendor realm; then the same transaction enters that
 * tenant's realm for the tenant part. Both logs commit or roll back together. Use it only for the vendor
 * console actions of ops, support and prv.
 */
export function inVendorThenTenant<V extends VendorPartResult, T>(
  request: FastifyRequest,
  vendorPart: (tx: Tx) => Promise<V>,
  tenantPart: (tx: Tx, vendorResult: V) => Promise<T>,
): Promise<T> {
  return inVendor(request, async (tx) => {
    const vendorResult = await vendorPart(tx)
    await enterTenant(tx, vendorResult.tenantId)
    return tenantPart(tx, vendorResult)
  })
}
