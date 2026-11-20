import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { ledModule } from '../led/index.js'
import { percentHalfUp } from './dashboards.js'
import { COMPLIANCE_DEFINITIONS, EXECUTIVE_DEFINITIONS, FINANCE_DEFINITIONS } from './definitions.js'
import { rptModule } from './index.js'
import {
  calendar, caseFile, committedRun, instruction, order, orderEvent, ownerReplica, payoutBatch, period, posting, snapshot, warnedVersion,
} from './test-support.js'

// T-B6-20..23 (FR-RPT-001, D-B6-07): executive, finance and compliance dashboards from committed data, scope per market,
// definitions for every figure and no projection, target or ranking field.

let app: FastifyInstance
let tenantId: string
let gb: string
let ie: string
let fr: string
let foreignMarket: string
const p: Record<'jan' | 'feb' | 'mar' | 'ieJan', string> = { jan: '', feb: '', mar: '', ieJan: '' }
let newerSnapshot: string
let exec: TestUser
let execGb: TestUser
let analyst: TestUser
let finance: TestUser
let compliance: TestUser
let complianceGb: TestUser
let portal: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  const other = (await createTenant()).id
  ;[gb, ie, fr, foreignMarket] = await Promise.all([createMarket(tenantId, 'GB'), createMarket(tenantId, 'IE'), createMarket(tenantId, 'FR'), createMarket(other, 'GB')])
  const gbCalendar = await calendar(tenantId, gb, 'GB monthly')
  await calendar(tenantId, gb, 'Zz weekly fixture')
  p.jan = await period(tenantId, gbCalendar, '2026-01', 'committed')
  p.feb = await period(tenantId, gbCalendar, '2026-02', 'paid')
  p.mar = await period(tenantId, gbCalendar, '2026-03', 'open')
  p.ieJan = await period(tenantId, await calendar(tenantId, ie, 'IE monthly'), '2026-01', 'committed')
  await period(tenantId, await calendar(tenantId, fr, 'FR monthly'), '2026-01', 'open')
  await committedRun(tenantId, p.jan, '333', ['333'])
  await committedRun(tenantId, p.feb, '700', ['400', '300', '0'])
  await committedRun(tenantId, p.ieJan, '0', [])

  const a = await order(tenantId, gb, '2026-02-10T10:00:00Z', 10_000)
  const b = await order(tenantId, gb, '2026-01-15T10:00:00Z', 5_000)
  await order(tenantId, gb, '2026-03-01T00:00:00Z', 7) // March starts at midnight London (GMT): outside February
  await order(tenantId, ie, '2026-02-10T10:00:00Z', 9_999)
  await orderEvent(tenantId, b, 'refund', '2026-02-05T10:00:00Z', 2_000) // a refund of an earlier order, occurring in February
  await orderEvent(tenantId, a, 'return', '2026-02-11T10:00:00Z', 1_000)
  await orderEvent(tenantId, a, 'chargeback', '2026-02-12T10:00:00Z', 500)
  await orderEvent(tenantId, a, 'chargeback_reversed', '2026-02-13T10:00:00Z', 500)
  await orderEvent(tenantId, a, 'exchange', '2026-02-14T10:00:00Z', 300) // an unequal exchange returns money too
  await orderEvent(tenantId, a, 'cancelled', '2026-02-15T10:00:00Z', 200)

  await snapshot(tenantId, gb, { from: '2026-01-01', to: '2026-03-01' }, 'ready', { month: '2026-02-01', value: '50.00' })
  newerSnapshot = await snapshot(tenantId, gb, { from: '2026-01-01', to: '2026-03-01' }, 'ready', { month: '2026-02-01', value: '62.50' })
  await snapshot(tenantId, gb, { from: '2026-01-01', to: '2026-03-01' }, 'failed', null)

  ;[exec, execGb, analyst, finance, compliance, complianceGb] = await Promise.all([
    createSignedInUser({ tenantId, roles: ['Executive read-only'] }), createSignedInUser({ tenantId, roles: ['Executive read-only'], marketIds: [gb] }),
    createSignedInUser({ tenantId, roles: ['Commission analyst'] }), createSignedInUser({ tenantId, roles: ['Finance approver'] }),
    createSignedInUser({ tenantId, roles: ['Compliance officer'] }), createSignedInUser({ tenantId, roles: ['Compliance officer'], marketIds: [gb] }),
  ])
  const [participant] = await ownerReplica<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
     VALUES ($1, 'P-PORTAL', 'individual', $2, now(), gen_random_uuid(), 'system') RETURNING id`, [tenantId, gb])
  portal = await createPortalUser({ tenantId, participantId: participant!.id })
  app = await buildTestApp({ modules: [rptModule, ledModule] })
})

afterAll(async () => {
  await app.close()
})

const get = (url: string, as: TestUser) => call(app, { method: 'GET', url, as })
const FORBIDDEN_FIELDS = /projection|potential|estimate|target|rank|leader/i
const keysOf = (value: unknown): string[] => (typeof value !== 'object' || value === null ? []
  : [...(Array.isArray(value) ? [] : Object.keys(value)), ...Object.values(value).flatMap(keysOf)])

describe('percentHalfUp', () => {
  test('integer half-up to 2 decimals; null when the whole is not positive', () => {
    expect([percentHalfUp(1n, 3n), percentHalfUp(1n, 8n), percentHalfUp(1n, 16_000n), percentHalfUp(1n, 80_000n), percentHalfUp(2n, 3n)])
      .toEqual(['33.33', '12.50', '0.01', '0.00', '66.67'])
    expect([percentHalfUp(-1n, 8n), percentHalfUp(5n, 0n), percentHalfUp(5n, -1n)]).toEqual(['-12.50', null, null])
  })
})

describe('executive (T-B6-20)', () => {
  test('AC-56.1 / AC-RPT1-1: the latest finished period per market: net sales, the committed gross, share, earners, R1 retail share', async () => {
    const response = await get('/v1/dashboards/executive', exec)
    const { rows, trend } = response.json().data

    expect(response.statusCode, response.body).toBe(200)
    expect(trend).toBeUndefined()
    expect(rows.map((row: { market: { code: string } }) => row.market.code)).toEqual(['GB', 'IE'])
    expect(rows[0]).toMatchObject({
      market: { id: gb, code: 'GB', currency: 'GBP', minor_unit: 2 }, period: { id: p.feb, state: 'paid' }, net_sales_minor: '6500',
      payout_minor: '700', payout_share_pct: '10.77', active_earners: 2, retail_share_pct: '62.50', retail_share_reason: null,
      retail_snapshot_id: newerSnapshot, partial: false, partial_reasons: [],
    })
    expect(rows[1]).toMatchObject({
      period: { id: p.ieJan }, net_sales_minor: '0', payout_minor: '0', payout_share_pct: null, active_earners: 0,
      retail_share_pct: null, retail_share_reason: 'no_snapshot', retail_snapshot_id: null,
    })
  })

  test('one market: the trend of its finished periods oldest first; a selected period; a figure-less snapshot month', async () => {
    const market = (await get(`/v1/dashboards/executive?market_id=${gb}`, exec)).json().data
    const january = (await get(`/v1/dashboards/executive?period_id=${p.jan}`, exec)).json().data

    expect(market.trend).toEqual([
      { period: { id: p.jan, starts_at: expect.any(String), ends_at: expect.any(String) }, net_sales_minor: '5000', payout_minor: '333',
        payout_share_pct: '6.66', active_earners: 1 },
      { period: { id: p.feb, starts_at: expect.any(String), ends_at: expect.any(String) }, net_sales_minor: '6500', payout_minor: '700',
        payout_share_pct: '10.77', active_earners: 2 },
    ])
    expect(january.rows).toHaveLength(1)
    expect(january.rows[0]).toMatchObject({ period: { id: p.jan }, retail_share_pct: null, retail_share_reason: 'no_value', retail_snapshot_id: newerSnapshot })
    expect(january.trend.map((t: { period: { id: string } }) => t.period.id)).toEqual([p.jan])
  })

  test('AC-RPT1-2: a market without a finished period has no row; sync failing marks the market partial with the source', async () => {
    const france = await get(`/v1/dashboards/executive?market_id=${fr}`, exec)
    await ownerReplica(
      `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
       VALUES ($1, 'api:shop', $2, sha256('x'), now(), 'rejected', gen_random_uuid(), 'system')`, [tenantId, randomUUID()])
    const partial = (await get(`/v1/dashboards/executive?market_id=${gb}`, exec)).json().data.rows[0]
    await ownerReplica(`DELETE FROM inbound_event WHERE tenant_id = $1`, [tenantId])

    expect([france.statusCode, france.json().data.rows]).toEqual([200, []])
    expect(partial).toMatchObject({ partial: true, partial_reasons: [{ source: 'api:shop', name: 'shop', state: 'failing' }] })
  })

  test('AC-RPT1-5: market scope, unknown or unfinished selections 404, dashboard.exec required, portal denied', async () => {
    const scoped = (await get('/v1/dashboards/executive', execGb)).json().data.rows

    expect(scoped.map((row: { market: { id: string } }) => row.market.id)).toEqual([gb])
    for (const url of [`?market_id=${ie}`, `?period_id=${p.ieJan}`]) expect((await get(`/v1/dashboards/executive${url}`, execGb)).statusCode).toBe(404)
    for (const url of [`?market_id=${foreignMarket}`, `?period_id=${p.mar}`, `?period_id=${randomUUID()}`, `?market_id=${gb}&period_id=${p.ieJan}`]) {
      expect((await get(`/v1/dashboards/executive${url}`, exec)).statusCode).toBe(404)
    }
    expect((await get('/v1/dashboards/executive', analyst)).json().error.code).toBe('PERMISSION_DENIED')
    expect((await get('/v1/dashboards/executive', portal)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await app.inject({ method: 'GET', url: '/v1/dashboards/executive' })).statusCode).toBe(401)
  })
})

describe('finance (T-B6-21)', () => {
  beforeAll(async () => {
    for (const [type, debit, credit] of [
      ['payee_payable', 0, 1_000], ['payee_payable', 200, 0], ['payout_in_transit', 0, 300], ['clawback_receivable', 150, 0],
      ['withholding_payable', 0, 50], ['commission_expense', 1_300, 0],
    ] as const) await posting(tenantId, gb, type, debit, credit)
    const batch = await payoutBatch(tenantId, gb)
    const replaced = await instruction(tenantId, batch, 'failed', 900)
    await instruction(tenantId, batch, 'settled', 900, replaced)
    await instruction(tenantId, batch, 'failed', 700)
    await instruction(tenantId, batch, 'returned', 100)
    await instruction(tenantId, await payoutBatch(tenantId, ie), 'failed', 55)
  })

  test('AC-RPT1-3: balances equal GET /v1/ledger/summary by type; a failed payout replaced by a retry is not counted', async () => {
    const response = await get(`/v1/dashboards/finance?market_id=${gb}`, finance)
    const summary = (await get(`/v1/ledger/summary?market_id=${gb}`, finance)).json().data
    const balance = (type: string) => summary.by_type.find((row: { type: string }) => row.type === type).balance_minor

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      market: { id: gb, code: 'GB', currency: 'GBP', minor_unit: 2 }, payables_minor: '800', in_transit_minor: '300', receivables_minor: '150',
      withholding_minor: '50', failed_payouts: { count: 1, amount_minor: '700' },
    })
    expect(['payee_payable', 'payout_in_transit', 'clawback_receivable', 'withholding_payable'].map(balance)).toEqual(['800', '300', '150', '50'])
  })

  test('market required, in the ledger.read scope; another tenant\'s market 404; ledger.read required', async () => {
    expect((await get('/v1/dashboards/finance', finance)).statusCode).toBe(400)
    expect((await get(`/v1/dashboards/finance?market_id=${foreignMarket}`, finance)).statusCode).toBe(404)
    expect((await get(`/v1/dashboards/finance?market_id=${gb}`, exec)).json().error.code).toBe('PERMISSION_DENIED')
    expect((await get(`/v1/dashboards/finance?market_id=${ie}`, finance)).json().data.failed_payouts).toEqual({ count: 1, amount_minor: '55' })
  })
})

describe('compliance (T-B6-22)', () => {
  beforeAll(async () => {
    await warnedVersion(tenantId, gb, 'approved')
    await warnedVersion(tenantId, gb, 'retired')
    await warnedVersion(tenantId, ie, 'active')
    await warnedVersion(tenantId, [gb, ie], 'active') // D-B3-23: seen only by readers of both markets
    await caseFile(tenantId, gb, 'adjustment', 'open')
    await caseFile(tenantId, gb, 'dispute', 'submitted', '2026-01-01T00:00:00Z')
    await caseFile(tenantId, gb, 'dispute', 'submitted', '2999-01-01T00:00:00Z')
    await caseFile(tenantId, ie, 'adjustment', 'open')
    await caseFile(tenantId, null, 'privacy', 'open')
  })

  test('outstanding guardrail decisions of non-retired versions, open cases by type and overdue cases, per market scope', async () => {
    const all = (await get('/v1/dashboards/compliance', compliance)).json().data
    const gbOnly = (await get(`/v1/dashboards/compliance?market_id=${gb}`, compliance)).json().data
    const scoped = (await get('/v1/dashboards/compliance', complianceGb)).json().data

    expect(all).toEqual({
      guardrail_warnings: 3, open_cases: [{ type: 'adjustment', count: 2 }, { type: 'dispute', count: 2 }, { type: 'privacy', count: 1 }], overdue_cases: 1,
    })
    expect(gbOnly).toEqual({ guardrail_warnings: 2, open_cases: [{ type: 'adjustment', count: 1 }, { type: 'dispute', count: 2 }], overdue_cases: 1 })
    expect(scoped).toEqual({ ...gbOnly, guardrail_warnings: 1 })
    expect((await get(`/v1/dashboards/compliance?market_id=${ie}`, complianceGb)).statusCode).toBe(404)
    expect((await get('/v1/dashboards/compliance', portal)).statusCode).toBe(403)
  })
})

describe('definitions (T-B6-23, AC-RPT1-4)', () => {
  test('every figure has a definition; no field names a projection, potential, estimate, target, rank or leader', async () => {
    const responses = await Promise.all([
      get(`/v1/dashboards/executive?market_id=${gb}`, exec), get(`/v1/dashboards/finance?market_id=${gb}`, finance),
      get('/v1/dashboards/compliance', compliance),
    ])
    const [executive, financial, complianceView] = responses.map((response) => response.json())
    const has = (definitions: readonly { key: string }[], keys: string[]) => keys.filter((key) => !definitions.some((d) => d.key === key))

    expect(executive.meta.definitions).toEqual(EXECUTIVE_DEFINITIONS)
    expect(financial.meta.definitions).toEqual(FINANCE_DEFINITIONS)
    expect(complianceView.meta.definitions).toEqual(COMPLIANCE_DEFINITIONS)
    expect(has(EXECUTIVE_DEFINITIONS, ['net_sales_minor', 'payout_minor', 'payout_share_pct', 'active_earners', 'retail_share_pct', 'partial'])).toEqual([])
    expect(has(FINANCE_DEFINITIONS, Object.keys(financial.data).filter((key) => key !== 'market'))).toEqual([])
    expect(has(COMPLIANCE_DEFINITIONS, Object.keys(complianceView.data))).toEqual([])
    for (const body of [executive, financial, complianceView]) expect(keysOf(body).filter((key) => FORBIDDEN_FIELDS.test(key))).toEqual([])
    const words = [...EXECUTIVE_DEFINITIONS, ...FINANCE_DEFINITIONS, ...COMPLIANCE_DEFINITIONS].flatMap((d) => [d.key, d.label])
    expect(words.filter((word) => FORBIDDEN_FIELDS.test(word))).toEqual([])
  })
})
