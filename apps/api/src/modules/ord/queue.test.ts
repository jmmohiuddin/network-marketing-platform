import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ordModule } from './index.js'
import { asKey, committedPeriod, orderBody, ordersTenant, type OrdersTenant } from './test-support.js'

let app: FastifyInstance
let shop: OrdersTenant
let analyst: TestUser
let ieAnalyst: TestUser
let payout: TestUser
let globexAdmin: TestUser
let lateOrder: { id: string; source_order_id: string }
let liveOrder: { id: string }

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  const ie = await createMarket(acme.id, 'IE')
  await createMarket(globex.id, 'GB')
  const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  ieAnalyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [ie] })
  payout = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, ordModule] })
  shop = await ordersTenant(app, acme.id, gb, admin, approver)
  await committedPeriod(acme.id, gb, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')
  const at = '2025-01-10T09:00:00Z'
  lateOrder = (await asKey(app, shop.token, '/v1/orders', orderBody({ ordered_at: at, paid_at: at }))).json().data.order
  liveOrder = (await asKey(app, shop.token, '/v1/orders', orderBody())).json().data.order
  await asKey(app, shop.token, '/v1/orders', orderBody({ lines: [{ line_no: 1, sku: 'SKU-X', quantity: 1, amount_minor: '3000' }] }))
  await asKey(app, shop.token, '/v1/orders', orderBody({ currency: 'EUR' }))
})

afterAll(async () => {
  await app.close()
})

const get = (url: string, as: TestUser) => call(app, { method: 'GET', url, as })

describe('GET /v1/orders, /summary, /:id', () => {
  test('lists orders newest credited first with cursor paging and filters; market scope applies', async () => {
    const firstPage = await get('/v1/orders?limit=1', analyst)
    const next = await get(`/v1/orders?limit=1&cursor=${firstPage.json().meta.next_cursor}`, analyst)
    const late = await get('/v1/orders?late=true', analyst)

    expect(firstPage.json().data.map((row: { id: string }) => row.id)).toEqual([liveOrder.id])
    expect(next.json().data.map((row: { id: string }) => row.id)).toEqual([lateOrder.id])
    expect(late.json().data).toEqual([expect.objectContaining({ id: lateOrder.id, late: true, events: 0, volumes: { bv: '14', qv: '400' } })])
    expect((await get('/v1/orders', ieAnalyst)).json().data).toEqual([])
    expect((await get(`/v1/orders?market_id=${shop.marketId}&flag=attribution_conflict`, analyst)).json().data).toEqual([])
  })

  test('summary counts orders, held, pending late items and flags', async () => {
    expect((await get('/v1/orders/summary', analyst)).json().data).toEqual({ orders: 2, held: 1, late_pending: 1, purpose_missing: 0, attribution_conflict: 0 })
  })

  test('detail has lines, events, late items and the inbound source; out of scope or another tenant is 404; permission needed', async () => {
    const detail = await get(`/v1/orders/${lateOrder.id}`, analyst)

    expect(detail.json().data).toMatchObject({
      id: lateOrder.id, buyer: { display_name: null }, events: [], source: { source: 'api:shop' },
      late_transactions: [expect.objectContaining({ origin_type: 'order', origin_id: lateOrder.id, state: 'pending' })],
    })
    expect((await get(`/v1/orders/${lateOrder.id}`, ieAnalyst)).statusCode).toBe(404)
    expect((await get(`/v1/orders/${lateOrder.id}`, globexAdmin)).statusCode).toBe(404)
    expect((await get('/v1/orders', payout)).statusCode).toBe(403)
    expect((await get('/v1/orders?late=yes', analyst)).json().error.code).toBe('VALIDATION_FAILED')
  })
})

describe('GET /v1/inbound-events (exception queue)', () => {
  test('lists held and rejected events without payloads; another tenant sees none; permission needed', async () => {
    const held = await get('/v1/inbound-events?state=held', analyst)
    const rejected = await get('/v1/inbound-events?state=rejected', shop.admin)

    expect(held.json().data).toEqual([expect.objectContaining({ state: 'held', hold_reason: 'UNKNOWN_SKU', hold_ref: 'SKU-X', attempts: 1 })])
    expect(held.json().data[0]).not.toHaveProperty('payload')
    expect(rejected.json().data).toEqual([expect.objectContaining({ result: { error: { code: 'CURRENCY_MISMATCH' } } })])
    expect((await get('/v1/inbound-events', globexAdmin)).json().data).toEqual([])
    expect((await get('/v1/inbound-events', payout)).statusCode).toBe(403)
    expect((await get('/v1/inbound-events', ieAnalyst)).json().error.code).toBe('SCOPE_NOT_HELD') // C-B2-23: no market on inbound events
  })
})

describe('GET/POST /v1/product-volumes', () => {
  const set = (body: Record<string, unknown>, as: TestUser = shop.admin) =>
    call(app, { method: 'POST', url: '/v1/product-volumes', as, body, idempotencyKey: true })
  const row = (overrides: Record<string, unknown> = {}) => ({
    market_id: shop.marketId, sku: `SKU-${randomUUID().slice(0, 8)}`, item_class: 'product', volumes: { qv: '10' },
    valid_from: '2024-01-01T00:00:00Z', reason: 'price list', ...overrides,
  })

  test('the first row may be back-dated; later rows start in the future after the latest and close the open row', async () => {
    const first = row()
    const future = new Date(Date.now() + 86_400_000).toISOString()

    expect((await set(first)).statusCode).toBe(201)
    expect((await set({ ...first, valid_from: '2024-06-01T00:00:00Z' })).json().error.code).toBe('VALID_FROM_INVALID')
    const next = await set({ ...first, volumes: { qv: '12' }, valid_from: future })
    expect(next.statusCode).toBe(201)
    expect((await set({ ...first, valid_from: future })).json().error.code).toBe('VOLUME_ROW_EXISTS')
    const now = await get(`/v1/product-volumes?sku=${first.sku}&at=${new Date().toISOString()}`, analyst)
    expect(now.json().data).toEqual([expect.objectContaining({ sku: first.sku, volumes: { qv: '10' }, valid_to: next.json().data.valid_from })])
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'PRODUCT_VOLUME.SET' AND object_id = $1`, [next.json().data.id])).toHaveLength(1)
  })

  test('validation, permission, scope and tenant isolation', async () => {
    expect((await set(row({ volumes: {} }))).json().error.code).toBe('VALIDATION_FAILED')
    expect((await set(row({ volumes: { qv: '1.5' } }))).json().error.code).toBe('VALIDATION_FAILED')
    expect((await set(row(), analyst)).statusCode).toBe(403)
    expect((await set(row(), globexAdmin)).json().error.code).toBe('VALIDATION_FAILED') // acme's market is unknown to globex
    expect((await get('/v1/product-volumes', globexAdmin)).json().data).toEqual([])
    expect((await get('/v1/product-volumes', payout)).statusCode).toBe(403)
  })
})

describe('late-transaction queue (T-B2-31)', () => {
  let ids: string[]

  beforeAll(async () => {
    const at = '2025-01-12T09:00:00Z'
    const second = (await asKey(app, shop.token, '/v1/orders', orderBody({ ordered_at: at, paid_at: at }))).json().data.order
    const rows = await ownerRows<{ id: string }>('SELECT id FROM late_transaction WHERE order_id = ANY ($1) ORDER BY id', [[lateOrder.id, second.id]])
    ids = rows.map((item) => item.id)
  })

  test('lists with meta.counts; scope and permission apply', async () => {
    const list = await get('/v1/late-transactions?state=pending', analyst)

    expect(list.json().data).toHaveLength(2)
    expect(list.json().data[0]).toMatchObject({ origin_type: 'order', handling: 'adjust', original_period: { state: 'committed' } })
    expect(list.json().meta.counts).toEqual({ pending: 2, decided_30d: 0 })
    expect((await get('/v1/late-transactions', ieAnalyst)).json().data).toEqual([])
    expect((await get('/v1/late-transactions', shop.admin)).statusCode).toBe(403)
  })

  test('AC-ORD5-1: preview totals without side effects; decide once, then 409 LATE_NOT_PENDING', async () => {
    const preview = await call(app, { method: 'POST', url: '/v1/late-transactions/preview', as: analyst, body: { ids } })

    expect(preview.json().data).toEqual({ count: 2, volumes: { bv: '28', qv: '800' }, amount_minor: '6000', affected_positions: [] })
    expect(await ownerRows(`SELECT 1 FROM late_transaction WHERE id = ANY ($1) AND state <> 'pending'`, [ids])).toEqual([])
    const outOfScope = await call(app, { method: 'POST', url: '/v1/late-transactions/preview', as: ieAnalyst, body: { ids } })
    expect(outOfScope.json().error).toMatchObject({ code: 'LATE_SELECTION_INVALID', details: { ids } })

    const decided = await call(app, { method: 'POST', url: '/v1/late-transactions/decisions', as: analyst, body: { ids: [ids[0]], reason: 'accept' }, idempotencyKey: true })
    const restated = await call(app, {
      method: 'POST', url: '/v1/late-transactions/decisions', as: analyst, body: { ids: [ids[1]], handling: 'restatement', reason: 'large' }, idempotencyKey: true,
    })
    const again = await call(app, { method: 'POST', url: '/v1/late-transactions/decisions', as: analyst, body: { ids, reason: 'again' }, idempotencyKey: true })

    expect(decided.json().data).toEqual({ decided: 1 })
    expect(restated.json().data).toEqual({ decided: 1 })
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({ code: 'LATE_NOT_PENDING', details: { ids } })
    expect(await ownerRows('SELECT handling, state, decided_by FROM late_transaction WHERE id = ANY ($1) ORDER BY id', [ids])).toEqual([
      { handling: 'adjust', state: 'decided', decided_by: analyst.id }, { handling: 'restatement', state: 'decided', decided_by: analyst.id },
    ])
    expect((await get('/v1/late-transactions', analyst)).json().meta.counts).toEqual({ pending: 0, decided_30d: 2 })
    const globexAnalyst = await createSignedInUser({ tenantId: (await ownerRows<{ tenant_id: string }>('SELECT tenant_id FROM user_account WHERE id = $1', [globexAdmin.id]))[0]!.tenant_id, roles: ['Commission analyst'] })
    const foreign = await call(app, { method: 'POST', url: '/v1/late-transactions/decisions', as: globexAnalyst, body: { ids, reason: 'x' }, idempotencyKey: true })
    expect(foreign.json().error.code).toBe('LATE_SELECTION_INVALID')
  })
})
