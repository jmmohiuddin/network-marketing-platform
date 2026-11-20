import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { ordModule } from './index.js'
import { asKey, orderBody, ordersTenant, type OrdersTenant } from './test-support.js'

// T-B6-31 (PLAN B6 2.5, D-B6-08): orders list sort with sort-value cursors, CSV export of the list under its filter and sort.

let app: FastifyInstance
let cappedApp: FastifyInstance
let shop: OrdersTenant
let support: TestUser
let planAdmin: TestUser
let globexAdmin: TestUser
let tenantId: string

closePoolsAfterAll()

const AMOUNTS = ['1000', '2000', '2000', '2000', '3000']

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  tenantId = acme.id
  const gb = await createMarket(acme.id, 'GB')
  await createMarket(globex.id, 'GB')
  const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  planAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Plan administrator'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  app = await buildTestApp({ modules: [iamModule, ordModule] })
  cappedApp = await buildTestApp({ modules: [ordModule], env: { EXPORT_ROW_CAP: '4' } })
  shop = await ordersTenant(app, acme.id, gb, admin, approver)
  for (const amount of AMOUNTS) {
    const created = await asKey(app, shop.token, '/v1/orders', orderBody({
      amount_minor: amount, tax_minor: '0', lines: [{ line_no: 1, sku: 'SKU-A', quantity: 1, amount_minor: amount }],
    }))
    expect(created.statusCode, created.body).toBe(201)
  }
})

afterAll(async () => {
  await app.close()
  await cappedApp.close()
})

const get = (url: string, as: TestUser = shop.admin, on = app) => call(on, { method: 'GET', url, as })

type ListRow = { id: string; source_order_id: string; amount_minor: string; amount: string; credited_at: string; buyer: { external_ref: string } }

async function allPages(query: string): Promise<ListRow[]> {
  const rows: ListRow[] = []
  let cursor: string | null = null
  do {
    const response = await get(`/v1/orders?${query}&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`)
    expect(response.statusCode, response.body).toBe(200)
    rows.push(...response.json().data)
    cursor = response.json().meta.next_cursor
  } while (cursor !== null)
  return rows
}

describe('GET /v1/orders sort (AC-RPT2-4)', () => {
  test('amount_desc pages across equal amounts by id; amount_asc and credited_at_asc mirror it', async () => {
    const desc = await allPages('sort=amount_desc')
    const asc = await allPages('sort=amount_asc')
    const byTime = await allPages('sort=credited_at_asc')
    const newest = await allPages('sort=credited_at_desc')

    expect(desc.map((row) => row.amount_minor)).toEqual([...AMOUNTS].reverse())
    expect(new Set(desc.map((row) => row.id)).size).toBe(AMOUNTS.length)
    const ties = desc.filter((row) => row.amount_minor === '2000').map((row) => row.id)
    expect(ties).toEqual([...ties].sort().reverse())
    expect(asc.map((row) => row.id)).toEqual(desc.map((row) => row.id).reverse())
    expect(byTime.map((row) => row.id)).toEqual(newest.map((row) => row.id).reverse())
    expect(byTime.map((row) => Date.parse(row.credited_at))).toEqual([...byTime.map((row) => Date.parse(row.credited_at))].sort((a, b) => a - b))
  })

  test('a cursor of another sort is 422 VALIDATION_FAILED; an unknown sort 400', async () => {
    const first = await get('/v1/orders?sort=amount_desc&limit=1')
    const mixed = await get(`/v1/orders?sort=credited_at_desc&limit=1&cursor=${first.json().meta.next_cursor}`)

    expect([mixed.statusCode, mixed.json().error.code, mixed.json().error.details]).toEqual([422, 'VALIDATION_FAILED', { path: 'cursor' }])
    expect((await get('/v1/orders?sort=rank_desc')).statusCode).toBe(400)
  })
})

describe('GET /v1/orders/export (AC-RPT2-5)', () => {
  test('the list\'s rows in its order as CSV with the chosen columns, no names, no-store, audited with filters and row count', async () => {
    const list = await allPages('sort=amount_desc&purpose=customer')
    const response = await get('/v1/orders/export?sort=amount_desc&purpose=customer&columns=source_order_id,amount,buyer_ref')
    const lines = response.body.trimEnd().split('\r\n')

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(lines[0]).toBe('source_order_id,amount,buyer_ref')
    expect(lines.slice(1).map((line) => line.split(','))).toEqual(list.map((row) => [row.source_order_id, row.amount, row.buyer.external_ref]))
    expect(list.map((row) => row.amount)).toEqual(['30.00', '20.00', '20.00', '20.00', '10.00'])
    const [audit] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'EXPORT.CREATED' ORDER BY seq DESC LIMIT 1`, [tenantId])
    expect(JSON.parse(audit!.after_ref).after).toEqual({
      kind: 'orders', row_count: AMOUNTS.length,
      filters: { sort: 'amount_desc', purpose: 'customer', columns: 'source_order_id,amount,buyer_ref' },
    })
  })

  test('every column by default; a Support agent (order.read) may export; an unknown column is 400', async () => {
    const all = await get('/v1/orders/export', support)

    expect(all.statusCode).toBe(200)
    expect(all.body.split('\r\n')[0]).toBe('source_order_id,ordered_at,credited_at,market,buyer_ref,buyer_type,purpose,attributed_position_ref,'
      + 'amount,tax,currency,period,late,flags')
    expect(all.body.trimEnd().split('\r\n')).toHaveLength(AMOUNTS.length + 1)
    expect((await get('/v1/orders/export?columns=source_order_id,display_name')).statusCode).toBe(400)
    expect((await get('/v1/orders/export?columns=amount,amount')).statusCode).toBe(400)
  })

  test('above the cap: 422 EXPORT_ROW_CAP_EXCEEDED and EXPORT.REFUSED', async () => {
    const refused = await get('/v1/orders/export', shop.admin, cappedApp)
    const [audit] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'EXPORT.REFUSED' ORDER BY seq DESC LIMIT 1`, [tenantId])

    expect([refused.statusCode, refused.json().error.code, refused.json().error.details]).toEqual([
      422, 'EXPORT_ROW_CAP_EXCEEDED', { row_count: AMOUNTS.length, row_cap: 4 },
    ])
    expect(JSON.parse(audit!.after_ref).after).toMatchObject({ kind: 'orders', row_count: AMOUNTS.length, row_cap: 4 })
  })

  test('order.read missing -> 403; another tenant exports only its own (none)', async () => {
    const other = await get('/v1/orders/export', globexAdmin)

    expect((await get('/v1/orders/export', planAdmin)).statusCode).toBe(403)
    expect(other.statusCode).toBe(200)
    expect(other.body.trimEnd().split('\r\n')).toHaveLength(1)
  })
})
