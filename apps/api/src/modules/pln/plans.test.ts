// T-B3-01 plans, versions, rules and immutability; AC-PLN1-1/2, AC-PLN2-1/2/3, AC-PLN3-1, T-B3-04 diff, T-B3-05/06
// through the API; D-B3-06 placement width prefill.
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { cplModule } from '../cpl/index.js'
import { plnModule } from './index.js'
import { CAPPED, customRoleUser, newPlan, personal, putRule, revisionOf, setSettings, UNILEVEL, world, type World } from './test-support.js'

let app: FastifyInstance
let w: World
let other: World

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [plnModule, cplModule], env: { LOG_LEVEL: 'error' } })
  w = await world()
  other = await world()
}, 120_000)

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })

describe('T-B3-01 POST /v1/plans, GET /v1/plans, GET /v1/plans/:id', () => {
  test('creates the plan with version 1 as an empty draft; lists and reads it', async () => {
    const { planId } = await newPlan(app, w, { name: 'DE core' })
    const list = await get(w.executive, '/v1/plans')
    expect(list.statusCode).toBe(200)
    const listed = list.json().data.find((p: { id: string }) => p.id === planId)
    expect(listed).toMatchObject({ name: 'DE core', authoring_version: { version: 1, state: 'draft' }, current_version: null })
    expect(listed.markets.map((m: { code: string }) => m.code)).toEqual(['AT', 'DE'])
    const one = await get(w.executive, `/v1/plans/${planId}`)
    expect(one.json().data.versions).toMatchObject([{ version: 1, state: 'draft' }])
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['PLAN.CREATED', 'PLAN_VERSION.CREATED']))
  })

  test('D-B6-05: the retired genealogy.placement_width no longer pre-fills the first draft', async () => {
    await setSettings(other.tenantId, other.planadmin.id, { 'genealogy.placement_width': 3 })
    const { planId } = await newPlan(app, other)
    expect((await get(other.planadmin, `/v1/plans/${planId}/versions/1`)).json().data.placement_width).toBeNull()
  })

  test('refusals: validation, calendar in a plan or outside the markets, name taken, unknown market', async () => {
    const post = (body: Record<string, unknown>) => call(app, { method: 'POST', url: '/v1/plans', as: w.planadmin, idempotencyKey: true, body: { name: 'Owns A', market_ids: [w.marketA], calendar_ids: [w.calendarA], ...body } })
    expect((await post({ calendar_ids: [] })).statusCode).toBe(400)
    expect((await post({})).statusCode).toBe(201)
    expect((await post({ name: 'Other' })).json().error).toMatchObject({ code: 'CALENDAR_IN_PLAN', details: { calendar_ids: [w.calendarA] } })
    expect((await post({ market_ids: [w.marketB], calendar_ids: [w.calendarB] })).json().error.code).toBe('PLAN_NAME_TAKEN')
    expect((await post({ name: 'Mismatch', calendar_ids: [w.calendarB] })).json().error).toMatchObject({ code: 'CALENDAR_MARKET_MISMATCH', details: { calendar_ids: [w.calendarB] } })
    expect((await post({ name: 'Foreign', market_ids: [other.marketA], calendar_ids: [other.calendarA] })).json().error.code).toBe('MARKET_UNKNOWN')
  })

  test('scope: a plan.edit holder of one market cannot create a two-market plan; a reader of one market does not see it', async () => {
    const scoped = await customRoleUser(w.tenantId, ['plan.read', 'plan.edit'], [w.marketA])
    const response = await call(app, { method: 'POST', url: '/v1/plans', as: scoped, idempotencyKey: true, body: { name: 'Scoped', market_ids: [w.marketA, w.marketB], calendar_ids: [] } })
    expect(response.statusCode).toBe(400)
    const twoMarkets = await call(app, { method: 'POST', url: '/v1/plans', as: scoped, idempotencyKey: true, body: { name: 'Scoped', market_ids: [w.marketA, w.marketB], calendar_ids: [w.calendarB] } })
    expect(twoMarkets.json().error.code).toBe('SCOPE_NOT_HELD')
    const { planId } = await newPlan(app, w)
    expect((await get(scoped, `/v1/plans/${planId}`)).statusCode).toBe(404)
    expect((await get(scoped, '/v1/plans')).json().data.map((p: { id: string }) => p.id)).not.toContain(planId)
  })

  test('missing permission and cross-tenant denial', async () => {
    const { planId } = await newPlan(app, w)
    expect((await call(app, { method: 'POST', url: '/v1/plans', as: w.compliance, idempotencyKey: true, body: { name: 'No', market_ids: [w.marketA], calendar_ids: [w.calendarA] } })).statusCode).toBe(403)
    const noRead = await createSignedInUser({ tenantId: w.tenantId, roles: ['Payout officer'] })
    expect((await get(noRead, '/v1/plans')).statusCode).toBe(403)
    expect((await get(other.planadmin, `/v1/plans/${planId}`)).statusCode).toBe(404)
    expect((await get(other.planadmin, '/v1/plans')).json().data.map((p: { id: string }) => p.id)).not.toContain(planId)
  })
})

describe('rules, transitions and fields of a draft (AC-PLN1-1, AC-PLN2-*, AC-PLN3-1)', () => {
  let planId: string
  let calendars: { calendarA: string; calendarB: string }
  beforeAll(async () => {
    const created = await newPlan(app, w)
    planId = created.planId
    calendars = created
  })

  test('If-Match: missing -> 428, stale -> 412, current -> 200 and the revision moves on', async () => {
    const url = `/v1/plans/${planId}/versions/1/rules/pv`
    const body = { kind: 'volume.personal', params: personal() }
    expect((await call(app, { method: 'PUT', url, as: w.planadmin, body })).statusCode).toBe(428)
    const revision = await revisionOf(app, w.planadmin, planId)
    expect((await call(app, { method: 'PUT', url, as: w.planadmin, body, headers: { 'if-match': `"${revision - 1}"` } })).statusCode).toBe(412)
    const saved = await call(app, { method: 'PUT', url, as: w.planadmin, body, headers: { 'if-match': `"${revision}"` } })
    expect(saved.statusCode).toBe(200)
    expect(saved.headers.etag).toBe(`"${revision + 1}"`)
    expect(saved.json().data.rule).toMatchObject({ rule_key: 'pv', pass: '1', extension: false })
  })

  test('RULE_INVALID with per-path errors; AC-PLN3-1 type error and size bound', async () => {
    const bad = await putRule(app, w.planadmin, planId, 'bad', { kind: 'measure.derived', params: { expr: { op: 'add', args: [{ measure: 'pv' }, { op: 'gt', args: [{ measure: 'pv' }, { const: '1' }] }] } } })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().error).toMatchObject({ code: 'RULE_INVALID', details: { errors: [{ path: 'expr.args[1]', code: 'EXPRESSION_TYPE' }] } })
    const wide = { op: 'add', args: Array.from({ length: 64 }, () => ({ measure: 'pv' })) }
    expect((await putRule(app, w.planadmin, planId, 'wide', { kind: 'measure.derived', params: { expr: wide } })).json().error.details.errors[0].code).toBe('EXPRESSION_TOO_LARGE')
    expect((await putRule(app, w.planadmin, planId, 'Bad-Key', { kind: 'measure.derived', params: CAPPED.params })).statusCode).toBe(400)
  })

  test('AC-PLN2-1/2: unknown reference reported, renderings returned; a valid plan compiles', async () => {
    await putRule(app, w.planadmin, planId, 'pv', { kind: 'volume.personal', params: personal() })
    const dangling = await putRule(app, w.planadmin, planId, 'unilevel', { ...UNILEVEL, params: { ...UNILEVEL.params, measure: 'gv' } })
    expect(dangling.json().data.validation).toMatchObject({ ok: false, errors: [{ rule_key: 'unilevel', code: 'UNKNOWN_REFERENCE', path: 'measure' }] })
    const compiled = (await ownerRows<{ compiled: unknown }>('SELECT compiled FROM plan_version WHERE plan_id = $1', [planId]))[0]!.compiled
    expect(compiled).toBeNull()
    await putRule(app, w.planadmin, planId, 'unilevel', UNILEVEL)
    const view = (await get(w.planadmin, `/v1/plans/${planId}/versions/1`)).json().data
    expect(view.validation).toEqual({ ok: true, errors: [] })
    expect(view.rules.find((r: { rule_key: string }) => r.rule_key === 'unilevel').rendering).toBe('Pays 8 % of pv on sponsor level 1; compression none; reversal: order line; paid to every earner')
    const [row] = await ownerRows<{ ok: boolean }>(`SELECT compiled IS NOT NULL AND content_hash = digest(compiled::text, 'sha256') AS ok FROM plan_version WHERE plan_id = $1`, [planId])
    expect(row!.ok).toBe(true)
  })

  test('AC-PLN2-3: a calendar-scoped rule depending on another calendar is a conflict; a calendar outside the plan is refused', async () => {
    await putRule(app, w.planadmin, planId, 'scoped_pv', { kind: 'volume.personal', params: personal('pv'), calendar_id: calendars.calendarA })
    const conflict = await putRule(app, w.planadmin, planId, 'scoped_gv', { kind: 'volume.group', params: { of: 'scoped_pv', tree: 'sponsor', includeSelf: true }, calendar_id: calendars.calendarB })
    expect(conflict.json().data.validation.errors).toEqual([expect.objectContaining({ rule_key: 'scoped_gv', code: 'CALENDAR_SCOPE_CONFLICT' })])
    expect((await putRule(app, w.planadmin, planId, 'x', { kind: 'volume.personal', params: personal(), calendar_id: other.calendarA })).json().error.code).toBe('CALENDAR_NOT_IN_PLAN')
    const revision = await revisionOf(app, w.planadmin, planId)
    expect((await call(app, { method: 'DELETE', url: `/v1/plans/${planId}/versions/1/rules/scoped_gv`, as: w.planadmin, headers: { 'if-match': `"${revision}"` } })).statusCode).toBe(204)
    const again = await revisionOf(app, w.planadmin, planId)
    await call(app, { method: 'DELETE', url: `/v1/plans/${planId}/versions/1/rules/scoped_pv`, as: w.planadmin, headers: { 'if-match': `"${again}"` } })
    const last = await revisionOf(app, w.planadmin, planId)
    expect((await call(app, { method: 'DELETE', url: `/v1/plans/${planId}/versions/1/rules/nope`, as: w.planadmin, headers: { 'if-match': `"${last}"` } })).statusCode).toBe(404)
  })

  test('PATCH fields and transitions (validation, If-Match)', async () => {
    const revision = await revisionOf(app, w.planadmin, planId)
    const url = `/v1/plans/${planId}/versions/1`
    expect((await call(app, { method: 'PATCH', url, as: w.planadmin, body: { placement_width: 30 }, headers: { 'if-match': `"${revision}"` } })).statusCode).toBe(400)
    const patched = await call(app, { method: 'PATCH', url, as: w.planadmin, body: { crediting_event: 'paid', placement_width: 2 }, headers: { 'if-match': `"${revision}"` } })
    expect(patched.json().data).toMatchObject({ crediting_event: 'paid', placement_width: 2, revision: revision + 1 })
    const reset = await call(app, { method: 'PUT', url: `${url}/transitions/title.main`, as: w.planadmin, body: { rule: 'reset' }, headers: { 'if-match': `"${revision + 1}"` } })
    expect(reset.json().error.code).toBe('VALIDATION_FAILED')
    const carry = await call(app, { method: 'PUT', url: `${url}/transitions/title.*`, as: w.planadmin, body: { rule: 'carry' }, headers: { 'if-match': `"${revision + 1}"` } })
    expect(carry.json().data.transition).toMatchObject({ state_item: 'title.*', rule: 'carry' })
    expect((await call(app, { method: 'DELETE', url: `${url}/transitions/title.*`, as: w.planadmin, headers: { 'if-match': `"${revision + 2}"` } })).statusCode).toBe(204)
  })

  test('a map transition maps title or paid-as ranks to ranks of this version (the engine refuses others at run time)', async () => {
    const url = `/v1/plans/${planId}/versions/1`
    const ladder = { kind: 'ladder', params: { ranks: [{ key: 'R1', requires: [], maintenance: null }] } }
    expect((await putRule(app, w.planadmin, planId, 'tiers', ladder)).statusCode).toBe(200)
    const put = async (item: string, map: unknown) => call(app, { method: 'PUT', url: `${url}/transitions/${item}`, as: w.planadmin, body: { rule: 'map', map }, headers: { 'if-match': `"${await revisionOf(app, w.planadmin, planId)}"` } })
    expect((await put('carry.bank', [{ from: '1', to: '2' }])).json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'rule' }] } })
    expect((await put('title.tiers', [{ from: 'OLD', to: 'R9' }])).json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'map[0].to' }] } })
    expect((await put('paid_as.*', [{ from: 'OLD', to: 'R1' }])).statusCode).toBe(200)
    expect((await put('title.tiers', [{ from: 'OLD', to: 'R1' }])).json().data.transition).toMatchObject({ state_item: 'title.tiers', rule: 'map' })
  })

  test('missing permission and cross-tenant denial on writes', async () => {
    const revision = await revisionOf(app, w.planadmin, planId)
    const put = (as: TestUser) => call(app, { method: 'PUT', url: `/v1/plans/${planId}/versions/1/rules/pv`, as, body: { kind: 'volume.personal', params: personal() }, headers: { 'if-match': `"${revision}"` } })
    expect((await put(w.compliance)).statusCode).toBe(403)
    expect((await put(other.planadmin)).statusCode).toBe(404)
    expect((await get(other.planadmin, `/v1/plans/${planId}/versions/1`)).statusCode).toBe(404)
    expect((await call(app, { method: 'PATCH', url: `/v1/plans/${planId}/versions/1`, as: other.planadmin, body: { crediting_event: 'paid' }, headers: { 'if-match': `"${revision}"` } })).statusCode).toBe(404)
  })
})

describe('new versions, diff and immutability (AC-PLN1-2, AC-PLN1-5, T-B3-04)', () => {
  test('a new version copies rules; the diff lists added, removed and changed rules and fields; approved content is frozen', async () => {
    const { planId } = await newPlan(app, w)
    await putRule(app, w.planadmin, planId, 'pv', { kind: 'volume.personal', params: personal() })
    await putRule(app, w.planadmin, planId, 'unilevel', UNILEVEL)
    expect((await call(app, { method: 'POST', url: `/v1/plans/${planId}/versions`, as: w.planadmin, idempotencyKey: true, body: {} })).json().error.code).toBe('VERSION_IN_AUTHORING')
    // FIXTURE: move version 1 out of authoring (the lifecycle routes are tested in lifecycle.test.ts).
    await ownerRows(
      `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                  SELECT tenant_id, 'plan_version', id, created_by, $2, 'approved', now(), $2 FROM plan_version WHERE plan_id = $1 RETURNING id)
       UPDATE plan_version SET state = 'approved', approval_id = (SELECT id FROM a), crediting_event = 'paid', submitted_by = created_by, submitted_at = now()
       WHERE plan_id = $1`,
      [planId, w.compliance.id],
    )
    const created = await call(app, { method: 'POST', url: `/v1/plans/${planId}/versions`, as: w.planadmin, idempotencyKey: true, body: {} })
    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({ version: 2, state: 'draft' })
    await putRule(app, w.planadmin, planId, 'unilevel', { ...UNILEVEL, params: { ...UNILEVEL.params, levels: ['0.1'] } }, 2)
    await putRule(app, w.planadmin, planId, 'capped', CAPPED, 2)
    const diff = (await get(w.executive, `/v1/plans/${planId}/versions/2/diff?against=1`)).json().data
    expect(diff.rules.added.map((r: { rule_key: string }) => r.rule_key)).toEqual(['capped'])
    expect(diff.rules.removed).toEqual([])
    expect(diff.rules.changed).toMatchObject([{ rule_key: 'unilevel', rendering_before: expect.stringContaining('8 %'), rendering_after: expect.stringContaining('10 %') }])
    expect((await get(w.executive, `/v1/plans/${planId}/versions/2/diff?against=9`)).statusCode).toBe(404)
    expect((await get(other.planadmin, `/v1/plans/${planId}/versions/2/diff?against=1`)).statusCode).toBe(404)

    const revision = await revisionOf(app, w.planadmin, planId, 1)
    const write = await call(app, { method: 'PUT', url: `/v1/plans/${planId}/versions/1/rules/pv`, as: w.planadmin, body: { kind: 'volume.personal', params: personal() }, headers: { 'if-match': `"${revision}"` } })
    expect(write.json().error.code).toBe('VERSION_NOT_DRAFT')
    const id = (await ownerRows<{ id: string }>('SELECT id FROM plan_version WHERE plan_id = $1 AND version = 1', [planId]))[0]!.id
    const refused = await withTenant({ tenantId: w.tenantId, userId: w.planadmin.id }, (tx) => tx.query('UPDATE plan_rule SET ordinal = 1 WHERE plan_version_id = $1', [id]))
      .then(() => null, (e: { code?: string }) => e.code)
    expect(refused).toBe('42501')
  })
})
