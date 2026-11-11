import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { audModule } from '../aud/index.js'
import { iamModule } from '../iam/index.js'
import { tryLockLoads } from '../imp/index.js'
import { tenModule } from '../ten/index.js'
import { cplModule, computeSnapshotJob } from './index.js'
import {
  figureIn, freshTenant, getSnapshot, JAN_FEB, JAN_FEB_DATES, loadBatch, periodIn, PROTOTYPE_SETTINGS, requestSnapshot, saveSettings, TS31,
  type FactsInput,
} from './test-fixtures.js'

let app: FastifyInstance
let acmeMarket: string
let otherMarket: string
let officer: TestUser
let executive: TestUser
let payoutOfficer: TestUser
let scopedOfficer: TestUser
let globexOfficer: TestUser
let batchId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  acmeMarket = await createMarket(acme.id, 'GB')
  otherMarket = await createMarket(acme.id, 'IE')
  await createMarket(globex.id, 'GB')
  officer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  executive = await createSignedInUser({ tenantId: acme.id, roles: ['Executive read-only'] })
  payoutOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })
  scopedOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [otherMarket] })
  globexOfficer = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'] })
  await saveSettings(officer, PROTOTYPE_SETTINGS)
  batchId = await loadBatch(officer, acmeMarket, JAN_FEB_DATES, TS31)
  app = await buildTestApp({ modules: [iamModule, tenModule, audModule, cplModule] })
})

afterAll(async () => {
  await app.close()
})

async function readySnapshot(as: TestUser, body: Record<string, unknown> = JAN_FEB) {
  const created = await requestSnapshot(app, as, body)
  expect(created.statusCode).toBe(202)
  await runQueuedJobs(computeSnapshotJob)
  return (await getSnapshot(app, as, created.json().data.id)).json()
}

describe('POST /v1/compliance/snapshots', () => {
  test('records a computing snapshot on the loaded batches, audited and queued; the job makes it ready (TS-31)', async () => {
    const created = await requestSnapshot(app, officer, JAN_FEB)
    const queued = await runQueuedJobs(computeSnapshotJob)
    const body = (await getSnapshot(app, officer, created.json().data.id)).json()

    expect(created.statusCode).toBe(202)
    expect(created.json().data).toMatchObject({
      state: 'computing', market_id: acmeMarket, period_from: '2025-01', period_to: '2025-02', input_batch_ids: [batchId],
      reports: ['R1', 'R2', 'R3', 'R4', 'R5'], method_version: 'cpl-method-1.0.0', failure_reason: null,
      input_mapping_versions: [1],
    })
    expect(created.json().data.settings_version_id).toEqual(expect.any(String))
    expect(created.json().data.inputs_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(queued).toBe(1)
    expect(body.data.state).toBe('ready')
    expect(body.data.input_data_quality).toEqual([
      { batch_id: batchId, data_quality: expect.objectContaining({ orders: 3, refunded_orders: 1, payout_lines: 4 }) },
    ])
    expect(body.meta.notice).toContain('not income projections')
    expect(figureIn(body, 'R1.2025-01.customer_share_pct')).toMatchObject({
      value: '62.50', numerator: '10000', denominator: '16000', population_count: 3, unit: 'percent', method_version: 'cpl-method-1.0.0',
      rows: `/v1/compliance/snapshots/${body.data.id}/figures/R1.2025-01.customer_share_pct/rows`,
    })
    expect(figureIn(body, 'R1.2025-01.net_sales_cents').value).toBe('16000')
    expect(figureIn(body, 'R2.2025-01.personal_use_share_pct').value).toBe('60.00')
    expect(figureIn(body, 'R2.2025-01.payees_above_flag').value).toBe('1')
    expect(figureIn(body, 'R2.2025-01.flag_threshold').value).toBe('0.3333')
    expect(figureIn(body, 'R3.2025-01.share_pct.retail_sale').value).toBe('80.65')
    expect(figureIn(body, 'R3.2025.clawback_cents').value).toBe('-240')
    expect(figureIn(body, 'R4.2025-01.active_distributors').value).toBe('1')
    expect(figureIn(body, 'R4.2025-01.late_threshold_crossing_orders').value).toBe('1')
    expect(figureIn(body, 'R5.2025.median')).toMatchObject({ value: '14.30', unit: 'currency' })
    expect(figureIn(body, 'R5.2025.bands.0 or less').value).toBe('1')
    expect(periodIn(body, 'R5', '2025')).toMatchObject({ period_kind: 'year', partial: true })
    expect(periodIn(body, 'R5', '2025').notes.join(' ')).toContain('Not publishable')
    expect(periodIn(body, 'R4', '2025-01').notes[0]).toContain('own purchases')
    expect(await auditActions(officer.tenantId!)).toEqual(expect.arrayContaining(['SNAPSHOT.CREATED', 'SNAPSHOT.READY']))
    const outbox = await ownerRows('SELECT payload FROM outbox_event WHERE topic = $1', ['compliance.snapshot.ready'])
    expect(outbox).toContainEqual({ payload: { snapshot_id: body.data.id, market_id: acmeMarket } })
  })

  test('the same Idempotency-Key replays the first answer without a second snapshot', async () => {
    const send = () => call(app, { method: 'POST', url: '/v1/compliance/snapshots', as: officer, body: JAN_FEB, idempotencyKey: 'cpl-replay' })
    const first = await send()
    const replay = await send()

    expect(replay.statusCode).toBe(202)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json().data.id).toBe(first.json().data.id)
    const rows = await ownerRows('SELECT 1 FROM compliance_report_snapshot WHERE id = $1', [first.json().data.id])
    expect(rows).toHaveLength(1)
  })

  test('computes only the reports asked for, in report order', async () => {
    const body = await readySnapshot(officer, { ...JAN_FEB, reports: ['R3', 'R1'] })

    expect(body.data.reports).toEqual(['R1', 'R3'])
    expect([...new Set(body.data.results.map((r: { report: string }) => r.report))]).toEqual(['R1', 'R3'])
  })

  test('an unset threshold omits its indicator with the reason; nothing is assumed (DEC-14)', async () => {
    const { user } = await freshTenant(TS31, null)
    const body = await readySnapshot(user)

    expect(body.data.settings_version_id).toBeNull()
    expect(periodIn(body, 'R2', '2025-01').omitted.map((o) => o.key)).toEqual(['payees_above_flag', 'flag_threshold'])
    expect(periodIn(body, 'R4', '2025-01').figures).toEqual([])
    expect(periodIn(body, 'R4', '2025-01').omitted.map((o) => o.key)).toEqual([
      'active_distributors', 'active_with_no_customer_order_pct', 'late_threshold_crossing_orders', 'of_which_refunded_later',
    ])
    expect(periodIn(body, 'R4', '2025-01').omitted[0]!.reason).toContain('no default')
    expect(figureIn(body, 'R1.2025-01.customer_share_pct').value).toBe('62.50')
  })

  test('facts the method cannot compute on fail the snapshot with the reason', async () => {
    const orphan: FactsInput = { ...TS31, orders: [...TS31.orders, ['O9', '2025-01-09', 'X1', '100', '100', 'customer', false, '0', null]] }
    const { user, tenant } = await freshTenant(orphan)
    const body = await readySnapshot(user)

    expect(body.data.state).toBe('failed')
    expect(body.data.failure_reason).toContain('X1')
    expect(body.data.results).toEqual([])
    expect(await auditActions(tenant.id)).toContain('SNAPSHOT.FAILED')
  })

  test('rejects invalid bodies and a missing Idempotency-Key', async () => {
    const post = (body: unknown, withKey = true) =>
      call(app, { method: 'POST', url: '/v1/compliance/snapshots', as: officer, body, ...(withKey ? { idempotencyKey: true as const } : {}) })

    expect((await post({ ...JAN_FEB, tenant_id: officer.tenantId })).statusCode).toBe(400)
    expect((await post({ ...JAN_FEB, period_from: '2025-03' })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await post({ ...JAN_FEB, period_to: '2025-13' })).statusCode).toBe(400)
    expect((await post({ ...JAN_FEB, reports: ['R6'] })).statusCode).toBe(400)
    expect((await post(JAN_FEB, false)).json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })

  test('unknown and out-of-scope markets are 422 MARKET_UNKNOWN; a code resolves in the caller\'s tenant only', async () => {
    const unknown = await requestSnapshot(app, officer, { ...JAN_FEB, market: 'ZZ' })
    const outOfScope = await requestSnapshot(app, scopedOfficer, JAN_FEB)
    const noData = await requestSnapshot(app, officer, { ...JAN_FEB, period_from: '2026-01', period_to: '2026-03' })
    const otherTenant = await requestSnapshot(app, globexOfficer, JAN_FEB)

    expect([unknown, outOfScope, otherTenant].map((r) => r.json().error.code)).toEqual(['MARKET_UNKNOWN', 'MARKET_UNKNOWN', 'NO_DATA_FOR_RANGE'])
    expect(unknown.statusCode).toBe(422)
    expect(noData.json().error.code).toBe('NO_DATA_FOR_RANGE')
  })

  test('every month of the range must lie in a loaded batch: partial and gapped ranges list the missing months', async () => {
    const { user, market } = await freshTenant(TS31)
    await loadBatch(user, market, ['2025-04-01', '2025-04-30'], {
      participants: [['D1', 'distributor', '2024-12', null]], orders: [['A1', '2025-04-02', 'D1', '100', '100', 'personal', false, '0', null]], lines: [],
    })

    const partial = await requestSnapshot(app, user, { ...JAN_FEB, period_from: '2024-11' })
    const gapped = await requestSnapshot(app, user, { ...JAN_FEB, period_to: '2025-04' })
    const covered = await requestSnapshot(app, user, { ...JAN_FEB, period_from: '2025-04', period_to: '2025-04' })

    expect(partial.statusCode).toBe(422)
    expect(partial.json().error).toMatchObject({ code: 'NO_DATA_FOR_RANGE', details: { uncovered_months: ['2024-11', '2024-12'] } })
    expect(gapped.json().error).toMatchObject({ code: 'NO_DATA_FOR_RANGE', details: { uncovered_months: ['2025-03'] } })
    expect(covered.statusCode).toBe(202)
  })

  test('409 INPUTS_CHANGING while a load of the market is running; nothing is recorded', async () => {
    const { user, market, tenant } = await freshTenant(TS31)
    const refused = await withTenant({ tenantId: tenant.id, userId: user.id }, async (tx) => {
      expect(await tryLockLoads(tx, market)).toBe(true) // the load in progress holds the market's load lock
      return requestSnapshot(app, user, JAN_FEB)
    })

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe('INPUTS_CHANGING')
    expect(await auditActions(tenant.id)).not.toContain('SNAPSHOT.CREATED')
    expect((await requestSnapshot(app, user, JAN_FEB)).statusCode).toBe(202)
  })

  test('R5 needs a two-decimal currency', async () => {
    const tenant = await createTenant()
    const yen = (await ownerRows<{ id: string }>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES ($1, 'JP', 'JPY', 0, 'Asia/Tokyo', '{ja}', 'none', 'live') RETURNING id`, [tenant.id],
    ))[0]!.id
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'] })
    await loadBatch(user, yen, JAN_FEB_DATES, TS31)

    const refused = await requestSnapshot(app, user, { ...JAN_FEB, market: 'JP' })
    const withoutR5 = await requestSnapshot(app, user, { ...JAN_FEB, market: 'JP', reports: ['R1', 'R2', 'R3', 'R4'] })

    expect(refused.json().error.code).toBe('CURRENCY_NOT_SUPPORTED')
    expect(withoutR5.statusCode).toBe(202)
  })

  test('needs snapshot.create', async () => {
    expect((await requestSnapshot(app, executive, JAN_FEB)).statusCode).toBe(403)
    expect((await requestSnapshot(app, payoutOfficer, JAN_FEB)).json().error.code).toBe('PERMISSION_DENIED')
  })
})

describe('GET /v1/compliance/snapshots and /:id', () => {
  test('lists the caller\'s tenant newest first, page by page', async () => {
    const first = await call(app, { method: 'GET', url: '/v1/compliance/snapshots?limit=1', as: executive })
    const next = await call(app, { method: 'GET', url: `/v1/compliance/snapshots?limit=1&cursor=${first.json().meta.next_cursor}`, as: executive })
    const all = await call(app, { method: 'GET', url: '/v1/compliance/snapshots?limit=200', as: executive })
    const globex = await call(app, { method: 'GET', url: '/v1/compliance/snapshots', as: globexOfficer })

    expect(first.json().data).toHaveLength(1)
    expect(next.json().data[0].id).toBe(all.json().data[1].id)
    expect(all.json().data.length).toBeGreaterThan(2)
    expect(all.json().data.every((s: { market_id: string }) => s.market_id === acmeMarket)).toBe(true)
    expect(globex.json().data).toEqual([])
    expect((await call(app, { method: 'GET', url: '/v1/compliance/snapshots?cursor=bad', as: executive })).json().error.code).toBe('INVALID_CURSOR')
  })

  test('another tenant, a market outside the caller\'s scope and a missing id are 404; no compliance.read is 403', async () => {
    const id = (await call(app, { method: 'GET', url: '/v1/compliance/snapshots?limit=1', as: officer })).json().data[0].id

    expect((await getSnapshot(app, executive, id)).statusCode).toBe(200)
    expect((await getSnapshot(app, globexOfficer, id)).statusCode).toBe(404)
    expect((await getSnapshot(app, scopedOfficer, id)).statusCode).toBe(404)
    expect((await getSnapshot(app, officer, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    expect((await getSnapshot(app, payoutOfficer, id)).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/compliance/snapshots', as: payoutOfficer })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/compliance/snapshots', as: scopedOfficer })).json().data).toEqual([])
  })
})
