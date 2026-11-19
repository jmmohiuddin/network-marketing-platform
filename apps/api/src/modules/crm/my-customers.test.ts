import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { parModule } from '../par/index.js'
import { crmModule } from './index.js'

// D-B5-11 My customers (FR-DIST-005): AC-52.1 / TS-49 views, AC-DIST5-1, T-B5-21.

const SYSTEM = '00000000-0000-0000-0000-000000000000'
let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let support: TestUser
let dpo: TestUser
let deC: TestUser
let deB: TestUser
let outsider: TestUser
let foreignCustomer: string
let gb: string
const ids: Record<string, string> = {}

closePoolsAfterAll()

async function enrol(body: Record<string, unknown>) {
  const response = await call(app, {
    method: 'POST', url: '/v1/participants', as: support, idempotencyKey: true,
    body: { external_ref: `EXT-${randomUUID().slice(0, 10)}`, market: 'GB', account_type: 'individual', ...body },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data as { participant: { id: string }; position: { id: string } | null }
}

async function approvedType(code: string, flags: Record<string, boolean>, compliance: TestUser) {
  const proposed = await call(app, { method: 'POST', url: '/v1/participant-types', as: admin, idempotencyKey: true, body: { code, name: code, reason: 'fixture', ...flags } })
  await call(app, { method: 'POST', url: `/v1/participant-types/${proposed.json().data.id}/decision`, as: compliance, idempotencyKey: true, body: { decision: 'approve', reason: 'ok' } })
}

/** FIXTURE: an order of the customer attributed to the position (owner insert, as ORD would store it). */
async function order(customer: string, positionId: string, at: string): Promise<void> {
  const key = randomUUID()
  const [inbound] = await ownerRows<{ id: string }>(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
     VALUES ($1, 'api:fixture', $2, sha256(convert_to($2, 'UTF8')), now(), 'processed', $3, 'system') RETURNING id`, [acme.id, `order:${key}`, SYSTEM])
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
       attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency,
       payload_hash, inbound_event_id, created_by, created_by_type)
     SELECT $1, 'fixture', $2, $3, $4, t.id, 'customer', false, $5, 'servicing', false, $6, $6, 1000, 0, 'GBP', sha256(convert_to($2, 'UTF8')), $7, $8, 'system'
     FROM participant_type t WHERE t.tenant_id = $1 AND t.code = 'CUST' RETURNING id`,
    [acme.id, key, gb, customer, positionId, at, inbound!.id, SYSTEM])
  await ownerRows(
    `INSERT INTO order_line (tenant_id, order_id, line_no, sku, item_class, quantity, amount_minor, volumes, created_by, created_by_type)
     VALUES ($1, $2, 1, 'FX-1', 'product', 1, 1000, '{"pv": "1000"}', $3, 'system')`, [acme.id, row!.id, SYSTEM])
}

/** FIXTURE: portal.customer_contact_visible in force from now, with the approved change request the key needs. */
async function contactVisible(value: boolean): Promise<void> {
  await ownerRows(
    `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                SELECT $1, 'setting_change_request', $3, $4, $5, 'approved', now(), $5 RETURNING id),
          v AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
                SELECT $1, (SELECT coalesce(max(version), 0) + 1 FROM tenant_setting_version WHERE tenant_id = $1), $6,
                       coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}')
                         || jsonb_build_object('portal.customer_contact_visible', $2::boolean), 'FIXTURE', $4, (SELECT id FROM a) RETURNING id)
     INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, decided_by, decided_at,
       approval_id, version_id)
     SELECT $3, $1, 'portal.customer_contact_visible', to_jsonb($2::boolean), $6, 'FIXTURE', 0, 'approved', $4, $5, now(), a.id, v.id FROM a, v`,
    [acme.id, value, randomUUID(), admin.id, dpo.id, new Date()])
}

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  dpo = await createSignedInUser({ tenantId: acme.id, roles: ['DPO'] })
  app = await buildTestApp({ modules: [iamModule, parModule, crmModule] })
  await approvedType('DIST', { can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true }, compliance)
  await approvedType('CUST', { can_earn: false, counts_as_end_customer: true, can_sponsor: false, can_hold_positions: false }, compliance)
  const c = await enrol({ type_code: 'DIST', position_ref: 'DE-C' })
  const b = await enrol({ type_code: 'DIST', position_ref: 'DE-B' })
  ids.pc = c.position!.id
  ids.pb = b.position!.id
  ids.k = (await enrol({ type_code: 'CUST', sponsor: { position_ref: 'DE-C' }, display_name: 'Kim Customer' })).participant.id
  ids.m = (await enrol({ type_code: 'CUST', sponsor: { position_ref: 'DE-C' }, display_name: 'Mo Customer' })).participant.id
  await ownerRows(`UPDATE participant SET contact = '{"email": "kim@example.com"}' WHERE id = $1`, [ids.k])
  await order(ids.k, ids.pc, '2026-10-01T10:00:00Z')
  await order(ids.k, ids.pc, '2026-10-20T10:00:00Z')
  const moved = await call(app, { method: 'PUT', url: `/v1/customers/${ids.k}/servicing`, as: support, idempotencyKey: true,
    body: { position_ref: 'DE-B', reason: 'customer asked' } })
  expect(moved.statusCode, moved.body).toBe(200)
  deC = await createPortalUser({ tenantId: acme.id, participantId: c.participant.id })
  deB = await createPortalUser({ tenantId: acme.id, participantId: b.participant.id })
  const globex = await createTenant()
  foreignCustomer = (await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
     VALUES ($1, 'G-1', 'individual', $2, '2025-01-01', $3, 'system') RETURNING id`, [globex.id, await createMarket(globex.id, 'GB'), SYSTEM]))[0]!.id
  outsider = await createPortalUser({ tenantId: globex.id, participantId: foreignCustomer })
})

afterAll(async () => {
  await app.close()
})

const list = (as: TestUser, query = '') => call(app, { method: 'GET', url: `/v1/me/customers${query}`, as })
const names = (response: { json(): { data: { display_name: string }[] } }) => response.json().data.map((row) => row.display_name)

describe('GET /v1/me/customers', () => {
  test('AC-52.1 / TS-49: after a reassignment the new servicer sees the customer current, the old one past with the end date', async () => {
    const bCurrent = (await list(deB)).json().data
    expect(bCurrent).toEqual([expect.objectContaining({ customer_id: ids.k, serviced_by_position_ref: 'DE-B', until: null, order_count: 0, repeat: false })])
    expect(names(await list(deC))).toEqual(['Mo Customer'])
    const cPast = (await list(deC, '?state=past')).json().data
    expect(cPast).toEqual([expect.objectContaining({ customer_id: ids.k, serviced_by_position_ref: 'DE-C', until: expect.any(String) })])
    expect(cPast[0].until).toBe(bCurrent[0].since)
    expect(names(await list(deB, '?state=all'))).toEqual(['Kim Customer'])
  })

  test('AC-DIST5-1: last order, repeat (>= 2 orders), sort by last order with never-ordered last, cursor pages', async () => {
    const all = (await list(deC, '?state=all&sort=last_order')).json().data
    expect(all.map((row: { display_name: string }) => row.display_name)).toEqual(['Kim Customer', 'Mo Customer'])
    expect(all[0]).toMatchObject({ order_count: 2, repeat: true, last_order_at: '2026-10-20T10:00:00.000Z' })
    expect(all[1]).toMatchObject({ order_count: 0, repeat: false, last_order_at: null })
    expect(names(await list(deC, '?state=all&repeat=true'))).toEqual(['Kim Customer'])
    const page1 = await list(deC, '?state=all&sort=last_order&limit=1')
    expect(names(page1)).toEqual(['Kim Customer'])
    expect(names(await list(deC, `?state=all&sort=last_order&limit=1&cursor=${page1.json().meta.next_cursor}`))).toEqual(['Mo Customer'])
    const byName = await list(deC, '?state=all&limit=1')
    expect(names(await list(deC, `?state=all&limit=1&cursor=${byName.json().meta.next_cursor}`))).toEqual(['Mo Customer'])
  })

  test('contact only while portal.customer_contact_visible is true, masked', async () => {
    expect((await list(deB)).json().data[0]).not.toHaveProperty('contact_masked')
    await contactVisible(true)
    expect((await list(deB)).json().data[0].contact_masked).toEqual({ email: 'k•••@e•••.com' })
    await contactVisible(false)
    expect((await list(deB)).json().data[0]).not.toHaveProperty('contact_masked')
  })

  test('detail: own servicing periods and the orders of own positions only; others are 404', async () => {
    const detail = await call(app, { method: 'GET', url: `/v1/me/customers/${ids.k}`, as: deC })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().data).toMatchObject({
      customer_id: ids.k, display_name: 'Kim Customer',
      servicing: [expect.objectContaining({ position_ref: 'DE-C', until: expect.any(String), order_count: 2 })],
      last_orders: [expect.objectContaining({ ordered_at: '2026-10-20T10:00:00.000Z' }), expect.objectContaining({ ordered_at: '2026-10-01T10:00:00.000Z' })],
    })
    expect((await call(app, { method: 'GET', url: `/v1/me/customers/${ids.k}`, as: deB })).json().data.last_orders).toEqual([])
    for (const [as, id] of [[deB, ids.m], [deC, foreignCustomer], [deC, randomUUID()]] as const) {
      expect((await call(app, { method: 'GET', url: `/v1/me/customers/${id}`, as })).statusCode).toBe(404)
    }
  })

  test('a participant without a live position is 403 PARTICIPANT_TERMINATED; staff sessions are refused', async () => {
    expect((await list(outsider)).json().error.code).toBe('PARTICIPANT_TERMINATED')
    expect((await list(admin)).json().error.code).toBe('REALM_FORBIDDEN')
  })
})
