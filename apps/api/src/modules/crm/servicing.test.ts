import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { parModule } from '../par/index.js'
import { crmModule } from './index.js'

// FR-CRM-001 (T-B2-32, AC-CRM1-1/2) and FR-CRM-002 (TS-49, E-ORD-13, AC-CRM2-1, T-B2-34) through API-35 and C1/C3.
let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let support: TestUser
let supportMy: TestUser
let analyst: TestUser
let globexSupport: TestUser
let tree: Record<string, string>
let gb: string

closePoolsAfterAll()

async function enrol(as: TestUser, body: Record<string, unknown>) {
  const response = await call(app, {
    method: 'POST', url: '/v1/participants', as, idempotencyKey: true,
    body: { external_ref: `EXT-${Math.random().toString(36).slice(2, 12)}`, market: 'GB', account_type: 'individual', ...body },
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data as { participant: { id: string }; position: { id: string } | null }
}

async function approvedType(code: string, flags: Record<string, boolean>, compliance: TestUser) {
  const proposed = await call(app, { method: 'POST', url: '/v1/participant-types', as: admin, idempotencyKey: true, body: { code, name: code, reason: 'fixture', ...flags } })
  await call(app, { method: 'POST', url: `/v1/participant-types/${proposed.json().data.id}/decision`, as: compliance, idempotencyKey: true, body: { decision: 'approve', reason: 'ok' } })
}

/** FIXTURE: customers.reassignment_rule in force from now (settings API needs settings.manage; covered by TEN tests). */
async function reassignmentRule(rule: string, noticeDays = 0) {
  await ownerRows(
    `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, clock_timestamp(), jsonb_build_object('customers.reassignment_rule', $2::jsonb), 'FIXTURE', $3
     FROM tenant_setting_version WHERE tenant_id = $1`,
    [acme.id, JSON.stringify({ rule, notice_days: noticeDays }), admin.id],
  )
}

const terminate = (positionId: string) => withTenant({ tenantId: acme.id, userId: admin.id }, async (tx) => {
  const { rows } = await tx.query<{ moved: number }>(`SELECT gen_set_position_status($1, 'terminated', now(), 'test', NULL) AS moved`, [positionId])
  return rows[0]!.moved
})

const servicer = async (customer: string) =>
  (await ownerRows<{ position: string | null; source: string }>(
    'SELECT servicing_position_id AS position, source FROM customer_servicing WHERE customer_id = $1 AND valid_to IS NULL', [customer],
  ))[0]
const put = (as: TestUser, customer: string, body: unknown) => call(app, { method: 'PUT', url: `/v1/customers/${customer}/servicing`, as, body, idempotencyKey: true })
const refOf = async (position: string) => (await ownerRows<{ ref: string }>('SELECT position_ref AS ref FROM position WHERE id = $1', [position]))[0]!.ref

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  const my = await createMarket(acme.id, 'MY')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  supportMy = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [my] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexSupport = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })
  app = await buildTestApp({ modules: [iamModule, parModule, crmModule] })
  await approvedType('DIST', { can_earn: true, counts_as_end_customer: false, can_sponsor: true, can_hold_positions: true }, compliance)
  await approvedType('CUST', { can_earn: false, counts_as_end_customer: true, can_sponsor: false, can_hold_positions: false }, compliance)
  const top = (await enrol(support, { type_code: 'DIST', position_ref: 'TOP' })).position!.id
  const p1 = (await enrol(support, { type_code: 'DIST', position_ref: 'P1', sponsor: { position_ref: 'TOP' } })).position!.id
  const p2 = (await enrol(support, { type_code: 'DIST', position_ref: 'P2', sponsor: { position_ref: 'TOP' } })).position!.id
  const customer = (await enrol(support, { type_code: 'CUST', sponsor: { position_ref: 'P1' } })).participant.id
  tree = { top, p1, p2, customer }
})

afterAll(async () => {
  await app.close()
})

describe('PUT /v1/customers/:id/servicing (T-B2-32, AC-CRM1-1, AC-CRM1-2)', () => {
  test('closes the current servicer and opens the new one; the history and both customer lists follow', async () => {
    const changed = await put(support, tree.customer!, { position_ref: 'P2', reason: 'customer asked' })
    const history = await call(app, { method: 'GET', url: `/v1/participants/${tree.customer}/servicing`, as: analyst })
    const p1List = await call(app, { method: 'GET', url: `/v1/positions/${tree.p1}/customers`, as: analyst })
    const p2List = await call(app, { method: 'GET', url: `/v1/positions/${tree.p2}/customers`, as: analyst })

    expect(changed.statusCode).toBe(200)
    expect(changed.json().data.servicing).toMatchObject({ position_id: tree.p2, source: 'manual' })
    expect(history.json().data).toEqual([
      expect.objectContaining({ position: expect.objectContaining({ id: tree.p2, position_ref: 'P2' }), source: 'manual', valid_to: null }),
      expect.objectContaining({ position: expect.objectContaining({ id: tree.p1 }), source: 'enrolment', valid_to: expect.any(String) }),
    ])
    expect(p1List.json().data).toEqual([])
    expect(p2List.json().data).toEqual([expect.objectContaining({ participant: expect.objectContaining({ id: tree.customer }), source: 'manual' })])
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'SERVICING.CHANGED' AND object_id = $1`, [tree.customer])).toHaveLength(2)
  })

  test('refusals: unchanged, not a customer, unknown or terminated servicer, past date', async () => {
    const extra = (await enrol(support, { type_code: 'DIST', position_ref: 'GONE' })).position!.id
    await terminate(extra)
    const results = [
      await put(support, tree.customer!, { position_ref: 'P2', reason: 'x' }),
      await put(support, (await ownerRows<{ id: string }>(`SELECT participant_id AS id FROM position_ownership WHERE position_id = $1`, [tree.p1]))[0]!.id, { position_ref: null, reason: 'x' }),
      await put(support, tree.customer!, { position_ref: 'NOPE', reason: 'x' }),
      await put(support, tree.customer!, { position_ref: 'GONE', reason: 'x' }),
      await put(support, tree.customer!, { position_ref: null, valid_from: '2020-01-01T00:00:00Z', reason: 'x' }),
    ]

    expect(results.map((r) => r.json().error.code)).toEqual(['SERVICER_UNCHANGED', 'NOT_A_CUSTOMER', 'SERVICER_NOT_ELIGIBLE', 'SERVICER_NOT_ELIGIBLE', 'VALID_FROM_INVALID'])
  })

  test('OI-4: a pending future servicer row makes an earlier change 422 VALID_FROM_INVALID (C1 23514), never a 500', async () => {
    const later = (await enrol(support, { type_code: 'DIST', position_ref: 'OI4-LATER' })).position!.id
    await enrol(support, { type_code: 'DIST', position_ref: 'OI4-SOONER' })
    const customer = (await enrol(support, { type_code: 'CUST', sponsor: { position_ref: 'OI4-LATER' } })).participant.id
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
    const pending = await put(support, customer, { position_ref: null, valid_from: inDays(2), reason: 'company from next week' })
    const earlier = await put(support, customer, { position_ref: 'OI4-SOONER', valid_from: inDays(1), reason: 'sooner' })

    expect(pending.statusCode).toBe(200)
    expect([earlier.statusCode, earlier.json().error.code]).toEqual([422, 'VALID_FROM_INVALID'])
    expect(await servicer(customer)).toEqual({ position: null, source: 'manual' })
    expect(later).toBeDefined()
  })

  test('the company services when position_ref is null; a key with participants:write may change it', async () => {
    // The minter holds what the key does (servicing.manage, participant.manage) for all markets (PLAN B2 2.8).
    const integrator = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Support agent'], stepUp: true })
    const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as: integrator, body: { name: 'crm', purpose: 'CRM' }, idempotencyKey: true })
    const key = await call(app, {
      method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as: integrator,
      body: { name: 'crm', scopes: ['participants:write'], rate_tier: 'standard' }, idempotencyKey: true,
    })
    const byKey = await app.inject({
      method: 'PUT', url: `/v1/customers/${tree.customer}/servicing`, payload: { position_ref: null, reason: 'store sync' },
      headers: { authorization: `Bearer ${key.json().data.token}`, 'idempotency-key': 'servicing-key-1' },
    })

    expect(byKey.statusCode).toBe(200)
    expect(await servicer(tree.customer!)).toEqual({ position: null, source: 'manual' })
    expect((await put(support, tree.customer!, { position_ref: 'P2', reason: 'back' })).statusCode).toBe(200)
  })

  test('permission, market scope, tenant isolation and validation', async () => {
    expect((await put(analyst, tree.customer!, { position_ref: 'P1', reason: 'x' })).statusCode).toBe(403)
    expect((await put(supportMy, tree.customer!, { position_ref: 'P1', reason: 'x' })).statusCode).toBe(404)
    expect((await put(globexSupport, tree.customer!, { position_ref: 'P1', reason: 'x' })).statusCode).toBe(404)
    expect((await put(support, tree.customer!, { position_ref: 'P1' })).statusCode).toBe(400)
    expect((await call(app, { method: 'GET', url: `/v1/participants/${tree.customer}/servicing`, as: globexSupport })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/positions/${tree.p2}/customers`, as: supportMy })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/positions/${tree.p2}/customers?cursor=bad`, as: support })).statusCode).toBe(400)
  })
})

describe('market scope of the servicing reads (D-B2-21)', () => {
  test('a GB reader sees neither customers nor servicing owners in another market', async () => {
    const analystGb = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [gb] })
    const gbPosition = (await enrol(support, { type_code: 'DIST', position_ref: 'GBS' })).position!.id
    const myPosition = (await enrol(support, { type_code: 'DIST', market: 'MY', position_ref: 'MYP', display_name: 'Secret MY Owner' })).position!.id
    const myCustomer = (await enrol(support, { type_code: 'CUST', market: 'MY', display_name: 'Secret MY Person', sponsor: { position_ref: 'GBS' } })).participant.id
    const gbCustomer = (await enrol(support, { type_code: 'CUST', sponsor: { position_ref: 'MYP' } })).participant.id
    const list = (as: TestUser) => call(app, { method: 'GET', url: `/v1/positions/${gbPosition}/customers`, as })
    const history = (as: TestUser) => call(app, { method: 'GET', url: `/v1/participants/${gbCustomer}/servicing`, as })

    const ids = (response: Awaited<ReturnType<typeof list>>) => response.json().data.map((row: { participant: { id: string } }) => row.participant.id)
    expect(ids(await list(analyst))).toContain(myCustomer)
    expect(ids(await list(analystGb))).not.toContain(myCustomer)
    expect((await list(analystGb)).body).not.toContain('Secret MY Person')
    expect((await history(analyst)).json().data[0].position).toMatchObject({ id: myPosition, owner_name: 'Secret MY Owner' })
    expect((await history(analystGb)).json().data[0].position).toMatchObject({ id: myPosition, owner_name: null })
  })
})

describe('reassignment on termination (TS-49, E-ORD-13, AC-CRM2-1, T-B2-34)', () => {
  test('rule unset: a position with customers cannot terminate (CR003), one without customers can', async () => {
    const lonely = (await enrol(support, { type_code: 'DIST', sponsor: { position_ref: 'TOP' } })).position!.id
    const refused = await terminate(tree.p2!).then(() => null, (error: unknown) => error)

    expect(refused).toMatchObject({ code: 'CR003' })
    expect(await servicer(tree.customer!)).toEqual({ position: tree.p2, source: 'manual' })
    expect(await terminate(lonely)).toBe(0)
  })

  test('rule sponsor: the customers move to the sponsor; with the sponsor terminated they go to the company', async () => {
    await reassignmentRule('sponsor')
    const p3 = (await enrol(support, { type_code: 'DIST', position_ref: 'P3', sponsor: { position_ref: 'P2' } })).position!.id
    const orphan = (await enrol(support, { type_code: 'CUST', sponsor: { position_ref: 'P3' } })).participant.id

    expect(await terminate(tree.p2!)).toBe(1)
    expect(await servicer(tree.customer!)).toEqual({ position: tree.top, source: 'reassignment' })
    const lists = await Promise.all([tree.p2!, tree.top!].map((id) => call(app, { method: 'GET', url: `/v1/positions/${id}/customers`, as: analyst })))
    expect(lists[0]!.json().data).toEqual([])
    expect(lists[1]!.json().data.map((row: { participant: { id: string } }) => row.participant.id)).toContain(tree.customer)
    expect(await terminate(p3)).toBe(1)
    expect(await servicer(orphan)).toEqual({ position: null, source: 'reassignment' })
    expect(await refOf(p3)).toBe('P3')
  })

  test('rule company: customers go to the company', async () => {
    await reassignmentRule('company')
    const p4 = (await enrol(support, { type_code: 'DIST', sponsor: { position_ref: 'TOP' } })).position!.id
    const customer = (await enrol(support, { type_code: 'CUST', sponsor: { position_ref: await refOf(p4) } })).participant.id

    expect(await terminate(p4)).toBe(1)
    expect(await servicer(customer)).toEqual({ position: null, source: 'reassignment' })
  })
})
