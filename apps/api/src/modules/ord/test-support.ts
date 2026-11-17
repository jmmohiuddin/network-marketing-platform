import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { call, ownerRows, type TestUser } from '../../../test/helpers/index.js'

// Test fixtures for orders and connectors. Participants, types, positions and settings are written directly (owner pool
// or the shared SQL functions): ORD never imports PAR, GEN or TEN code (D-B2-02).

export interface TypeFlags {
  readonly can_earn: boolean
  readonly counts_as_end_customer: boolean
  readonly can_sponsor: boolean
  readonly can_hold_positions: boolean
}

export const DISTRIBUTOR: TypeFlags = { can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true }
export const RETAIL: TypeFlags = { can_earn: false, counts_as_end_customer: true, can_sponsor: false, can_hold_positions: false }

/** An active participant type proposed by requesterId and approved by approverId. */
export async function activeType(tenantId: string, code: string, flags: TypeFlags, requesterId: string, approverId: string): Promise<string> {
  const [type] = await ownerRows<{ id: string }>(
    `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason, requested_by)
     VALUES ($1, $2, $2, $3, $4, $5, $6, 'pending', 'fixture', $7) RETURNING id`,
    [tenantId, code, flags.can_earn, flags.counts_as_end_customer, flags.can_sponsor, flags.can_hold_positions, requesterId],
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

/** Adds a settings version in force since 2000 holding the latest values plus `values` (null removes a key). */
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

/** The order settings every ingestion needs (values chosen by the test, not defaults). */
export const ORDER_SETTINGS = {
  'orders.crediting_event': 'paid',
  'orders.attribution_precedence': ['link', 'code', 'servicing'],
  'orders.new_buyer_type': 'RETAIL',
}

export interface FixturePosition {
  readonly participantId: string
  readonly positionId: string
  readonly positionRef: string
}

/** A participant of the type with an active position from `at`, written through G1 as `userId`. */
export async function participantWithPosition(
  tenantId: string, userId: string, marketId: string, typeId: string, at = '2020-01-01T00:00:00Z',
): Promise<FixturePosition> {
  const ref = `P${randomUUID().slice(0, 8)}`
  return withTenant({ tenantId, userId }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at) VALUES (app_tenant_id(), $1, 'individual', $2, $3) RETURNING id`,
      [`ext-${ref}`, marketId, at],
    )
    const participantId = rows[0]!.id
    await tx.query('INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from) VALUES (app_tenant_id(), $1, $2, $3)', [participantId, typeId, at])
    const position = await tx.query<{ id: string }>(`SELECT gen_create_position($1, $2, NULL, $3, 'active', $4) AS id`, [participantId, marketId, ref, at])
    return { participantId, positionId: position.rows[0]!.id, positionRef: ref }
  })
}

/** A monthly calendar for the market with one committed period [startsAt, endsAt). */
export async function committedPeriod(tenantId: string, marketId: string, startsAt: string, endsAt: string): Promise<string> {
  const [calendar] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, $3, 'monthly', 'UTC', $4::date) RETURNING id`,
    [tenantId, marketId, `cal-${randomUUID().slice(0, 8)}`, startsAt],
  )
  const [period] = await ownerRows<{ id: string }>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) VALUES ($1, $2, $3, $4, 'committed') RETURNING id`,
    [tenantId, calendar!.id, startsAt, endsAt],
  )
  return period!.id
}

/** A key of a new service account with the scopes, minted through the API by an admin with step-up. */
export async function apiKey(app: FastifyInstance, admin: TestUser, scopes: readonly string[]): Promise<string> {
  const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body: { name: randomUUID(), purpose: 'store' }, idempotencyKey: true })
  const key = await call(app, {
    method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as: admin,
    body: { name: 'orders', scopes, rate_tier: 'high' }, idempotencyKey: true,
  })
  if (key.statusCode !== 201) throw new Error(`key not minted: ${key.body}`)
  return key.json().data.token as string
}

/** POST with a bearer key, no session and no X-Requested-With (key callers are exempt from the CSRF header). */
export function asKey(app: FastifyInstance, token: string, url: string, body: unknown, idempotencyKey: string = randomUUID()) {
  return app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey }, payload: body as object })
}

/** Per-unit volumes for a SKU from validFrom, through the API. */
export async function volumes(
  app: FastifyInstance, admin: TestUser, marketId: string, sku: string, perUnit: Record<string, string>, validFrom = '2020-01-01T00:00:00Z',
): Promise<void> {
  const response = await call(app, {
    method: 'POST', url: '/v1/product-volumes', as: admin, idempotencyKey: true,
    body: { market_id: marketId, sku, item_class: 'product', volumes: perUnit, valid_from: validFrom, reason: 'fixture' },
  })
  if (response.statusCode !== 201) throw new Error(`volumes not set: ${response.body}`)
}

let sequence = 0

/** A valid API-10 body (paid now, two lines of SKU-A and SKU-B); override any field. */
export function orderBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  sequence += 1
  const at = new Date(Date.now() - 60_000).toISOString()
  return {
    source_system: 'shop', source_order_id: `o-${randomUUID()}-${sequence}`, market: 'GB', buyer: { external_ref: `buyer-${randomUUID()}` },
    ordered_at: at, paid_at: at, currency: 'GBP', amount_minor: '3000', tax_minor: '500',
    lines: [{ line_no: 1, sku: 'SKU-A', quantity: 2, amount_minor: '2000' }, { line_no: 2, sku: 'SKU-B', quantity: 1, amount_minor: '1000' }],
    ...overrides,
  }
}

export interface OrdersTenant {
  readonly tenantId: string
  readonly marketId: string
  /** Tenant admin with step-up: mints keys, sets volumes, reads orders. */
  readonly admin: TestUser
  readonly distributorType: string
  readonly retailType: string
  /** Key with orders:write. */
  readonly token: string
}

/** A tenant with live market GB, types DIST and RETAIL, the order settings, SKU-A {qv 150, bv 7} and SKU-B {qv 100}. */
export async function ordersTenant(app: FastifyInstance, tenantId: string, marketId: string, admin: TestUser, approver: TestUser): Promise<OrdersTenant> {
  const distributorType = await activeType(tenantId, 'DIST', DISTRIBUTOR, admin.id, approver.id)
  const retailType = await activeType(tenantId, 'RETAIL', RETAIL, admin.id, approver.id)
  await setSettings(tenantId, admin.id, ORDER_SETTINGS)
  await volumes(app, admin, marketId, 'SKU-A', { qv: '150', bv: '7' })
  await volumes(app, admin, marketId, 'SKU-B', { qv: '100' })
  return { tenantId, marketId, admin, distributorType, retailType, token: await apiKey(app, admin, ['orders:write']) }
}
