// T-B6-42 migration routes (D-B6-09, AC-MIG1-2, AC-MIG1-5) and T-B6-43 opening balances and state (D-B6-10, AC-MIG1-3/4).
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createImpModule } from '../imp/index.js'
import { migModule } from './index.js'
import { migrationMarket, migWorld, OPENING_BALANCES, OPENING_STATE, putCsv, type MarketFixture, type MigWorld } from './test-support.js'

let app: FastifyInstance
let w: MigWorld
let globex: MigWorld
let at: MarketFixture

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [migModule, createImpModule({ uploadDir: tmpdir() })] })
  w = await migWorld()
  globex = await migWorld()
  at = await migrationMarket(w, 'AT')
}, 120_000)

afterAll(async () => {
  await app.close()
})

const create = (as: TestUser, body: Record<string, unknown>) => call(app, { method: 'POST', url: '/v1/migrations', as, idempotencyKey: true, body: { volume_key: 'pv', ...body } })
const post = (as: TestUser, url: string, body?: unknown) => call(app, { method: 'POST', url, as, idempotencyKey: true, ...(body === undefined ? {} : { body }) })
const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })

describe('T-B6-42 create, apply, cancel (D-B6-09)', () => {
  let migrationId: string

  test('creation refusals: batch kind and state, cutover outside the batch, not a chain start or already calculated, live market, existing migration', async () => {
    const earlier = await migrationMarket(w, 'BE', { plan: 'earlier' })
    const validated = await migrationMarket(w, 'CZ', { batchState: 'mapped', plan: null })
    // FIXTURE (PLN): version 1 from M-3 covers C-1, version 2 starts at C, so C is not COMP's chain start (D-B6-10).
    const split = await migrationMarket(w, 'BG', { plan: 'earlier' })
    await ownerRows(
      `INSERT INTO plan_version (tenant_id, plan_id, version, state, effective_from, justification, engine_version, crediting_event,
         compiled, content_hash, submitted_by, submitted_at, approval_id, activation_approval_id, activated_at, created_by)
       SELECT v.tenant_id, v.plan_id, 2, 'scheduled', p.starts_at, v.justification, v.engine_version, v.crediting_event, v.compiled,
              v.content_hash, v.submitted_by, v.submitted_at, v.approval_id, v.activation_approval_id, v.activated_at, v.created_by
       FROM plan_version v, period p WHERE v.id = $1 AND p.id = $2`, [split.planVersionId, split.periods.c])
    // FIXTURE (COMP): C was calculated before any migration; its run snapshotted neither migrated orders nor the opening.
    const calculated = await migrationMarket(w, 'HU')
    await ownerRows("UPDATE period SET state = 'calculated' WHERE id = $1", [calculated.periods.c])
    const [overlay] = await ownerRows<{ id: string }>(
      `INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, uploaded_by)
       VALUES ($1, $2, 'overlay', '2026-01-01', '2026-01-31', 'validated', $3) RETURNING id`, [w.tenantId, at.marketId, w.consultant.id])
    const refusals = [
      await create(w.consultant, { import_batch_id: overlay!.id, cutover_period_id: at.periods.c }),
      await create(w.consultant, { import_batch_id: validated.batchId, cutover_period_id: validated.periods.c }),
      await create(w.consultant, { import_batch_id: at.batchId, cutover_period_id: at.periods.m }),
      await create(w.consultant, { import_batch_id: earlier.batchId, cutover_period_id: earlier.periods.c }),
      await create(w.consultant, { import_batch_id: at.batchId, cutover_period_id: earlier.periods.c }),
      await create(w.consultant, { import_batch_id: split.batchId, cutover_period_id: split.periods.c }),
      await create(w.consultant, { import_batch_id: calculated.batchId, cutover_period_id: calculated.periods.c }),
    ]
    const created = await create(w.consultant, { import_batch_id: at.batchId, cutover_period_id: at.periods.c })
    migrationId = created.json().data.id
    const again = await create(w.consultant, { import_batch_id: at.batchId, cutover_period_id: at.periods.c })

    expect(refusals.map((r) => [r.statusCode, r.statusCode === 404 ? 'NOT_FOUND' : r.json().error.code])).toEqual([
      [422, 'BATCH_KIND'], [422, 'BATCH_NOT_LOADED'], [422, 'CUTOVER_OUTSIDE_BATCH'], [422, 'CUTOVER_NOT_CHAIN_START'], [404, 'NOT_FOUND'], [422, 'CUTOVER_NOT_CHAIN_START'],
      [422, 'CUTOVER_NOT_OPEN'],
    ])
    expect(refusals[6]!.json().error.details).toEqual({ state: 'calculated' })
    expect(refusals[2]!.json().error.details).toEqual({ period_from: expect.stringMatching(/^\d{4}-\d{2}$/), period_to: expect.stringMatching(/^\d{4}-\d{2}$/) })
    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({
      market: { id: at.marketId, code: 'AT' }, batch: { id: at.batchId }, cutover_period: { id: at.periods.c }, volume_key: 'pv', state: 'draft',
      applied_counts: null, opening: { balances: { count: 0, total_minor: '0' }, state_rows: 0 }, latest_parallel_run: null, signoff: null, created_by: w.consultant.id,
    })
    expect(again.json().error.code).toBe('MIGRATION_EXISTS')
  })

  test('AC-MIG1-2: apply writes the batch once with counts; a second apply and cancel after apply are 409', async () => {
    const applied = await post(w.consultant, `/v1/migrations/${migrationId}/apply`)
    const again = await post(w.consultant, `/v1/migrations/${migrationId}/apply`)
    const cancel = await post(w.consultant, `/v1/migrations/${migrationId}/cancel`, { reason: 'wrong file' })
    const orders = await ownerRows<{ source_system: string; n: number }>(
      'SELECT source_system, count(*)::int AS n FROM sales_order WHERE market_id = $1 GROUP BY 1', [at.marketId])

    expect(applied.statusCode, applied.body).toBe(200)
    expect(applied.json().data.applied_counts).toEqual({ participants: 3, positions: 3, relationships: 2, servicing: 0, orders: 4, refund_events: 0 })
    expect(again.json().error).toMatchObject({ code: 'MIGRATION_STATE', details: { state: 'applied' } })
    expect(cancel.json().error).toMatchObject({ code: 'MIGRATION_STATE', details: { state: 'applied' } })
    expect(orders).toEqual([{ source_system: `migration:${migrationId}`, n: 4 }])
    expect((await get(w.finance, `/v1/migrations/${migrationId}`)).json().data).toMatchObject({ state: 'applied', applied_counts: { participants: 3 } })
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['MIGRATION.CREATED', 'MIGRATION.APPLIED']))
  })

  test('MIGRATION_INVALID lists the findings and writes nothing; a cancelled draft frees its batch for a new migration', async () => {
    const unknown = await migrationMarket(w, 'DK', { typeCode: 'NOPE', plan: null })
    const first = (await create(w.consultant, { import_batch_id: unknown.batchId, cutover_period_id: unknown.periods.c })).json().data.id as string
    const refused = await post(w.consultant, `/v1/migrations/${first}/apply`)
    const cancelled = await post(w.consultant, `/v1/migrations/${first}/cancel`, { reason: 'type not set up' })
    const second = await create(w.consultant, { import_batch_id: unknown.batchId, cutover_period_id: unknown.periods.c })

    expect(refused.json().error).toMatchObject({ code: 'MIGRATION_INVALID', details: { findings: [
      { code: 'TYPE_UNKNOWN', ref: 'DK-A', detail: 'NOPE' }, { code: 'TYPE_UNKNOWN', ref: 'DK-B', detail: 'NOPE' }, { code: 'TYPE_UNKNOWN', ref: 'DK-C', detail: 'NOPE' },
    ] } })
    expect(await ownerRows("SELECT 1 FROM participant WHERE external_ref LIKE 'DK-%'")).toEqual([])
    expect(cancelled.json().data.state).toBe('cancelled')
    expect(second.statusCode).toBe(201)
    expect((await get(w.consultant, '/v1/migrations')).json().data.map((m: { state: string }) => m.state)).toEqual(['draft', 'cancelled', 'applied'])
  })

  test('D-B6-09: a load does not supersede the batch of a draft migration; apply is refused once the market is live', async () => {
    const se = await migrationMarket(w, 'SE')
    const draft = (await create(w.consultant, { import_batch_id: se.batchId, cutover_period_id: se.periods.c })).json().data.id as string
    // FIXTURE (IMP, TEN): a second mapped migration batch of the same months with an approved mapping, and a breach contact.
    const mappings = { participant_types: { FXDIST: { counts_as_end_customer: false, can_earn: true } }, purposes: {}, source_kinds: {}, starter_kits: {} }
    const [covering] = await ownerRows<{ id: string }>(
      `WITH m AS (INSERT INTO import_mapping (tenant_id, version, kind, mappings, state, approved_by, created_by)
                  SELECT $1, max(version) + 1, 'migration', $3, 'approved', $4, $5 FROM import_mapping WHERE tenant_id = $1 RETURNING id)
       INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, mapping_id, row_counts, uploaded_by, created_by)
       SELECT b.tenant_id, b.market_id, b.kind, b.period_from, b.period_to, 'mapped', m.id, b.row_counts, b.uploaded_by, b.created_by
       FROM import_batch b, m WHERE b.id = $2 RETURNING id`, [w.tenantId, se.batchId, mappings, w.finance.id, w.consultant.id])
    await ownerRows(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by) VALUES ($1, 2, now(), $2, 'FIXTURE', $3)`,
      [w.tenantId, { 'privacy.breach_contacts': [{ name: 'Dana Protect', role: 'DPO', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }] }, w.admin.id])
    const load = await call(app, { method: 'POST', url: `/v1/imports/${covering!.id}/load`, as: w.consultant })

    expect(load.json().error).toMatchObject({ code: 'MIGRATION_EXISTS', details: { migration_id: draft } })
    expect(load.statusCode).toBe(409)
    expect(await ownerRows('SELECT state FROM import_batch WHERE id = ANY($1::uuid[]) ORDER BY state', [[se.batchId, covering!.id]])).toEqual([{ state: 'loaded' }, { state: 'mapped' }])

    // FIXTURE: the market went live after creation (TEN's go-live refuses that while a migration is open).
    await ownerRows("UPDATE market SET state = 'live' WHERE id = $1", [se.marketId])
    const applied = await post(w.consultant, `/v1/migrations/${draft}/apply`)
    expect([applied.statusCode, applied.json().error.code]).toEqual([422, 'MARKET_NOT_IN_IMPLEMENTATION'])
    expect((await get(w.finance, `/v1/migrations/${draft}`)).json().data.state).toBe('draft')
  })

  test('scope, permission and tenant: outside the market scope and in another tenant 404; without migration permissions 403', async () => {
    const elsewhere = await migrationMarket(w, 'EE', { plan: null })
    const scoped = await createSignedInUser({ tenantId: w.tenantId, roles: ['Implementation consultant'], marketIds: [elsewhere.marketId] })
    const routes = [
      ['GET', `/v1/migrations/${migrationId}`], ['POST', `/v1/migrations/${migrationId}/apply`], ['POST', `/v1/migrations/${migrationId}/cancel`],
      ['GET', `/v1/migrations/${migrationId}/opening`], ['POST', `/v1/migrations/${migrationId}/opening/submit`],
    ] as const
    for (const [method, url] of routes) {
      const as = (u: TestUser) => call(app, { method, url, as: u, idempotencyKey: true, ...(method === 'POST' ? { body: { reason: 'x' } } : {}) })
      expect([(await as(w.executive)).statusCode, (await as(globex.consultant)).statusCode, (await as(scoped)).statusCode], url).toEqual([403, 404, 404])
    }
    expect((await get(scoped, '/v1/migrations')).json().data).toEqual([])
    expect((await create(globex.consultant, { import_batch_id: at.batchId, cutover_period_id: at.periods.c })).statusCode).toBe(404)
    expect((await create(w.finance, { import_batch_id: at.batchId, cutover_period_id: at.periods.c })).statusCode).toBe(403)
  })

  describe('T-B6-43 opening balances and state (D-B6-10)', () => {
    const url = (tail: string) => `/v1/migrations/${migrationId}${tail}`

    test('AC-MIG1-3/4: balance and state refusals list each finding; nothing is staged', async () => {
      const results = {
        mismatch: await putCsv(app, w.consultant, url('/opening-balances?control_total_minor=951'), OPENING_BALANCES('AT')),
        unknown: await putCsv(app, w.consultant, url('/opening-balances?control_total_minor=1250'), 'payee_id,amount_minor\nAT-A,1250\nAT-Q,0\nAT-Z,7\n'),
        header: await putCsv(app, w.consultant, url('/opening-balances?control_total_minor=0'), 'payee,amount\n'),
        state: await putCsv(app, w.consultant, url('/opening-state'), 'participant_id,item,value\nAT-A,title.main,R9\nAT-B,counter.streak,3\nAT-Q,carry.x,1\nAT-A,title.main,R1\n'),
        json: await call(app, { method: 'PUT', url: url('/opening-balances?control_total_minor=0'), as: w.consultant, body: { rows: [] } }),
        noTotal: await putCsv(app, w.consultant, url('/opening-balances'), OPENING_BALANCES('AT')),
      }
      expect(results.mismatch.json().error).toMatchObject({ code: 'CONTROL_TOTAL_MISMATCH', details: { control_total_minor: '951', total_minor: '950' } })
      expect(results.unknown.json().error).toMatchObject({ code: 'OPENING_INVALID', details: { findings: [{ row: 3, code: 'INVALID_VALUE' }] } })
      expect((await putCsv(app, w.consultant, url('/opening-balances?control_total_minor=1257'), 'payee_id,amount_minor\nAT-A,1250\nAT-Z,7\n')).json().error)
        .toMatchObject({ code: 'OPENING_INVALID', details: { findings: [{ row: 3, code: 'PAYEE_UNKNOWN' }] } })
      expect(results.header.json().error).toMatchObject({ code: 'OPENING_INVALID', details: { findings: [{ row: 1, code: 'SCHEMA_MISMATCH' }] } })
      expect(results.state.json().error.details.findings.map((f: { row: number; code: string }) => [f.row, f.code])).toEqual([
        [2, 'ITEM_INVALID'], [3, 'ITEM_INVALID'], [4, 'PARTICIPANT_UNKNOWN'], [4, 'ITEM_INVALID'], [5, 'DUPLICATE_KEY'],
      ])
      expect(results.json.statusCode).toBe(415)
      expect(results.noTotal.statusCode).toBe(400)
      expect((await get(w.consultant, url(''))).json().data.opening).toMatchObject({ balances: { count: 0 }, state_rows: 0 })
    })

    test('staged rows replace earlier ones; the submitter cannot decide; approval posts one entry by payee; frozen after', async () => {
      // The dual user stages first (its rows are replaced below) and stays barred from deciding as a contributor.
      await putCsv(app, w.dual, url('/opening-balances?control_total_minor=1'), 'payee_id,amount_minor\nAT-B,1\n')
      const balances = await putCsv(app, w.consultant, url('/opening-balances?control_total_minor=950'), OPENING_BALANCES('AT'))
      const state = await putCsv(app, w.consultant, url('/opening-state'), OPENING_STATE('AT'))
      const opening = await get(w.finance, url('/opening'))
      // The dual user submits, so its own decision is refused (SoD vs the submitter).
      const submitted = await post(w.dual, url('/opening/submit'))
      const self = await post(w.dual, url('/opening/decision'), { decision: 'approve', reason: 'ok' })
      const rejected = await post(w.finance, url('/opening/decision'), { decision: 'reject', reason: 'recheck' })
      await post(w.consultant, url('/opening/submit'))
      const stager = await post(w.dual, url('/opening/decision'), { decision: 'approve', reason: 'ok' })
      const approved = await post(w.finance, url('/opening/decision'), { decision: 'approve', reason: 'Matches the legacy balances' })
      const second = await post(w.finance, url('/opening/decision'), { decision: 'approve', reason: 'again' })
      const frozen = await putCsv(app, w.consultant, url('/opening-balances?control_total_minor=950'), OPENING_BALANCES('AT'))
      const balance = (ref: string, type: string) => ownerRows<{ amount: string }>(
        `SELECT coalesce(sum(CASE WHEN a.type = 'clawback_receivable' THEN x.debit_minor - x.credit_minor ELSE x.credit_minor - x.debit_minor END), 0)::text AS amount
         FROM ledger_account a JOIN posting x ON x.account_id = a.id JOIN participant p ON p.id = a.payee_participant_id
         WHERE p.external_ref = $1 AND a.type = $2`, [ref, type])
      const entry = await ownerRows<{ event_type: string; idempotency_key: string; approval_id: string | null; period_id: string }>(
        'SELECT event_type, idempotency_key, approval_id, period_id FROM journal_entry WHERE id = $1', [approved.json().data.journal_entry_id])

      expect([balances.json().data, state.json().data]).toEqual([{ count: 2, total_minor: '950' }, { positions: 1, items: 1 }])
      expect(opening.json().data).toEqual([
        { participant: { id: expect.any(String), external_ref: 'AT-A' }, amount_minor: '1250', state: expect.objectContaining({ titles: [{ ladder: 'main', rank: 'R1' }], paid_as: [] }) },
        { participant: { id: expect.any(String), external_ref: 'AT-C' }, amount_minor: '-300', state: null },
      ])
      expect(submitted.statusCode).toBe(200)
      expect(self.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
      expect(stager.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
      expect(rejected.json().data).toEqual({ state: 'applied', journal_entry_id: null })
      expect(approved.json().data).toMatchObject({ state: 'opening_posted', journal_entry_id: expect.any(String) })
      expect(second.json().error).toMatchObject({ code: 'MIGRATION_STATE', details: { state: 'opening_posted' } })
      expect(frozen.json().error.code).toBe('MIGRATION_STATE')
      expect(entry).toEqual([{ event_type: 'migration_opening', idempotency_key: `migration:${migrationId}:opening`, approval_id: expect.any(String), period_id: at.periods.c }])
      expect(await balance('AT-A', 'payee_payable')).toEqual([{ amount: '1250' }])
      expect(await balance('AT-C', 'clawback_receivable')).toEqual([{ amount: '300' }])
      expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining([
        'MIGRATION.OPENING_STAGED', 'MIGRATION.OPENING_SUBMITTED', 'MIGRATION.OPENING_REJECTED', 'MIGRATION.OPENING_APPROVED', 'APPROVAL.REFUSED',
      ]))
    })
  })
})
