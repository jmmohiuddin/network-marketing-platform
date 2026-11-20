import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  activePlanVersion, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ordModule } from './index.js'
import {
  apiKey, asKey, committedPeriod, orderBody, ordersTenant, participantWithPosition, setSettings, volumes, type OrdersTenant,
} from './test-support.js'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let shop: OrdersTenant
let analyst: TestUser
let gbPeriod: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  app = await buildTestApp({ modules: [iamModule, ordModule] })
  shop = await ordersTenant(app, acme.id, gb, admin, approver)
  gbPeriod = await committedPeriod(acme.id, gb, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')
})

afterAll(async () => {
  await app.close()
})

const postOrder = (body: Record<string, unknown>, token = shop.token, key?: string) => asKey(app, token, '/v1/orders', body, key)
const inbound = (key: string) => ownerRows<{ state: string; result: unknown; attempts: number; payload: unknown }>(
  'SELECT state, result, attempts, payload FROM inbound_event WHERE idempotency_key = $1 ORDER BY received_at', [key],
)

describe('POST /v1/orders (API-10)', () => {
  test('TS-15 / AC-22.1: the same order twice is one order; the second answer is 200 with the same order', async () => {
    const body = orderBody()
    const first = await postOrder(body)
    const second = await postOrder(body)
    const order = first.json().data.order

    expect(first.statusCode).toBe(201)
    expect(first.json().data).toMatchObject({ late: false, late_transactions: [] })
    expect(order).toMatchObject({
      source_system: 'shop', purpose: 'customer', buyer_type: { code: 'RETAIL' }, amount_minor: '3000', tax_minor: '500',
      volumes: { bv: '14', qv: '400' }, attributed_position: null, attribution_conflict: false,
    })
    expect(order.lines).toEqual([
      expect.objectContaining({ line_no: 1, sku: 'SKU-A', quantity: 2, amount_minor: '2000', volumes: { qv: '300', bv: '14' } }),
      expect.objectContaining({ line_no: 2, sku: 'SKU-B', quantity: 1, amount_minor: '1000', volumes: { qv: '100' } }),
    ])
    expect(second.statusCode).toBe(200)
    expect(second.json().data).toMatchObject({ replayed: true, order: { id: order.id } })
    expect(await ownerRows('SELECT id FROM sales_order WHERE source_order_id = $1', [body.source_order_id])).toHaveLength(1)
    const [audit] = await ownerRows<{ actor_type: string }>(`SELECT actor_type FROM audit.audit_event WHERE action = 'ORDER.INGESTED' AND object_id = $1`, [order.id])
    expect(audit).toEqual({ actor_type: 'service_account' })
    const [outbox] = await ownerRows<{ payload: unknown }>(`SELECT payload FROM outbox_event WHERE topic = 'order.ingested' AND key = $1`, [order.id])
    expect(outbox!.payload).toEqual({ order_id: order.id, market_id: shop.marketId, source_system: 'shop' })
  })

  test('the same Idempotency-Key replays the stored answer; another body under it is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID()
    const body = orderBody()
    const first = await postOrder(body, shop.token, key)
    const replay = await postOrder(body, shop.token, key)
    const reused = await postOrder(orderBody(), shop.token, key)

    expect(replay.statusCode).toBe(201)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json().data.order.id).toBe(first.json().data.order.id)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  test('AC-22.3: a key without orders:write is 403 and nothing is stored; sessions are refused; no credentials is 401', async () => {
    const readKey = await apiKey(app, shop.admin, ['compliance:read'])
    const body = orderBody()

    const refused = await postOrder(body, readKey)
    const session = await call(app, { method: 'POST', url: '/v1/orders', as: shop.admin, body, idempotencyKey: true })
    const anonymous = await call(app, { method: 'POST', url: '/v1/orders', body, idempotencyKey: true })

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('SCOPE_MISSING')
    expect(session.json().error.code).toBe('API_KEY_REQUIRED')
    expect(anonymous.statusCode).toBe(401)
    expect(await inbound(`order:shop:${String(body.source_order_id)}`)).toEqual([])
  })

  test('a bearer key needs no X-Requested-With; a session POST without it is still refused (CSRF)', async () => {
    const withoutHeader = await app.inject({ method: 'POST', url: '/v1/orders', headers: { cookie: shop.admin.cookie, 'idempotency-key': randomUUID() }, payload: orderBody() })

    expect(withoutHeader.json().error.code).toBe('CSRF_HEADER_MISSING')
    expect((await postOrder(orderBody())).statusCode).toBe(201)
  })

  test('C-B2-21: an API order may not use a store connector source system; a later fulfilment time is no conflict', async () => {
    const body = orderBody()
    const namespaced = await postOrder(orderBody({ source_system: 'woocommerce:00000000-0000-4000-8000-000000000000' }))
    const original = await postOrder(body)
    const fulfilled = await postOrder({ ...body, fulfilled_at: new Date().toISOString() }, shop.token, randomUUID())

    expect(namespaced.json().error.code).toBe('VALIDATION_FAILED')
    expect(original.statusCode).toBe(201)
    expect(fulfilled.statusCode).toBe(200)
    expect(fulfilled.json().data.replayed).toBe(true)
  })

  test('a buyer the order creates is audited PARTICIPANT.ENROLLED once; ORDER.INGESTED names the buyer', async () => {
    const buyer = { external_ref: `buyer-${randomUUID()}` }
    const first = (await postOrder(orderBody({ buyer }))).json().data.order
    await postOrder(orderBody({ buyer }))

    const audited = await ownerRows<{ action: string; after_ref: string }>(`SELECT action, after_ref FROM audit.audit_event WHERE object_id = $1`, [first.buyer.id])
    expect(audited.map((row) => [row.action, JSON.parse(row.after_ref).after])).toEqual([['PARTICIPANT.ENROLLED',
      { participant_id: first.buyer.id, type_id: shop.retailType, market_id: shop.marketId, enrolled_at: first.credited_at, source: 'order' },
    ]])
    const [ingested] = await ownerRows<{ after_ref: string }>(`SELECT after_ref FROM audit.audit_event WHERE action = 'ORDER.INGESTED' AND object_id = $1`, [first.id])
    expect(JSON.parse(ingested!.after_ref).after.buyer_id).toBe(first.buyer.id)
  })

  test('a redelivery under a new key replays; a changed crediting time is a conflict', async () => {
    const body = orderBody()
    const original = await postOrder(body)
    const afterSwitch = await postOrder(body, shop.token, randomUUID())
    const moved = await postOrder({ ...body, paid_at: new Date(Date.now() - 120_000).toISOString() }, shop.token, randomUUID())

    expect(original.statusCode).toBe(201)
    expect(afterSwitch.statusCode).toBe(200)
    expect(afterSwitch.json().data.replayed).toBe(true)
    expect(moved.json().error.code).toBe('ORDER_CONFLICT')
  })

  test('AC-ORD1-1: the same natural key with another body is 409 ORDER_CONFLICT, persisted as a rejected inbound event', async () => {
    const body = orderBody()
    const original = await postOrder(body)
    const key = randomUUID()
    const conflict = await postOrder({ ...body, tax_minor: '600' }, shop.token, key)
    const repeated = await postOrder({ ...body, tax_minor: '600' }, shop.token, key)

    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error).toMatchObject({ code: 'ORDER_CONFLICT' })
    expect(repeated.statusCode).toBe(409)
    expect((await inbound(`order:shop:${String(body.source_order_id)}`)).map((row) => row.state)).toEqual(['processed', 'rejected'])
    const rejectedId = (await ownerRows<{ id: string }>(`SELECT id FROM inbound_event WHERE idempotency_key = $1 AND state = 'rejected'`, [`order:shop:${String(body.source_order_id)}`]))[0]!.id
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'ORDER.CONFLICT' AND object_id = $1`, [rejectedId])).toHaveLength(1)
    expect(await ownerRows('SELECT tax_minor FROM sales_order WHERE id = $1', [original.json().data.order.id])).toEqual([{ tax_minor: '500' }])
  })

  test('T-B2-25: concurrent posts of one order (different keys) create one order', async () => {
    const body = orderBody()
    const answers = await Promise.all(Array.from({ length: 5 }, () => postOrder(body)))

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 200, 200, 200, 201])
    expect(await ownerRows('SELECT id FROM sales_order WHERE source_order_id = $1', [body.source_order_id])).toHaveLength(1)
  })
})

describe('T-B2-23 validation matrix: refusals are persisted, body-shape failures are not', () => {
  const expectRefused = async (body: Record<string, unknown>, status: number, code: string, token = shop.token) => {
    const response = await postOrder(body, token)
    expect(response.statusCode, response.body).toBe(status)
    expect(response.json().error.code).toBe(code)
    const rows = await ownerRows<{ result: unknown }>(`SELECT result FROM inbound_event WHERE idempotency_key = $1 AND state = 'rejected'`, [
      `order:${String(body.source_system)}:${String(body.source_order_id)}`,
    ])
    expect(rows).toEqual([{ result: { error: { code } } }])
  }

  test('fact checks of API-10', async () => {
    await createMarket(acme.id, 'DE')
    await ownerRows(`UPDATE market SET state = 'draft' WHERE tenant_id = $1 AND code = 'DE'`, [acme.id])
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const lines = [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: '1000' }, { line_no: 1, sku: 'SKU-B', quantity: 1, amount_minor: '2000' }]

    await expectRefused(orderBody({ market: 'XX' }), 422, 'MARKET_NOT_LIVE')
    await expectRefused(orderBody({ market: 'DE' }), 422, 'MARKET_NOT_LIVE') // TS-50 (order part)
    await expectRefused(orderBody({ currency: 'EUR' }), 422, 'CURRENCY_MISMATCH')
    await expectRefused(orderBody({ amount_minor: '2999' }), 422, 'TOTALS_MISMATCH')
    await expectRefused(orderBody({ lines }), 422, 'LINE_NUMBERS_INVALID')
    await expectRefused(orderBody({ ordered_at: future, paid_at: future }), 422, 'TIMESTAMP_IN_FUTURE')
    await expectRefused(orderBody({ paid_at: undefined }), 422, 'CREDITING_EVENT_MISSING')
    await expectRefused(orderBody({ purpose: 'resale' }), 422, 'PURPOSE_INVALID')
  })

  test('BUYER_TYPE_MISSING: a buyer enrolled after the crediting time', async () => {
    const late = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType, new Date().toISOString())
    const [buyer] = await ownerRows<{ external_ref: string }>('SELECT external_ref FROM participant WHERE id = $1', [late.participantId])
    const at = new Date(Date.now() - 86_400_000).toISOString()

    await expectRefused(orderBody({ buyer: { external_ref: buyer!.external_ref }, ordered_at: at, paid_at: at }), 422, 'BUYER_TYPE_MISSING')
  })

  test('settings are required, none has a default (DEC-14); another tenant\'s orders stay apart', async () => {
    const globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
    const globexGb = await createMarket(globex.id, 'GB')
    const token = await apiKey(app, globexAdmin, ['orders:write'])

    await expectRefused(orderBody(), 422, 'CREDITING_EVENT_NOT_CONFIGURED', token)
    const globexApprover = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'] })
    await activePlanVersion(globex.id, globexGb, { submitterId: globexAdmin.id, approverId: globexApprover.id, creditingEvent: 'paid' })
    await expectRefused(orderBody(), 422, 'ATTRIBUTION_NOT_CONFIGURED', token)
    await setSettings(globex.id, globexAdmin.id, { 'orders.attribution_precedence': ['servicing'] })
    await expectRefused(orderBody(), 422, 'BUYER_NOT_FOUND', token)
    await setSettings(globex.id, globexAdmin.id, { 'orders.new_buyer_type': 'NOPE' })
    await expectRefused(orderBody(), 422, 'BUYER_TYPE_INVALID', token)
    const acmeOrder = (await postOrder(orderBody())).json().data.order
    const event = await asKey(app, token, '/v1/order-events', {
      source_system: 'shop', source_event_id: randomUUID(), source_order_id: acmeOrder.source_order_id, type: 'refund',
      occurred_at: new Date().toISOString(), refund_minor: '100', fee_minor: '0',
    })
    expect(event.statusCode).toBe(202) // acme's order does not exist in globex
    expect(event.json().data.held.reason).toBe('ORDER_NOT_FOUND')
  })

  test('a body-shape failure is 400 VALIDATION_FAILED and leaves no inbound event', async () => {
    const body = orderBody({ amount_minor: 3000 })
    const response = await postOrder(body)

    expect(response.json().error.code).toBe('VALIDATION_FAILED')
    expect(await inbound(`order:shop:${String(body.source_order_id)}`)).toEqual([])
  })
})

describe('T-B2-24 held orders, retry and re-post', () => {
  test('unknown SKU -> 202 held; its first volumes row back-dated, then retry -> processed and late in the committed period (TS-13)', async () => {
    const at = '2025-01-15T10:00:00Z'
    const body = orderBody({ ordered_at: at, paid_at: at, lines: [{ line_no: 1, sku: 'SKU-NEW', quantity: 2, amount_minor: '3000' }] })
    const held = await postOrder(body)
    const again = await postOrder(body)
    const id = held.json().data.held.inbound_event_id

    expect(held.statusCode).toBe(202)
    expect(held.json().data.held).toEqual({ inbound_event_id: id, reason: 'UNKNOWN_SKU', skus: ['SKU-NEW'] })
    expect(again.statusCode).toBe(202)
    expect((await inbound(`order:shop:${String(body.source_order_id)}`))[0]).toMatchObject({ state: 'held', attempts: 2 })
    expect((await call(app, { method: 'POST', url: `/v1/inbound-events/${id}/retry`, as: analyst, body: {} })).statusCode).toBe(403)

    await volumes(app, shop.admin, shop.marketId, 'SKU-NEW', { qv: '10' }, '2024-06-01T00:00:00Z')
    const [first, second] = await Promise.all([
      call(app, { method: 'POST', url: `/v1/inbound-events/${id}/retry`, as: shop.admin, body: {} }),
      call(app, { method: 'POST', url: `/v1/inbound-events/${id}/retry`, as: shop.admin, body: {} }),
    ])

    const answers = [first!, second!].sort((a, b) => a.statusCode - b.statusCode)
    expect(answers.map((answer) => answer.statusCode)).toEqual([200, 409])
    expect(answers[1]!.json().error.code).toBe('NOT_HELD')
    const orderId = answers[0]!.json().data.result.order_id
    expect(answers[0]!.json().data.state).toBe('processed')
    expect((await inbound(`order:shop:${String(body.source_order_id)}`))[0]).toMatchObject({ state: 'processed', payload: null, attempts: 3 })
    const late = await ownerRows('SELECT original_period_id, handling, state, effect_estimate FROM late_transaction WHERE order_id = $1', [orderId])
    expect(late).toEqual([{
      original_period_id: gbPeriod, handling: 'adjust', state: 'pending',
      effect_estimate: { volumes: { qv: '20' }, amount_minor: '3000', attributed_position_id: null },
    }])
    expect(await ownerRows('SELECT period_id FROM sales_order WHERE id = $1', [orderId])).toEqual([{ period_id: gbPeriod }])
    expect(await ownerRows('SELECT state FROM period WHERE id = $1', [gbPeriod])).toEqual([{ state: 'committed' }])
  })

  test('a re-post of a held order with a new key processes it once the SKU is mapped; another tenant cannot retry', async () => {
    const body = orderBody({ lines: [{ line_no: 1, sku: 'SKU-LATER', quantity: 1, amount_minor: '3000' }] })
    const held = await postOrder(body)
    const globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })

    const foreign = await call(app, { method: 'POST', url: `/v1/inbound-events/${held.json().data.held.inbound_event_id}/retry`, as: globexAdmin, body: {} })
    await volumes(app, shop.admin, shop.marketId, 'SKU-LATER', { qv: '5' })
    const processed = await postOrder(body)

    expect(foreign.statusCode).toBe(404)
    expect(processed.statusCode).toBe(201)
    expect(processed.json().data.order.volumes).toEqual({ qv: '5' })
  })
})

describe('T-B2-33 attribution precedence and FR-ORD-003 purpose', () => {
  let p1: { positionRef: string; positionId: string }
  let p2: { positionRef: string; positionId: string }

  beforeAll(async () => {
    p1 = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    p2 = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
  })

  const attributed = async (body: Record<string, unknown>) => {
    const response = await postOrder(body)
    expect(response.statusCode, response.body).toBe(201)
    const order = response.json().data.order
    return { position: order.attributed_position?.position_ref ?? null, source: order.attribution_source, conflict: order.attribution_conflict, order }
  }

  test('first attributed order makes the servicer (first_order); later hints that differ flag a conflict (AC-CRM1-3)', async () => {
    const buyer = { external_ref: `customer-${randomUUID()}` }

    const first = await attributed(orderBody({ buyer, attribution: { kind: 'link', position_ref: p1.positionRef } }))
    const linked = await attributed(orderBody({ buyer, attribution: { kind: 'link', position_ref: p2.positionRef } }))
    const coded = await attributed(orderBody({ buyer, attribution: { kind: 'code', position_ref: p2.positionRef } }))
    const plain = await attributed(orderBody({ buyer }))
    const unknownRef = await attributed(orderBody({ buyer, attribution: { kind: 'link', position_ref: 'NO-SUCH-REF' } }))

    expect(first).toMatchObject({ position: p1.positionRef, source: 'link', conflict: false })
    expect(await ownerRows('SELECT servicing_position_id, source FROM customer_servicing WHERE customer_id = $1', [first.order.buyer.id]))
      .toEqual([{ servicing_position_id: p1.positionId, source: 'first_order' }])
    expect(linked).toMatchObject({ position: p2.positionRef, source: 'link', conflict: true })
    expect(coded).toMatchObject({ position: p2.positionRef, source: 'code', conflict: true })
    expect(plain).toMatchObject({ position: p1.positionRef, source: 'servicing', conflict: false })
    expect(unknownRef).toMatchObject({ position: p1.positionRef, source: 'servicing', conflict: false })
    await setSettings(acme.id, shop.admin.id, { 'orders.attribution_precedence': ['servicing', 'link'] })
    const servicingFirst = await attributed(orderBody({ buyer, attribution: { kind: 'link', position_ref: p2.positionRef } }))
    await setSettings(acme.id, shop.admin.id, { 'orders.attribution_precedence': ['link', 'code', 'servicing'] })
    expect(servicingFirst).toMatchObject({ position: p1.positionRef, source: 'servicing', conflict: true })
  })

  test('a hint counts only for a position that existed and was not terminated at the crediting time', async () => {
    const at = '2025-06-01T00:00:00Z'
    const later = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType, '2026-01-01T00:00:00Z')
    const gone = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    await withTenant({ tenantId: acme.id, userId: shop.admin.id }, (tx) =>
      tx.query(`SELECT gen_set_position_status($1, 'terminated', '2026-01-02T00:00:00Z', 'fixture', NULL)`, [gone.positionId]))

    const beforeCreation = await attributed(orderBody({ ordered_at: at, paid_at: at, attribution: { kind: 'link', position_ref: later.positionRef } }))
    const terminatedSince = await attributed(orderBody({ ordered_at: at, paid_at: at, attribution: { kind: 'link', position_ref: gone.positionRef } }))

    expect(beforeCreation).toMatchObject({ position: null, source: null, conflict: false })
    expect(terminatedSince).toMatchObject({ position: gone.positionRef, source: 'link' })
    expect(await ownerRows('SELECT 1 FROM customer_servicing WHERE customer_id = $1', [terminatedSince.order.buyer.id])).toEqual([])
  })

  test('a pending (duplicate-held) or suspended position takes no credit and services no one: the hint is dropped as a conflict', async () => {
    const before = '2025-06-01T00:00:00Z'
    const held = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType, undefined, 'pending')
    const suspended = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    await withTenant({ tenantId: acme.id, userId: shop.admin.id }, (tx) =>
      tx.query(`SELECT gen_set_position_status($1, 'suspended', '2026-01-02T00:00:00Z', 'fixture', NULL)`, [suspended.positionId]))

    const toHeld = await attributed(orderBody({ attribution: { kind: 'link', position_ref: held.positionRef } }))
    const toSuspended = await attributed(orderBody({ attribution: { kind: 'code', position_ref: suspended.positionRef } }))
    const whileActive = await attributed(orderBody({ ordered_at: before, paid_at: before, attribution: { kind: 'link', position_ref: suspended.positionRef } }))

    expect(toHeld).toMatchObject({ position: null, source: null, conflict: true })
    expect(toSuspended).toMatchObject({ position: null, source: null, conflict: true })
    // Active at the crediting time, so credited; suspended now, so it does not become the customer's servicer.
    expect(whileActive).toMatchObject({ position: suspended.positionRef, source: 'link', conflict: false })
    const buyers = [toHeld, toSuspended, whileActive].map((result) => result.order.buyer.id as string)
    expect(await ownerRows('SELECT 1 FROM customer_servicing WHERE customer_id = ANY ($1::uuid[])', [buyers])).toEqual([])
  })

  test('a distributor buying is credited to their own position; purpose given, unspecified, or flagged when required (TS-65)', async () => {
    const [own] = await ownerRows<{ external_ref: string }>('SELECT external_ref FROM participant WHERE id = (SELECT participant_id FROM position_ownership WHERE position_id = $1)', [p2.positionId])
    const buyer = { external_ref: own!.external_ref }

    const resale = await attributed(orderBody({ buyer, purpose: 'resale', attribution: { kind: 'link', position_ref: p1.positionRef } }))
    const unspecified = await attributed(orderBody({ buyer }))
    await setSettings(acme.id, shop.admin.id, { 'orders.purpose_required': true })
    const missing = await attributed(orderBody({ buyer }))
    await setSettings(acme.id, shop.admin.id, { 'orders.purpose_required': null })

    expect(resale).toMatchObject({ position: p2.positionRef, source: 'buyer', conflict: false })
    expect(resale.order).toMatchObject({ purpose: 'resale', purpose_missing: false, buyer_type: { code: 'DIST' } })
    expect(unspecified.order).toMatchObject({ purpose: 'unspecified', purpose_missing: false })
    expect(missing.order).toMatchObject({ purpose: 'unspecified', purpose_missing: true })
  })

  test('T-B2-28: order facts are fixed: the runtime role cannot change them', async () => {
    const { order } = await attributed(orderBody())
    const update = withTenant({ tenantId: acme.id, userId: shop.admin.id }, (tx) => tx.query('UPDATE sales_order SET amount_minor = 1 WHERE id = $1', [order.id]))

    await expect(update).rejects.toMatchObject({ code: '42501' })
  })
})

describe('B3 carry-over in ingestion (D-B3-05, OI-4, OI-7)', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  test('T-B3-16 / D-B6-05: the plan version\'s crediting event applies, before the first version too; no plan refuses the order', async () => {
    const ie = await createMarket(acme.id, 'IE')
    await createMarket(acme.id, 'LU')
    await volumes(app, shop.admin, ie, 'SKU-A', { qv: '150' })
    await volumes(app, shop.admin, ie, 'SKU-B', { qv: '100' })
    await activePlanVersion(acme.id, ie, { submitterId: shop.admin.id, approverId: analyst.id, creditingEvent: 'fulfilled', effectiveFrom: ago(3_600_000) })
    const [paid, fulfilled] = [ago(120_000), ago(60_000)]
    const times = { paid_at: paid, fulfilled_at: fulfilled }

    const covered = await postOrder(orderBody({ market: 'IE', ordered_at: paid, ...times }))
    const beforePlan = await postOrder(orderBody({ market: 'IE', ordered_at: ago(7_200_000), ...times }))
    const uncovered = await postOrder(orderBody({ market: 'LU', ordered_at: paid, ...times }))
    const unfulfilled = await postOrder(orderBody({ market: 'IE', ordered_at: paid, paid_at: paid }))

    const creditedAt = (response: Awaited<ReturnType<typeof postOrder>>) => Date.parse(response.json().data.order.credited_at)
    expect([covered.statusCode, beforePlan.statusCode]).toEqual([201, 201])
    expect(creditedAt(covered)).toBe(Date.parse(fulfilled))
    expect(creditedAt(beforePlan)).toBe(Date.parse(fulfilled)) // ordered before the market's first version: its event (D-B6-05)
    expect(uncovered.json().error).toMatchObject({
      code: 'CREDITING_EVENT_NOT_CONFIGURED', message: 'Schedule a plan version for this market before sending orders.',
    })
    expect([unfulfilled.statusCode, unfulfilled.json().error.code]).toEqual([422, 'CREDITING_EVENT_MISSING'])
  })

  test('OI-7: minor strings hold at most 18 digits (19 refused); per-unit volumes are never negative', async () => {
    const max = '999999999999999999'
    const big = await postOrder(orderBody({ amount_minor: max, tax_minor: '0', lines: [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: max }] }))
    const tooBig = await postOrder(orderBody({ amount_minor: `${max}9`, lines: [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: `${max}9` }] }))
    const refund = await asKey(app, shop.token, '/v1/order-events', {
      source_system: 'shop', source_event_id: randomUUID(), source_order_id: 'any', type: 'refund', occurred_at: ago(1_000), refund_minor: `${max}9`, fee_minor: '0',
    })
    const perUnit = (value: string) => call(app, {
      method: 'POST', url: '/v1/product-volumes', as: shop.admin, idempotencyKey: true,
      body: { market_id: shop.marketId, sku: `SKU-${randomUUID().slice(0, 8)}`, item_class: 'product', volumes: { qv: value }, valid_from: ago(1_000), reason: 'OI-7' },
    })

    expect(big.statusCode, big.body).toBe(201)
    expect([tooBig.statusCode, tooBig.json().error.code]).toEqual([400, 'VALIDATION_FAILED'])
    expect([refund.statusCode, refund.json().error.code]).toEqual([400, 'VALIDATION_FAILED'])
    expect((await perUnit(max)).statusCode).toBe(201)
    expect([(await perUnit('-1')).statusCode, (await perUnit(`${max}9`)).statusCode]).toEqual([400, 400])
  })

  test('OI-4: a servicing change landing between the first-order check and C1 is 409 SERVICING_CHANGE_PENDING, never a 500', async () => {
    const seller = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    const other = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    const externalRef = `customer-${randomUUID()}`
    const [customer] = await ownerRows<{ id: string }>(
      `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by)
       VALUES ($1, $2, 'individual', $3, '2020-01-01', $4) RETURNING id`, [acme.id, externalRef, shop.marketId, shop.admin.id])
    await ownerRows(`INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by)
                     VALUES ($1, $2, $3, '2020-01-01', $4)`, [acme.id, customer!.id, shop.retailType, shop.admin.id])
    const holder = await getOwnerPool().connect()
    try {
      // Holds C1's per-customer lock, so the ingestion waits inside C1 after its check found no servicer.
      await holder.query(`SELECT pg_advisory_lock(hashtextextended('servicing:' || $1, 0))`, [customer!.id])
      const ingesting = postOrder(orderBody({ buyer: { external_ref: externalRef }, attribution: { kind: 'link', position_ref: seller.positionRef } }))
      while ((await holder.query(`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rowCount === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await holder.query(
        `INSERT INTO customer_servicing (tenant_id, customer_id, servicing_position_id, source, valid_from, reason, created_by, created_by_type)
         VALUES ($1, $2, $3, 'manual', now() + interval '1 day', 'pending change', $4, 'user')`,
        [acme.id, customer!.id, other.positionId, shop.admin.id])
      await holder.query(`SELECT pg_advisory_unlock(hashtextextended('servicing:' || $1, 0))`, [customer!.id])
      const response = await ingesting

      expect([response.statusCode, response.json().error.code]).toEqual([409, 'SERVICING_CHANGE_PENDING'])
      expect(await ownerRows('SELECT servicing_position_id FROM customer_servicing WHERE customer_id = $1', [customer!.id]))
        .toEqual([{ servicing_position_id: other.positionId }])
    } finally {
      holder.release()
    }
  })

  test('OI-4: with a pending future servicer the first order changes no servicing and is accepted', async () => {
    const seller = await participantWithPosition(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    const buyer = { external_ref: `customer-${randomUUID()}` }
    const first = await postOrder(orderBody({ buyer }))
    const customerId = first.json().data.order.buyer.id as string
    await ownerRows(
      `INSERT INTO customer_servicing (tenant_id, customer_id, servicing_position_id, source, valid_from, reason, created_by, created_by_type)
       VALUES ($1, $2, $3, 'manual', now() + interval '1 day', 'pending change', $4, 'user')`,
      [acme.id, customerId, seller.positionId, shop.admin.id])

    const attributed = await postOrder(orderBody({ buyer, attribution: { kind: 'link', position_ref: seller.positionRef } }))

    expect(attributed.statusCode).toBe(201)
    expect(await ownerRows('SELECT source FROM customer_servicing WHERE customer_id = $1', [customerId])).toEqual([{ source: 'manual' }])
  })
})
