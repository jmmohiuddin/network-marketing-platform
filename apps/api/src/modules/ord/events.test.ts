import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ordModule } from './index.js'
import { asRefusal } from './refusal.js'
import { asKey, committedPeriod, orderBody, ordersTenant, setSettings, type OrdersTenant } from './test-support.js'

let app: FastifyInstance
let shop: OrdersTenant

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  app = await buildTestApp({ modules: [iamModule, ordModule] })
  shop = await ordersTenant(app, acme.id, gb, admin, approver)
  await committedPeriod(acme.id, gb, '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')
})

afterAll(async () => {
  await app.close()
})

/** An ingested order: line 1 = 2 × SKU-A {qv 150, bv 7}, line 2 = 1 × SKU-B {qv 100}. */
async function order(overrides: Record<string, unknown> = {}): Promise<{ id: string; source_order_id: string }> {
  const response = await asKey(app, shop.token, '/v1/orders', orderBody(overrides))
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data.order
}

const eventBody = (sourceOrderId: string, overrides: Record<string, unknown> = {}) => ({
  source_system: 'shop', source_event_id: `e-${randomUUID()}`, source_order_id: sourceOrderId, type: 'return',
  occurred_at: new Date().toISOString(), refund_minor: '0', fee_minor: '0', ...overrides,
})
const post = (body: Record<string, unknown>) => asKey(app, shop.token, '/v1/order-events', body)

async function effect(body: Record<string, unknown>): Promise<unknown> {
  const response = await post(body)
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data.event.volume_effect
}

describe('POST /v1/order-events (API-11)', () => {
  test('TS-47 / AC-45.1: returning one of two lines reverses only that line\'s volume', async () => {
    const { source_order_id: ref } = await order()

    expect(await effect(eventBody(ref, { lines: [{ line_no: 1, quantity: 1 }], refund_minor: '1000' })))
      .toEqual({ lines: [{ line_no: 1, volumes: { qv: '-150', bv: '-7' } }], total: { bv: '-7', qv: '-150' } })
  })

  test('TS-47 / AC-45.2: an equal-value exchange has no volume effect; an unequal one reverses its lines', async () => {
    const { source_order_id: ref } = await order()

    expect(await effect(eventBody(ref, { type: 'exchange', equal_value: true, lines: [{ line_no: 2, quantity: 1 }] }))).toEqual({})
    expect(await effect(eventBody(ref, { type: 'exchange', lines: [{ line_no: 2, quantity: 1 }] })))
      .toEqual({ lines: [{ line_no: 2, volumes: { qv: '-100' } }], total: { qv: '-100' } })
  })

  test('E-ORD-09: returning more than purchased is 422 RETURN_EXCEEDS_PURCHASED, persisted', async () => {
    const { source_order_id: ref } = await order()
    await effect(eventBody(ref, { lines: [{ line_no: 1, quantity: 1 }] }))
    const over = eventBody(ref, { lines: [{ line_no: 1, quantity: 2 }] })

    const response = await post(over)

    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatchObject({ code: 'RETURN_EXCEEDS_PURCHASED', details: { line_no: 1 } })
    expect(await ownerRows(`SELECT state FROM inbound_event WHERE idempotency_key = $1`, [`event:shop:${over.source_event_id}`])).toEqual([{ state: 'rejected' }])
  })

  test('TS-65: a restocking fee needs the setting; none reverses fully, proportional scales half-up', async () => {
    const { source_order_id: ref } = await order()
    const withFee = (lines: unknown) => eventBody(ref, { lines, refund_minor: '750', fee_minor: '250' })

    const unset = await post(withFee([{ line_no: 1, quantity: 1 }]))
    await setSettings(shop.tenantId, shop.admin.id, { 'orders.restocking_fee_volume_effect': 'none' })
    const none = await effect(withFee([{ line_no: 2, quantity: 1 }]))
    await setSettings(shop.tenantId, shop.admin.id, { 'orders.restocking_fee_volume_effect': 'proportional' })
    const proportional = await effect(withFee([{ line_no: 1, quantity: 2 }]))
    const second = await order()
    const noFee = await effect(eventBody(second.source_order_id, { lines: [{ line_no: 1, quantity: 2 }], refund_minor: '0', fee_minor: '0' }))
    await setSettings(shop.tenantId, shop.admin.id, { 'orders.restocking_fee_volume_effect': null })

    expect(unset.json().error.code).toBe('RESTOCKING_FEE_EFFECT_NOT_CONFIGURED')
    expect(none).toEqual({ lines: [{ line_no: 2, volumes: { qv: '-100' } }], total: { qv: '-100' } })
    expect(proportional).toEqual({ lines: [{ line_no: 1, volumes: { qv: '-225', bv: '-11' } }], total: { bv: '-11', qv: '-225' } })
    expect(noFee).toEqual({ lines: [{ line_no: 1, volumes: { qv: '-300', bv: '-14' } }], total: { bv: '-14', qv: '-300' } })
  })

  test('D-B2-17: a proportional chargeback is re-credited exactly; fee rounding is half-up per line (C-B2-22)', async () => {
    await setSettings(shop.tenantId, shop.admin.id, { 'orders.restocking_fee_volume_effect': 'proportional' })
    const { source_order_id: ref } = await order()
    const chargeback = eventBody(ref, { type: 'chargeback', refund_minor: '1000', fee_minor: '1000' })
    const charged = await effect(chargeback)
    const reversed = await effect(eventBody(ref, { type: 'chargeback_reversed', reverses_source_event_id: chargeback.source_event_id, refund_minor: '1000' }))
    const twoLines = await order({ amount_minor: '2000', lines: [1, 2].map((lineNo) => ({ line_no: lineNo, sku: 'SKU-A', quantity: 1, amount_minor: '1000' })) })
    const rounded = await effect(eventBody(twoLines.source_order_id, {
      type: 'refund', lines: [{ line_no: 1, quantity: 1 }, { line_no: 2, quantity: 1 }], refund_minor: '1', fee_minor: '1',
    }))
    await setSettings(shop.tenantId, shop.admin.id, { 'orders.restocking_fee_volume_effect': null })

    expect(charged).toEqual({ lines: [{ line_no: 1, volumes: { qv: '-150', bv: '-7' } }, { line_no: 2, volumes: { qv: '-50' } }], total: { bv: '-7', qv: '-200' } })
    expect(reversed).toEqual({ lines: [{ line_no: 1, volumes: { qv: '150', bv: '7' } }, { line_no: 2, volumes: { qv: '50' } }], total: { bv: '7', qv: '200' } })
    expect(rounded).toEqual({
      lines: [{ line_no: 1, volumes: { qv: '-75', bv: '-4' } }, { line_no: 2, volumes: { qv: '-75', bv: '-4' } }], total: { bv: '-8', qv: '-150' },
    })
  })

  test('E-ORD-01: a refund arriving while its order is being ingested waits for it and is applied, never left held', async () => {
    const body = orderBody()
    const refund = eventBody(String(body.source_order_id), { type: 'refund', lines: [{ line_no: 2, quantity: 1 }], refund_minor: '1000' })
    const waiting = async (count: number) => {
      const [row] = await ownerRows<{ n: number }>(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)
      if (row!.n < count) await sleep(20).then(() => waiting(count))
    }
    // Holding the tenant's audit chain lock stops the order transaction just before it commits.
    const side = await getOwnerPool().connect()
    await side.query('BEGIN')
    await side.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit.audit_event:' || $1, 0))`, [shop.tenantId])

    const ordered = asKey(app, shop.token, '/v1/orders', body)
    await waiting(1)
    const refunded = post(refund)
    await waiting(2)
    await side.query('COMMIT')
    side.release()

    expect((await ordered).statusCode).toBe(201)
    expect((await refunded).statusCode).toBe(201)
    expect(await ownerRows(`SELECT state FROM inbound_event WHERE idempotency_key = $1`, [`event:shop:${refund.source_event_id}`])).toEqual([{ state: 'processed' }])
  })

  test('E-ORD-01 / T-B2-30: a refund before its order is held, then applied when the order arrives', async () => {
    const body = orderBody()
    const refund = eventBody(String(body.source_order_id), { type: 'refund', lines: [{ line_no: 2, quantity: 1 }], refund_minor: '1000' })

    const held = await post(refund)
    const arrived = await asKey(app, shop.token, '/v1/orders', body)

    expect(held.statusCode).toBe(202)
    expect(held.json().data.held).toEqual({ inbound_event_id: expect.any(String), reason: 'ORDER_NOT_FOUND' })
    expect(arrived.statusCode).toBe(201)
    expect(await ownerRows(`SELECT state, payload FROM inbound_event WHERE idempotency_key = $1`, [`event:shop:${refund.source_event_id}`]))
      .toEqual([{ state: 'processed', payload: null }])
    expect(await ownerRows('SELECT type, volume_effect FROM order_event WHERE order_id = $1', [arrived.json().data.order.id]))
      .toEqual([{ type: 'refund', volume_effect: { lines: [{ line_no: 2, volumes: { qv: '-100' } }], total: { qv: '-100' } } }])
    expect((await post(refund)).statusCode).toBe(200) // replay of the processed event
  })

  test('T-B2-29: money-only refunds, cancellations, chargebacks and their reversals', async () => {
    const { source_order_id: ref } = await order()

    expect(await effect(eventBody(ref, { type: 'refund', refund_minor: '500' }))).toEqual({})
    const chargeback = eventBody(ref, { type: 'chargeback', refund_minor: '3000' })
    expect(await effect(chargeback)).toEqual({
      lines: [{ line_no: 1, volumes: { qv: '-300', bv: '-14' } }, { line_no: 2, volumes: { qv: '-100' } }], total: { bv: '-14', qv: '-400' },
    })
    expect((await post(eventBody(ref, { type: 'cancelled' }))).json().data.event.volume_effect).toEqual({})
    expect(await effect(eventBody(ref, { type: 'chargeback_reversed', reverses_source_event_id: chargeback.source_event_id, refund_minor: '3000' })))
      .toEqual({ lines: [{ line_no: 1, volumes: { qv: '300', bv: '14' } }, { line_no: 2, volumes: { qv: '100' } }], total: { bv: '14', qv: '400' } })
    const cancelled = await post(eventBody(ref, { type: 'cancelled' }))
    expect(cancelled.json().data.event.lines).toEqual([{ line_no: 1, quantity: 2 }, { line_no: 2, quantity: 1 }])
  })

  test('T-B2-29 refusals and conflicts', async () => {
    const { source_order_id: ref } = await order()
    const refused = async (overrides: Record<string, unknown>) => (await post(eventBody(ref, overrides))).json().error.code

    expect(await refused({ type: 'renewal_failed' })).toBe('EVENT_TYPE_NOT_SUPPORTED')
    expect(await refused({ type: 'return' })).toBe('LINES_REQUIRED')
    expect(await refused({ lines: [{ line_no: 9, quantity: 1 }] })).toBe('LINE_UNKNOWN')
    expect(await refused({ type: 'chargeback_reversed', reverses_source_event_id: 'none' })).toBe('EVENT_NOT_FOUND')
    expect(await refused({ type: 'refund', equal_value: true })).toBe('VALIDATION_FAILED')
    const body = eventBody(ref, { lines: [{ line_no: 1, quantity: 1 }] })
    expect((await post(body)).statusCode).toBe(201)
    const conflict = await post({ ...body, refund_minor: '1' })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.code).toBe('EVENT_CONFLICT')
  })

  test('C-B2-21: a chargeback is reversed once (422 CHARGEBACK_ALREADY_REVERSED, persisted), also after a later chargeback', async () => {
    const { source_order_id: ref } = await order()
    const first = eventBody(ref, { type: 'chargeback', refund_minor: '3000' })
    await effect(first)
    await effect(eventBody(ref, { type: 'chargeback_reversed', reverses_source_event_id: first.source_event_id, refund_minor: '3000' }))
    await effect(eventBody(ref, { type: 'chargeback', refund_minor: '3000' }))
    const again = eventBody(ref, { type: 'chargeback_reversed', reverses_source_event_id: first.source_event_id, refund_minor: '3000' })

    const response = await post(again)

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('CHARGEBACK_ALREADY_REVERSED')
    expect(await ownerRows(`SELECT state FROM inbound_event WHERE idempotency_key = $1`, [`event:shop:${again.source_event_id}`])).toEqual([{ state: 'rejected' }])
  })

  test('C-B2-21: API callers cannot write into a store connector namespace', async () => {
    const { source_order_id: ref } = await order()

    const response = await post(eventBody(ref, { source_system: 'shopify:00000000-0000-4000-8000-000000000000', type: 'refund' }))

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_FAILED')
  })

  test('a unique violation on an order or event is a conflict refusal, anything else is not a refusal', () => {
    expect(asRefusal({ code: '23505', table: 'order_event' })).toMatchObject({ status: 409, code: 'EVENT_CONFLICT' })
    expect(asRefusal({ code: '23505', table: 'sales_order' })).toMatchObject({ status: 409, code: 'ORDER_CONFLICT' })
    expect(asRefusal({ code: '23505', table: 'participant' })).toBeNull()
  })

  test('an event of an order credited in a committed period is late (original period), the period untouched', async () => {
    const at = '2025-01-20T12:00:00Z'
    const { source_order_id: ref } = await order({ ordered_at: at, paid_at: at })

    const response = await post(eventBody(ref, { lines: [{ line_no: 2, quantity: 1 }], refund_minor: '1000' }))

    expect(response.json().data).toMatchObject({ late: true, event: { late: true } })
    const [late] = await ownerRows<{ effect_estimate: unknown }>('SELECT effect_estimate FROM late_transaction WHERE order_event_id = $1', [response.json().data.event.id])
    expect(late!.effect_estimate).toEqual({ volumes: { qv: '-100' }, amount_minor: '-1000', attributed_position_id: null })
  })
})
