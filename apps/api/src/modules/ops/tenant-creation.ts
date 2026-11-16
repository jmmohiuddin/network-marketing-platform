import type { Tx } from '@nmp/db'
import { recordAudit, recordVendorAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { assertSameRequest, type VendorIdempotency } from '../support/index.js'

export type IsolationTier = 'pooled' | 'dedicated'

export interface NewMarket {
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
  readonly time_zone: string
  readonly languages: readonly string[]
  /** MVP_A C-20: stored as text only in release A. */
  readonly market_pack: string
}

export interface NewTenant {
  readonly legalName: string
  readonly slug: string
  readonly region: string
  readonly isolationTier: IsolationTier
  /** Pre-condition of FR-TEN-001: the signed DPA (soft reference, DATABASE.md). */
  readonly dpaDocumentId: string
  readonly markets: readonly NewMarket[]
  /** The first admin, and optionally a second one (BUG-014: a privileged grant needs a second admin to approve it). */
  readonly admins: readonly NewAdmin[]
}

export interface NewAdmin {
  readonly email: string
  readonly displayName: string | null
}

// shortcut: engineering region catalogue (OQ-A8; OQ-19: AWS default, India ap-south-1 / ap-south-2). Only the
// pooled tier runs here: no database is created per tenant. Move to deployment config when cells exist.
const REGION_TIERS: Readonly<Record<string, readonly IsolationTier[]>> = {
  eu: ['pooled'],
  'ap-south-1': ['pooled'],
  'ap-south-2': ['pooled'],
}
/** Routing entry of a pooled tenant: the cell's shared database, isolated by RLS. */
const POOLED_ROUTE = 'pooled'
const TENANT_ADMIN_ROLE = 'Tenant admin'
const UNIQUE_VIOLATION = '23505'

/** FR-TEN-001 validation: region available; tier allowed in the region. */
export function assertPlacement(region: string, tier: IsolationTier): void {
  const tiers = REGION_TIERS[region]
  if (tiers === undefined) {
    throw new ApiError(422, 'REGION_UNAVAILABLE', 'This data region is not available.', { regions: Object.keys(REGION_TIERS) })
  }
  if (!tiers.includes(tier)) {
    throw new ApiError(422, 'TIER_NOT_AVAILABLE', `The ${tier} tier is not offered in ${region}.`, { tiers })
  }
}

export interface InsertedTenant {
  readonly tenantId: string
  readonly replayed: boolean
}

async function replay(tx: Tx, creatorId: string, idempotency: VendorIdempotency): Promise<InsertedTenant | null> {
  const { rows } = await tx.query<{ id: string; request_hash: Buffer }>(
    'SELECT id, request_hash FROM tenant WHERE created_by = $1 AND idempotency_key = $2',
    [creatorId, idempotency.key],
  )
  if (rows[0] === undefined) return null
  assertSameRequest(rows[0].request_hash, idempotency)
  return { tenantId: rows[0].id, replayed: true }
}

async function insertRow(tx: Tx, creatorId: string, input: NewTenant, idempotency: VendorIdempotency): Promise<string | null> {
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO tenant (legal_name, slug, region, isolation_tier, db_route, state, dpa_document_id, created_by,
         idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', $6, $7, $8, $9)
       ON CONFLICT (created_by, idempotency_key) DO NOTHING RETURNING id`,
      [input.legalName, input.slug, input.region, input.isolationTier, POOLED_ROUTE, input.dpaDocumentId, creatorId,
        idempotency.key, idempotency.hash],
    )
    return rows[0]?.id ?? null
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError(409, 'SLUG_TAKEN', 'Another tenant already uses this slug.')
    }
    throw error
  }
}

/** Vendor part of tenant creation: the tenant row (vendor realm, policy vendor_manage) and the vendor log. */
export async function insertTenant(tx: Tx, creatorId: string, input: NewTenant, idempotency: VendorIdempotency): Promise<InsertedTenant> {
  const earlier = await replay(tx, creatorId, idempotency)
  if (earlier !== null) return earlier
  assertPlacement(input.region, input.isolationTier)
  const id = await insertRow(tx, creatorId, input, idempotency)
  if (id === null) return (await replay(tx, creatorId, idempotency))! // a concurrent request with this key committed first
  await recordVendorAudit(tx, {
    action: 'TENANT.CREATED', objectType: 'tenant', objectId: id,
    after: { slug: input.slug, region: input.region, isolation_tier: input.isolationTier, markets: input.markets.length },
  })
  return { tenantId: id, replayed: false }
}

async function insertMarkets(tx: Tx, markets: readonly NewMarket[]): Promise<string[]> {
  const ids: string[] = []
  for (const market of markets) {
    // D-B1-17: every market starts draft and goes live only through its launch checklist (market_insert_guard).
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state, created_by)
       VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, 'draft', current_setting('app.user_id')::uuid) RETURNING id`,
      [market.code, market.currency, market.minor_unit, market.time_zone, market.languages, market.market_pack],
    )
    ids.push(rows[0]!.id)
  }
  return ids
}

// shortcut: writes iam's user_account and role_assignment directly (iam/index.ts exports no user facade); call
// iam's facade once it exists.
async function insertFirstAdmin(tx: Tx, admin: NewAdmin): Promise<string> {
  const user = await tx.query<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by)
     VALUES (app_tenant_id(), 'tenant', 'local:' || gen_random_uuid(), $1, $2, 'invited', current_setting('app.user_id')::uuid)
     RETURNING id`,
    [admin.email, admin.displayName],
  )
  return user.rows[0]!.id
}

/** Tenant part of tenant creation, in the new tenant's realm: markets, first admins (no role yet), the tenant's log. */
export async function createTenantRows(tx: Tx, tenantId: string, input: NewTenant): Promise<void> {
  const marketIds = await insertMarkets(tx, input.markets)
  const adminIds: string[] = []
  for (const admin of input.admins) adminIds.push(await insertFirstAdmin(tx, admin))
  await recordAudit(tx, {
    action: 'TENANT.CREATED', objectType: 'tenant', objectId: tenantId,
    after: { region: input.region, isolation_tier: input.isolationTier, market_ids: marketIds, first_admin_ids: adminIds },
  })
  for (const adminId of adminIds) await recordAudit(tx, { action: 'USER.INVITED', objectType: 'user_account', objectId: adminId })
}

/**
 * The first admin's Tenant admin grant (SEC-27 bootstrap), made by the provisioning approval: the approving vendor
 * user (app.user_id) is the second person, and nothing is in effect before that approval.
 */
export async function grantFirstAdminRole(tx: Tx, userId: string): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO role_assignment (tenant_id, user_id, role_id, valid_from, created_by)
     SELECT app_tenant_id(), $1, r.id, now(), current_setting('app.user_id')::uuid
     FROM role r WHERE r.tenant_id IS NULL AND r.is_base AND r.name = $2 RETURNING id`,
    [userId, TENANT_ADMIN_ROLE],
  )
  await recordAudit(tx, {
    action: 'ROLE.GRANTED', objectType: 'role_assignment', objectId: rows[0]!.id,
    after: { user_id: userId, role: TENANT_ADMIN_ROLE, approval: 'provisioning' },
  })
}
