import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ordModule } from '../ord/index.js'
import { intModule } from './index.js'
import { commerceTenant, distributor as distributorOf, setSettings } from './test-support.js'

let app: FastifyInstance
let acme: TestTenant
let shop: { admin: TestUser; marketId: string; distributorType: string }
let analyst: TestUser
let globexAdmin: TestUser

const SECRET = 'shpss_fixture_secret_0123456789'
const WOO_SECRET = 'woo_fixture_secret_0123456789'
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./test-fixtures/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  await createMarket(acme.id, 'IE')
  const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, ordModule, intModule] })
  shop = { admin, marketId: gb, distributorType: await commerceTenant(acme.id, gb, admin.id, approver.id) }
})

afterAll(async () => {
  await app.close()
})

async function install(body: Record<string, unknown>, as: TestUser = shop.admin) {
  return call(app, { method: 'POST', url: '/v1/connectors', as, body: { market_id: shop.marketId, ...body }, idempotencyKey: true })
}

/** A signed delivery as the store sends it: raw JSON, HMAC header, topic header, no X-Requested-With, no cookie. */
function deliver(connectorId: string, provider: 'shopify' | 'woocommerce', topic: string, payload: unknown, secret: string) {
  const raw = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(raw).digest('base64')
  const headers = provider === 'shopify'
    ? { 'x-shopify-hmac-sha256': signature, 'x-shopify-topic': topic }
    : { 'x-wc-webhook-signature': signature, 'x-wc-webhook-topic': topic }
  return app.inject({ method: 'POST', url: `/v1/connectors/${connectorId}/webhooks`, headers: { 'content-type': 'application/json', ...headers }, payload: raw })
}

let nextId = 1000
const shopifyOrder = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...fixture('shopify-order'), id: (nextId += 1), ...overrides })
const inboundOf = (connectorId: string) =>
  ownerRows<{ state: string; result: { error?: { code: string } } | null }>(
    'SELECT state, result FROM inbound_event WHERE source = $1 ORDER BY received_at', [`connector:${connectorId}`],
  )

describe('connectors (FR-ORD-002 install, rotate, withdraw)', () => {
  test('install needs step-up and all markets; the secret is sealed and never returned; names and provider+market are unique', async () => {
    const plain = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
    const scoped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [shop.marketId], stepUp: true })

    expect((await install({ provider: 'shopify', name: 'Shop', webhook_secret: SECRET }, plain)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await install({ provider: 'shopify', name: 'Shop', webhook_secret: SECRET }, scoped)).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await install({ provider: 'shopify', name: 'Shop', webhook_secret: 'short' })).json().error.code).toBe('VALIDATION_FAILED')
    const created = await install({ provider: 'shopify', name: 'UK store', webhook_secret: SECRET })

    expect(created.statusCode).toBe(201)
    const { connector, webhook_url: url } = created.json().data
    expect(url).toBe(`${app.config.webUrl}/v1/connectors/${connector.id}/webhooks`)
    expect(created.body).not.toContain(SECRET)
    const [row] = await ownerRows<{ webhook_secret_sealed: string }>('SELECT webhook_secret_sealed FROM provider_config WHERE id = $1', [connector.id])
    expect(row!.webhook_secret_sealed).toMatch(/^v1\./)
    expect((await install({ provider: 'woocommerce', name: 'uk STORE', webhook_secret: SECRET })).json().error.code).toBe('CONNECTOR_NAME_TAKEN')
    expect((await install({ provider: 'shopify', name: 'Second', webhook_secret: SECRET })).json().error.code).toBe('CONNECTOR_EXISTS')
    const list = await call(app, { method: 'GET', url: '/v1/connectors', as: shop.admin })
    expect(list.json().data).toEqual([expect.objectContaining({ id: connector.id, provider: 'shopify', name: 'UK store', state: 'recorded', webhook_url: url })])
    expect(list.body).not.toContain('sealed')
    expect((await call(app, { method: 'GET', url: '/v1/connectors', as: analyst })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/connectors', as: globexAdmin })).json().data).toEqual([])
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'CONNECTOR.INSTALLED' AND object_id = $1`, [connector.id])).toHaveLength(1)
  })
})

describe('POST /v1/connectors/:id/webhooks (T-B2-26 signatures, T-B2-27 mapping)', () => {
  let shopify: string
  let woo: string

  beforeAll(async () => {
    shopify = (await call(app, { method: 'GET', url: '/v1/connectors', as: shop.admin })).json().data[0].id
    const created = await call(app, {
      method: 'POST', url: '/v1/connectors', as: shop.admin, idempotencyKey: true,
      body: { market_id: shop.marketId, provider: 'woocommerce', name: 'Woo UK', webhook_secret: WOO_SECRET },
    })
    woo = created.json().data.connector.id
  })

  test('AC-ORD2-1: a signed orders/paid creates one order (discounts allocated, shipping and tax outside the total); redelivery changes nothing', async () => {
    const payload = shopifyOrder()
    const first = await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET)
    const again = await deliver(shopify, 'shopify', 'orders/updated', payload, SECRET)

    expect(first.statusCode, first.body).toBe(200)
    expect(first.json().data).toEqual({ accepted: true })
    expect(again.statusCode).toBe(200)
    const orders = await ownerRows<{ id: string; amount_minor: string; tax_minor: string; purpose: string }>(
      'SELECT id, amount_minor, tax_minor, purpose FROM sales_order WHERE source_system = $1 AND source_order_id = $2', [`shopify:${shopify}`, String(payload.id)],
    )
    expect(orders).toEqual([{ id: expect.any(String), amount_minor: '2800', tax_minor: '560', purpose: 'customer' }])
    expect(await ownerRows('SELECT line_no, amount_minor, source_line_id FROM order_line WHERE order_id = $1 ORDER BY line_no', [orders[0]!.id])).toEqual([
      { line_no: 1, amount_minor: '1850', source_line_id: '9001' }, { line_no: 2, amount_minor: '950', source_line_id: '9002' },
    ])
    expect(await ownerRows(`SELECT external_ref FROM participant WHERE id = (SELECT buyer_id FROM sales_order WHERE id = $1)`, [orders[0]!.id]))
      .toEqual([{ external_ref: 'shopify:7001' }])
    expect((await ownerRows<{ last_ok_at: Date | null }>('SELECT last_ok_at FROM provider_config WHERE id = $1', [shopify]))[0]!.last_ok_at).not.toBeNull()
  })

  test('AC-ORD2-2: a wrong or missing signature is 401 and stores nothing; unknown connectors are 404', async () => {
    const before = (await inboundOf(shopify)).length
    const wrong = await deliver(shopify, 'shopify', 'orders/paid', shopifyOrder(), 'not-the-secret-at-all')
    const missing = await app.inject({ method: 'POST', url: `/v1/connectors/${shopify}/webhooks`, headers: { 'content-type': 'application/json' }, payload: '{}' })

    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error).toMatchObject({ code: 'SIGNATURE_INVALID', details: null })
    expect(missing.statusCode).toBe(401)
    expect(await inboundOf(shopify)).toHaveLength(before)
    expect((await deliver('00000000-0000-4000-8000-000000000000', 'shopify', 'orders/paid', {}, SECRET)).statusCode).toBe(404)
    expect((await deliver('not-a-uuid', 'shopify', 'orders/paid', {}, SECRET)).statusCode).toBe(404)
  })

  test('hints, tagged buyers and refusals map as PLAN 2.6 says', async () => {
    const distributor = await distributorOf(acme.id, shop.admin.id, shop.marketId, shop.distributorType)
    const linked = shopifyOrder({ customer: { id: 7002, tags: '' }, note_attributes: [{ name: 'nmp_ref', value: distributor.positionRef }] })
    const own = shopifyOrder({ customer: { id: 7003, tags: `vip, nmp:${distributor.externalRef}` } })
    const guest = shopifyOrder({ customer: null })
    const unknownTag = shopifyOrder({ customer: { id: 7004, tags: 'nmp:nobody' } })
    const precision = shopifyOrder({ line_items: [{ id: 1, sku: 'SKU-A', quantity: 1, price: '10.005', discount_allocations: [], tax_lines: [] }] })

    for (const payload of [linked, own, guest, unknownTag, precision]) {
      expect((await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET)).statusCode).toBe(200)
    }
    const order = (id: unknown) => ownerRows('SELECT purpose, attribution_source, attributed_position_id FROM sales_order WHERE source_order_id = $1', [String(id)])
    expect(await order(linked.id)).toEqual([{ purpose: 'customer', attribution_source: 'link', attributed_position_id: distributor.positionId }])
    expect(await order(own.id)).toEqual([{ purpose: 'unspecified', attribution_source: 'buyer', attributed_position_id: distributor.positionId }])
    const rejected = await ownerRows<{ result: { error: { code: string } } }>(
      `SELECT result FROM inbound_event WHERE source = $1 AND state = 'rejected' ORDER BY received_at DESC LIMIT 3`, [`connector:${shopify}`],
    )
    expect(rejected.map((row) => row.result.error.code)).toEqual(['AMOUNT_PRECISION', 'BUYER_NOT_FOUND', 'BUYER_MISSING'])
  })

  test('AC-ORD2-3 unknown SKU is held; refunds/create returns the line; other topics are ignored', async () => {
    const unmapped = shopifyOrder({ line_items: [{ id: 3, sku: 'SKU-UNMAPPED', quantity: 1, price: '5.00', discount_allocations: [], tax_lines: [] }] })
    const held = await deliver(shopify, 'shopify', 'orders/paid', unmapped, SECRET)
    const payload = shopifyOrder()
    await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET)
    const refund = await deliver(shopify, 'shopify', 'refunds/create', { ...fixture('shopify-refund'), id: (nextId += 1), order_id: payload.id }, SECRET)
    const ignored = await deliver(shopify, 'shopify', 'customers/create', { id: 1 }, SECRET)

    expect(held.statusCode).toBe(202)
    expect(held.json().data).toMatchObject({ accepted: true, held: { reason: 'UNKNOWN_SKU', skus: ['SKU-UNMAPPED'] } })
    expect(refund.statusCode).toBe(200)
    expect(await ownerRows(
      `SELECT e.type, e.refund_minor, e.lines FROM order_event e JOIN sales_order o ON o.id = e.order_id WHERE o.source_order_id = $1`, [String(payload.id)],
    )).toEqual([{ type: 'return', refund_minor: '925', lines: [{ line_no: 1, quantity: 1 }] }])
    expect(ignored.json().data).toEqual({ accepted: true, ignored: true })
  })

  test('C-B2-24: a refund delivered after the cancellation that reversed its lines is recorded money-only, not refused', async () => {
    const payload = shopifyOrder()
    await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET)
    const cancelled = await deliver(shopify, 'shopify', 'orders/cancelled', { ...payload, financial_status: 'refunded', cancelled_at: '2026-11-11T09:00:00+00:00' }, SECRET)
    const refund = await deliver(shopify, 'shopify', 'refunds/create', { ...fixture('shopify-refund'), id: (nextId += 1), order_id: payload.id }, SECRET)

    expect([cancelled.statusCode, refund.statusCode]).toEqual([200, 200])
    expect(await ownerRows(
      `SELECT e.type, e.refund_minor, e.lines, e.volume_effect FROM order_event e JOIN sales_order o ON o.id = e.order_id
       WHERE o.source_order_id = $1 ORDER BY e.occurred_at`, [String(payload.id)],
    )).toEqual([
      { type: 'cancelled', refund_minor: '0', lines: [{ line_no: 1, quantity: 2 }, { line_no: 2, quantity: 1 }], volume_effect: expect.objectContaining({ total: { qv: '-400' } }) },
      { type: 'return', refund_minor: '925', lines: [], volume_effect: {} },
    ])
    expect((await inboundOf(shopify)).at(-1)!.state).toBe('processed')
  })

  test('WooCommerce: processing orders by signature; guests refused; a refunded order returns every remaining line', async () => {
    const payload = { ...fixture('woocommerce-order'), id: (nextId += 1) }
    const created = await deliver(woo, 'woocommerce', 'order.created', payload, WOO_SECRET)
    const guest = await deliver(woo, 'woocommerce', 'order.created', { ...payload, id: (nextId += 1), customer_id: 0 }, WOO_SECRET)
    const refunded = await deliver(woo, 'woocommerce', 'order.updated', { ...payload, status: 'refunded' }, WOO_SECRET)
    const forged = await deliver(woo, 'woocommerce', 'order.created', payload, SECRET)

    expect([created.statusCode, guest.statusCode, refunded.statusCode, forged.statusCode]).toEqual([200, 200, 200, 401])
    const [order] = await ownerRows<{ id: string; amount_minor: string; tax_minor: string }>(
      'SELECT id, amount_minor, tax_minor FROM sales_order WHERE source_system = $1', [`woocommerce:${woo}`],
    )
    expect(order).toMatchObject({ amount_minor: '2800', tax_minor: '560' })
    expect(await ownerRows('SELECT type, lines, refund_minor FROM order_event WHERE order_id = $1', [order!.id]))
      .toEqual([{ type: 'refund', lines: [{ line_no: 1, quantity: 2 }, { line_no: 2, quantity: 1 }], refund_minor: '3760' }])
    expect((await inboundOf(woo)).map((row) => row.result?.error?.code ?? row.state)).toEqual(['processed', 'BUYER_MISSING', 'processed'])
  })

  test('T-B2-36 / AC-22.2: a store edit after ingestion is refused ORDER_CONFLICT, persisted, answered 200', async () => {
    const payload = shopifyOrder()
    await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET)
    const edited = await deliver(shopify, 'shopify', 'orders/updated', { ...payload, line_items: [(payload.line_items as unknown[])[0]] }, SECRET)

    expect(edited.statusCode).toBe(200)
    const rows = await ownerRows<{ state: string }>('SELECT state FROM inbound_event WHERE idempotency_key = $1 ORDER BY received_at', [`order:shopify:${shopify}:${payload.id}`])
    expect(rows.map((row) => row.state)).toEqual(['processed', 'rejected'])
    const health = await call(app, { method: 'GET', url: '/v1/integrations/health', as: analyst })
    const source = health.json().data.sources.find((row: { source: string }) => row.source === `connector:${shopify}`)
    expect(source).toMatchObject({ kind: 'connector', provider: 'shopify', state: 'failing', last_error: { code: 'ORDER_CONFLICT' } })
    expect(source.errors_24h).toBeGreaterThanOrEqual(1)
  })

  test('AC-22.2: store lifecycle steps (fulfilment, completion, later saves of a refunded order) are replays, not conflicts', async () => {
    const payload = shopifyOrder()
    const fulfilled = { ...payload, fulfillment_status: 'fulfilled', fulfillments: [{ created_at: '2026-11-11T08:00:00+00:00' }], updated_at: '2026-11-11T08:00:00+00:00' }
    const wooOrder = { ...fixture('woocommerce-order'), id: (nextId += 1) }
    const completed = { ...wooOrder, status: 'completed', date_completed_gmt: '2026-11-11T09:00:00', date_modified_gmt: '2026-11-11T09:00:00' }
    const refunded = { ...completed, status: 'refunded', date_modified_gmt: '2026-11-12T09:00:00' }

    const responses = [
      await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET),
      await deliver(shopify, 'shopify', 'orders/fulfilled', fulfilled, SECRET),
      await deliver(shopify, 'shopify', 'orders/updated', fulfilled, SECRET),
      await deliver(woo, 'woocommerce', 'order.created', wooOrder, WOO_SECRET),
      await deliver(woo, 'woocommerce', 'order.updated', completed, WOO_SECRET),
      await deliver(woo, 'woocommerce', 'order.updated', refunded, WOO_SECRET),
      await deliver(woo, 'woocommerce', 'order.updated', { ...refunded, date_modified_gmt: '2026-11-13T09:00:00' }, WOO_SECRET),
    ]

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200, 200, 200])
    const keys = [`order:shopify:${shopify}:${payload.id}`, `order:woocommerce:${woo}:${wooOrder.id}`, `event:woocommerce:${woo}:refund:${wooOrder.id}`]
    expect(await ownerRows('SELECT idempotency_key, state FROM inbound_event WHERE idempotency_key = ANY ($1) ORDER BY idempotency_key', [keys]))
      .toEqual(keys.map((key) => ({ idempotency_key: key, state: 'processed' })).sort((a, b) => a.idempotency_key.localeCompare(b.idempotency_key)))
  })

  test('C-B2-19: an unpaid Shopify order (financial_status pending) is not credited under crediting paid', async () => {
    const pending = shopifyOrder({ financial_status: 'pending' })

    expect((await deliver(shopify, 'shopify', 'orders/updated', pending, SECRET)).json().data).toEqual({ accepted: true, ignored: true })
    expect(await ownerRows('SELECT 1 FROM sales_order WHERE source_order_id = $1', [String(pending.id)])).toEqual([])
  })

  test('C-B2-20: orders/edited is ignored; a signed body that is not an order is persisted PAYLOAD_INVALID and answered 200', async () => {
    const edited = await deliver(shopify, 'shopify', 'orders/edited', { order_edit: { id: 1, order_id: 5 } }, SECRET)
    const garbage = await deliver(shopify, 'shopify', 'orders/paid', { not: 'an order' }, SECRET)

    expect(edited.json().data).toEqual({ accepted: true, ignored: true })
    expect(garbage.statusCode).toBe(200)
    const [row] = await ownerRows<{ idempotency_key: string; result: { error: { code: string } } }>(
      `SELECT idempotency_key, result FROM inbound_event WHERE source = $1 AND idempotency_key LIKE 'payload:%'`, [`connector:${shopify}`],
    )
    expect(row!.idempotency_key).toMatch(/^payload:orders\/paid:[0-9a-f]{64}$/)
    expect(row!.result.error.code).toBe('PAYLOAD_INVALID')
  })

  test('D-B2-13: with precedence [code, link] an order carrying both hints is credited to the code', async () => {
    const [linked, coded] = [
      await distributorOf(acme.id, shop.admin.id, shop.marketId, shop.distributorType),
      await distributorOf(acme.id, shop.admin.id, shop.marketId, shop.distributorType),
    ]
    const payload = shopifyOrder({
      customer: { id: (nextId += 1), tags: '' }, note_attributes: [{ name: 'nmp_ref', value: linked.positionRef }], discount_codes: [{ code: coded.positionRef }],
    })
    await setSettings(acme.id, shop.admin.id, { 'orders.attribution_precedence': ['code', 'link', 'servicing'] })
    await deliver(shopify, 'shopify', 'orders/paid', payload, SECRET)
    await setSettings(acme.id, shop.admin.id, { 'orders.attribution_precedence': ['link', 'code', 'servicing'] })

    expect(await ownerRows('SELECT attribution_source, attributed_position_id FROM sales_order WHERE source_order_id = $1', [String(payload.id)]))
      .toEqual([{ attribution_source: 'code', attributed_position_id: coded.positionId }])
  })

  test('AC-ORD2-4: rotation replaces the secret; a withdrawn connector answers 404', async () => {
    const rotated = await call(app, { method: 'POST', url: `/v1/connectors/${woo}/rotate-secret`, as: shop.admin, body: { webhook_secret: 'woo_rotated_secret_0123456789' } })
    const oldSecret = await deliver(woo, 'woocommerce', 'order.created', { ...fixture('woocommerce-order'), id: (nextId += 1) }, WOO_SECRET)
    const newSecret = await deliver(woo, 'woocommerce', 'order.created', { ...fixture('woocommerce-order'), id: (nextId += 1) }, 'woo_rotated_secret_0123456789')
    const foreign = await call(app, { method: 'POST', url: `/v1/connectors/${woo}/withdraw`, as: globexAdmin, body: { reason: 'x' } })
    const withdrawn = await call(app, { method: 'POST', url: `/v1/connectors/${woo}/withdraw`, as: shop.admin, body: { reason: 'store closed' } })
    const twice = await call(app, { method: 'POST', url: `/v1/connectors/${woo}/withdraw`, as: shop.admin, body: { reason: 'again' } })
    const after = await deliver(woo, 'woocommerce', 'order.created', fixture('woocommerce-order'), 'woo_rotated_secret_0123456789')

    expect(rotated.statusCode).toBe(200)
    expect([oldSecret.statusCode, newSecret.statusCode]).toEqual([401, 200])
    expect(foreign.statusCode).toBe(404)
    expect(withdrawn.json().data).toMatchObject({ state: 'withdrawn' })
    expect(twice.json().error.code).toBe('CONNECTOR_WITHDRAWN')
    expect(after.statusCode).toBe(404)
  })
})

describe('GET /v1/integrations/health (T-B2-35, TS-58 sync-lag view)', () => {
  const health = async (as: TestUser = analyst) => {
    const response = await call(app, { method: 'GET', url: '/v1/integrations/health', as })
    expect(response.statusCode, response.body).toBe(200)
    return response.json().data as { sources: { source: string; state: string }[]; thresholds: unknown }
  }
  const sourceOf = async (source: string) => (await health()).sources.find((row) => row.source === source)
  const processed = (source: string, minutesAgo: number) => ownerRows(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, received_at, processed_at, result, state, created_by, created_by_type)
     VALUES ($1, $2, $3, sha256(convert_to($3::text, 'UTF8')), now() - make_interval(mins => $4), now() - make_interval(mins => $4), '{}',
             'processed', $5, 'service_account')`,
    [acme.id, source, `order:${source}:${nextId += 1}`, minutesAgo, shop.admin.id],
  )

  test('AC-INT2-1: unset thresholds report thresholds_not_set with the lag; failing is still reported', async () => {
    await processed('api:quiet', 5)

    expect(await sourceOf('api:quiet')).toMatchObject({ kind: 'api', name: 'quiet', state: 'thresholds_not_set', errors_24h: 0, held: 0 })
    expect((await sourceOf('api:quiet') as unknown as { lag_seconds: number }).lag_seconds).toBeGreaterThanOrEqual(300)
    expect((await health()).thresholds).toBeNull()
  })

  test('AC-55.1: lag beyond behind_after is behind, beyond failing_after failing; rejections and overdue holds are failing', async () => {
    await setSettings(acme.id, shop.admin.id, { 'integrations.sync_health': { behind_after_minutes: 60, failing_after_minutes: 240 } })
    await processed('api:fresh', 1)
    await processed('api:old', 120)
    await processed('api:stale', 300)
    await processed('api:stuck', 1)
    await ownerRows(
      `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, received_at, state, payload, hold_reason, hold_ref, created_by, created_by_type)
       VALUES ($1, 'api:stuck', 'event:stuck:1', sha256('x'), now() - interval '25 hours', 'held', '{}', 'ORDER_NOT_FOUND', 'o-1', $2, 'service_account')`,
      [acme.id, shop.admin.id],
    )

    expect(await sourceOf('api:fresh')).toMatchObject({ state: 'healthy' })
    expect(await sourceOf('api:old')).toMatchObject({ state: 'behind', last_success_at: expect.any(String) })
    expect(await sourceOf('api:stale')).toMatchObject({ state: 'failing' })
    expect(await sourceOf('api:stuck')).toMatchObject({ state: 'failing', held: 1, held_overdue: 1 })
    expect((await health()).thresholds).toEqual({ behind_after_minutes: 60, failing_after_minutes: 240 })
  })

  test('integration.read or integration.manage; another tenant sees only its own sources', async () => {
    const payout = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })

    expect((await call(app, { method: 'GET', url: '/v1/integrations/health', as: payout })).statusCode).toBe(403)
    expect((await health(shop.admin)).sources.length).toBeGreaterThan(0)
    expect((await health(globexAdmin)).sources).toEqual([])
  })

  test('C-B2-23: a market-scoped holder of integration.read is refused the tenant-wide health (SCOPE_NOT_HELD)', async () => {
    const scoped = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [shop.marketId] })

    const response = await call(app, { method: 'GET', url: '/v1/integrations/health', as: scoped })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('SCOPE_NOT_HELD')
  })
})
