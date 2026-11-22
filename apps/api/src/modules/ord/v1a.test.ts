import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ledModule } from '../led/index.js'
import { ordModule } from './index.js'
import { asRefusal } from './refusal.js'
import { apiKey, approvedRates, asKey, eurMarket, moneySettings, orderBody, ordersTenant, type OrdersTenant } from './test-support.js'

// V1-A orders (PLAN V1-A 2.3): conversion at acceptance (T-V1A-21/22, with the LED approval that releases held orders),
// subscription events (T-V1A-30/31) and dispute outcomes (T-V1A-32).

let app: FastifyInstance
let shop: OrdersTenant
let analyst: TestUser
let finance: TestUser

closePoolsAfterAll()

const CHF_DAY = '2026-11-18T09:00:00.000Z'
const USD_DAY = '2026-11-19T09:00:00.000Z'

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const be = await eurMarket(acme.id)
  const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  finance = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, ordModule, ledModule] })
  shop = await ordersTenant(app, acme.id, be, admin, approver)
  await approvedRates(acme.id, analyst.id, finance.id, [
    { base: 'CHF', quote: 'EUR', rate: '1.0412000000', valid_from: '2026-11-01T00:00:00.000Z' },
    { base: 'USD', quote: 'EUR', rate: '0.9200000000', valid_from: '2026-09-01T00:00:00.000Z' },
  ])
})

afterAll(async () => {
  await app.close()
})

/** An order of market BE (EUR); CHF 120.00 + tax 20.00 ordered and paid on CHF_DAY unless overridden. */
const beOrder = (overrides: Record<string, unknown> = {}) => orderBody({
  market: 'BE', currency: 'CHF', ordered_at: CHF_DAY, paid_at: CHF_DAY, amount_minor: '12000', tax_minor: '2000',
  lines: [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: '12000' }], ...overrides,
})
const postOrder = (body: Record<string, unknown>, token = shop.token) => asKey(app, token, '/v1/orders', body)
const postEvent = (body: Record<string, unknown>, token = shop.token) => asKey(app, token, '/v1/order-events', body)
const event = (overrides: Record<string, unknown>) => ({
  source_system: 'shop', source_event_id: `e-${randomUUID()}`, type: 'refund', occurred_at: new Date().toISOString(),
  refund_minor: '0', fee_minor: '0', ...overrides,
})
const inbound = (key: string) => ownerRows<{ state: string; hold_reason: string | null; hold_ref: string | null }>(
  'SELECT state, hold_reason, hold_ref FROM inbound_event WHERE idempotency_key = $1', [key],
)
const settings = (values: Record<string, unknown>) => moneySettings(shop.tenantId, shop.admin.id, finance.id, values)

describe('conversion at acceptance (FR-FIN-007, D-V1A-04)', () => {
  test('T-V1A-22: no policy, then no rounding mode, refuse an order in another currency; the market currency is never converted', async () => {
    expect((await postOrder(beOrder())).json().error.code).toBe('FX_POLICY_NOT_CONFIGURED')
    await settings({ 'fx.max_rate_age_days': 45 })
    const unrounded = await postOrder(beOrder())
    expect([unrounded.statusCode, unrounded.json().error]).toEqual([422, expect.objectContaining({ code: 'SETTING_NOT_CONFIGURED', details: { key: 'money.rounding_mode' } })])
    await settings({ 'money.rounding_mode': 'half_up' })

    const eur = await postOrder(beOrder({ currency: 'EUR' }))
    expect(eur.statusCode, eur.body).toBe(201)
    expect(eur.json().data.order).toMatchObject({ amount_minor: '12000', currency: 'EUR', original: null, lines: [expect.objectContaining({ original_amount_minor: null })] })
  })

  test('T-V1A-21: CHF 120.00 is stored as EUR 124.94 with the original and the rate; a refund of CHF 60.00 as EUR 62.47', async () => {
    const body = beOrder()
    const created = await postOrder(body)
    expect(created.statusCode, created.body).toBe(201)
    const order = created.json().data.order
    expect(order).toMatchObject({
      amount_minor: '12494', tax_minor: '2082', currency: 'EUR',
      original: { currency: 'CHF', amount_minor: '12000', tax_minor: '2000', rate: '1.0412000000', rate_valid_from: '2026-11-01T00:00:00.000Z' },
      lines: [expect.objectContaining({ amount_minor: '12494', original_amount_minor: '12000' })],
    })
    const [audit] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE action = 'ORDER.INGESTED' AND object_id = $1`, [order.id])
    expect(JSON.parse(audit!.after_ref).after.fx_rate_id).toBe(order.original.rate_id)

    const refund = await postEvent(event({ source_order_id: body.source_order_id, refund_minor: '6000' }))
    expect(refund.statusCode, refund.body).toBe(201)
    expect(refund.json().data.event).toMatchObject({ refund_minor: '6247', fee_minor: '0', original: { refund_minor: '6000', fee_minor: '0', currency: 'CHF' } })
  })

  test('T-V1A-21: the total is the sum of the lines converted one by one (1301.5 + 1301.5 half_up = 2604, not 2603)', async () => {
    const lines = [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: '1250' }, { line_no: 2, sku: 'SKU-B', quantity: 1, amount_minor: '1250' }]
    const created = await postOrder(beOrder({ amount_minor: '2500', tax_minor: '0', lines }))
    expect(created.json().data.order).toMatchObject({ amount_minor: '2604', tax_minor: '0', original: { amount_minor: '2500' } })
  })

  test('T-V1A-22: a stale or missing rate holds the order; approving a fresh batch converts it in the approval transaction', async () => {
    const usd = beOrder({ currency: 'USD', ordered_at: USD_DAY, paid_at: USD_DAY, amount_minor: '5000', tax_minor: '0', lines: [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: '5000' }] })
    const gbp = beOrder({ currency: 'GBP' })
    const stale = await postOrder(usd)
    const missing = await postOrder(gbp)
    expect([stale.statusCode, stale.json().data.held.reason]).toEqual([202, 'FX_RATE_STALE'])
    expect([missing.statusCode, missing.json().data.held.reason]).toEqual([202, 'FX_RATE_MISSING'])
    expect(await inbound(`order:shop:${String(usd.source_order_id)}`)).toEqual([{ state: 'held', hold_reason: 'FX_RATE_STALE', hold_ref: 'USD:EUR' }])
    expect(await inbound(`order:shop:${String(gbp.source_order_id)}`)).toEqual([{ state: 'held', hold_reason: 'FX_RATE_MISSING', hold_ref: 'GBP:EUR' }])

    const proposed = await call(app, {
      method: 'POST', url: '/v1/fx-rate-batches', as: analyst, idempotencyKey: true,
      body: { source: 'Treasury sheet 2026-11-15', rows: [{ base: 'USD', quote: 'EUR', rate: '0.9300000000', valid_from: '2026-11-15T00:00:00.000Z' }] },
    })
    expect(proposed.statusCode, proposed.body).toBe(201)
    const decided = await call(app, {
      method: 'POST', url: `/v1/fx-rate-batches/${proposed.json().data.id}/decision`, as: finance, idempotencyKey: true, body: { decision: 'approve' },
    })
    expect(decided.statusCode, decided.body).toBe(200)
    expect(decided.json().data).toMatchObject({ state: 'approved', released_orders: 1 })
    expect(await inbound(`order:shop:${String(usd.source_order_id)}`)).toEqual([{ state: 'processed', hold_reason: 'FX_RATE_STALE', hold_ref: 'USD:EUR' }])
    const [converted] = await ownerRows<{ amount_minor: string; original_amount_minor: string }>(
      'SELECT amount_minor::text, original_amount_minor::text FROM sales_order WHERE source_order_id = $1', [usd.source_order_id])
    expect(converted).toEqual({ amount_minor: '4650', original_amount_minor: '5000' }) // USD 50.00 -> EUR 46.50
    expect((await inbound(`order:shop:${String(gbp.source_order_id)}`))[0]!.state).toBe('held')
  })
})

describe('subscription events (FR-ORD-006, D-V1A-05)', () => {
  const subscriptionOrder = (ref: string, day: string) => beOrder({
    currency: 'EUR', subscription_ref: ref, ordered_at: day, paid_at: day,
  })

  test('T-V1A-30: renewals credit volume; renewal_failed and subscription_cancelled attach to the latest order with no effect', async () => {
    const ref = `sub-${randomUUID()}`
    const first = await postOrder(subscriptionOrder(ref, '2026-11-10T09:00:00.000Z'))
    const latest = await postOrder(subscriptionOrder(ref, '2026-11-12T09:00:00.000Z'))
    expect(first.json().data.order).toMatchObject({ subscription_ref: ref, volumes: { qv: '150', bv: '7' } })
    expect(latest.statusCode).toBe(201)

    for (const type of ['renewal_failed', 'subscription_cancelled']) {
      const recorded = await postEvent(event({ type, subscription_ref: ref }))
      expect(recorded.statusCode, recorded.body).toBe(201)
      expect(recorded.json().data).toMatchObject({
        late: false, event: { type, order_id: latest.json().data.order.id, lines: [], refund_minor: '0', fee_minor: '0', volume_effect: {}, original: null },
      })
      const amount = await postEvent(event({ type, subscription_ref: ref, refund_minor: '100' }))
      expect([amount.statusCode, amount.json().error.code, amount.json().error.details]).toEqual([422, 'VALIDATION_FAILED', { field: 'refund_minor' }])
      const lines = await postEvent(event({ type, subscription_ref: ref, lines: [{ line_no: 1, quantity: 1 }] }))
      expect([lines.statusCode, lines.json().error.details]).toEqual([422, { field: 'lines' }])
    }
    const byOrder = await postEvent(event({ type: 'renewal_failed', source_order_id: first.json().data.order.source_order_id }))
    expect(byOrder.json().data.event.order_id).toBe(first.json().data.order.id)
    expect((await postEvent(event({ type: 'refund', subscription_ref: ref }))).json().error.code).toBe('VALIDATION_FAILED')
    expect((await postEvent(event({ type: 'renewal_failed', subscription_ref: ref, source_order_id: 'x' }))).statusCode).toBe(400)
    expect((await postEvent(event({ type: 'renewal_failed' }))).statusCode).toBe(400)
  })

  test('T-V1A-31: an unknown subscription is held SUBSCRIPTION_NOT_FOUND and released by an order carrying it', async () => {
    const ref = `sub-${randomUUID()}`
    const cancelled = event({ type: 'subscription_cancelled', subscription_ref: ref })
    const held = await postEvent(cancelled)
    expect([held.statusCode, held.json().data.held.reason]).toEqual([202, 'SUBSCRIPTION_NOT_FOUND'])
    expect(await inbound(`event:shop:${String(cancelled.source_event_id)}`)).toEqual([{ state: 'held', hold_reason: 'SUBSCRIPTION_NOT_FOUND', hold_ref: ref }])

    const order = await postOrder(subscriptionOrder(ref, '2026-11-11T09:00:00.000Z'))
    expect(order.statusCode, order.body).toBe(201)
    expect((await inbound(`event:shop:${String(cancelled.source_event_id)}`))[0]!.state).toBe('processed')
    const [attached] = await ownerRows<{ order_id: string }>('SELECT order_id FROM order_event WHERE source_event_id = $1', [cancelled.source_event_id])
    expect(attached!.order_id).toBe(order.json().data.order.id)
  })

  test('GET /v1/orders?q= matches a subscription reference or an order id exactly', async () => {
    const ref = `sub-${randomUUID()}`
    const order = await postOrder(subscriptionOrder(ref, '2026-11-13T09:00:00.000Z'))
    const list = (q: string) => call(app, { method: 'GET', url: `/v1/orders?q=${encodeURIComponent(q)}`, as: shop.admin })
    expect((await list(ref)).json().data.map((row: { id: string }) => row.id)).toEqual([order.json().data.order.id])
    expect((await list(order.json().data.order.source_order_id)).json().data).toHaveLength(1)
    expect((await list(ref.slice(0, 8))).json().data).toEqual([])
  })
})

describe('dispute outcomes (BR-REV-06, T-V1A-32)', () => {
  async function chargedBack(): Promise<{ order: string; chargeback: string; chargebackId: string }> {
    const body = beOrder({ currency: 'EUR' })
    expect((await postOrder(body)).statusCode).toBe(201)
    const chargeback = event({ type: 'chargeback', source_order_id: body.source_order_id, refund_minor: '12000' })
    const recorded = await postEvent(chargeback)
    expect(recorded.json().data.event.volume_effect.total).toEqual({ qv: '-150', bv: '-7' }) // TS-65 unchanged
    return { order: body.source_order_id as string, chargeback: chargeback.source_event_id, chargebackId: recorded.json().data.event.id as string }
  }

  test('dispute_lost closes the chargeback with no effect; a later reversal or second outcome is DISPUTE_CLOSED', async () => {
    const { order, chargeback, chargebackId } = await chargedBack()
    const lost = await postEvent(event({ type: 'dispute_lost', source_order_id: order, disputes_source_event_id: chargeback }))
    expect(lost.statusCode, lost.body).toBe(201)
    // SC-31: the event view names the chargeback it closes (the inspector shows its date).
    expect(lost.json().data.event).toMatchObject({ type: 'dispute_lost', lines: [], volume_effect: {}, dispute_of_event_id: chargebackId })

    const reversal = await postEvent(event({ type: 'chargeback_reversed', source_order_id: order, reverses_source_event_id: chargeback, refund_minor: '12000' }))
    expect([reversal.statusCode, reversal.json().error.code]).toEqual([422, 'DISPUTE_CLOSED'])
    expect((await postEvent(event({ type: 'dispute_lost', source_order_id: order, disputes_source_event_id: chargeback }))).json().error.code).toBe('DISPUTE_CLOSED')
  })

  test('dispute_lost after a reversal is DISPUTE_CLOSED; an unknown chargeback is EVENT_NOT_FOUND; the unique outcome maps to DISPUTE_CLOSED', async () => {
    const { order, chargeback } = await chargedBack()
    const won = await postEvent(event({ type: 'chargeback_reversed', source_order_id: order, reverses_source_event_id: chargeback, refund_minor: '12000' }))
    expect(won.statusCode, won.body).toBe(201)
    expect((await postEvent(event({ type: 'dispute_lost', source_order_id: order, disputes_source_event_id: chargeback }))).json().error.code).toBe('DISPUTE_CLOSED')
    expect((await postEvent(event({ type: 'chargeback_reversed', source_order_id: order, reverses_source_event_id: chargeback, refund_minor: '1' }))).json().error.code)
      .toBe('CHARGEBACK_ALREADY_REVERSED')
    expect((await postEvent(event({ type: 'dispute_lost', source_order_id: order, disputes_source_event_id: 'none' }))).json().error.code).toBe('EVENT_NOT_FOUND')
    expect((await postEvent(event({ type: 'dispute_lost', source_order_id: order }))).statusCode).toBe(400)
    expect(asRefusal({ code: '23505', table: 'order_event', constraint: 'order_event_dispute_outcome' })?.code).toBe('DISPUTE_CLOSED')
  })

  test('AC-ORD6-4: a key without orders:write is refused for the new types and nothing is stored', async () => {
    const other = await apiKey(app, shop.admin, ['compliance:read'])
    const lost = event({ type: 'subscription_cancelled', subscription_ref: 'sub-x' })
    expect((await postEvent(lost, other)).statusCode).toBe(403)
    expect(await inbound(`event:shop:${String(lost.source_event_id)}`)).toEqual([])
  })
})
