// T-B3-14 golden datasets: CRUD, run, freeze from a simulation (AC-GLD-1/2), AC-10.3 / TS-46 golden part (stored
// GOLDEN_FAILED keeps last_result, the version stays draft).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { cplModule } from '../cpl/index.js'
import { plnModule } from './index.js'
import { CAPPED, completedSimulation, customRoleUser, GOLDEN_EXPECTED, GOLDEN_INPUT, newPlan, personal, putRule, revisionOf, UNILEVEL, world, type NewPlan, type World } from './test-support.js'

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

const base = (planId: string) => `/v1/plans/${planId}/versions/1/golden-datasets`
const create = (as: TestUser, plan: NewPlan, body: Record<string, unknown>) =>
  call(app, { method: 'POST', url: base(plan.planId), as, idempotencyKey: true, body: { name: 'case', calendar_id: plan.calendarA, covers: [], input: GOLDEN_INPUT, expected: GOLDEN_EXPECTED, ...body } })

async function draft(): Promise<NewPlan> {
  const plan = await newPlan(app, w)
  await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal() })
  await putRule(app, w.planadmin, plan.planId, 'unilevel', UNILEVEL)
  await putRule(app, w.planadmin, plan.planId, 'capped', CAPPED)
  const revision = await revisionOf(app, w.planadmin, plan.planId)
  await call(app, { method: 'PATCH', url: `/v1/plans/${plan.planId}/versions/1`, as: w.planadmin, body: { crediting_event: 'paid' }, headers: { 'if-match': `"${revision}"` } })
  return plan
}

describe('T-B3-14 golden datasets', () => {
  test('create, list, read, run (pass), delete', async () => {
    const plan = await draft()
    const created = await create(w.planadmin, plan, { covers: ['capped'] })
    expect(created.statusCode).toBe(201)
    const id = created.json().data.id
    expect(created.json().data).toMatchObject({ name: 'case', covers: ['capped'], last_result: null })
    expect((await call(app, { method: 'GET', url: base(plan.planId), as: w.executive })).json().data).toMatchObject([{ id, name: 'case' }])
    expect((await call(app, { method: 'GET', url: `${base(plan.planId)}/${id}`, as: w.executive })).json().data.expected).toEqual(GOLDEN_EXPECTED)
    const ran = await call(app, { method: 'POST', url: `${base(plan.planId)}/run`, as: w.planadmin, idempotencyKey: true })
    expect(ran.json().data).toEqual([{ id, name: 'case', status: 'pass', mismatches: [], error: null }])
    const [stored] = await ownerRows<{ last_result: { status: string } }>('SELECT last_result FROM golden_dataset WHERE id = $1', [id])
    expect(stored!.last_result.status).toBe('pass')
    expect((await call(app, { method: 'DELETE', url: `${base(plan.planId)}/${id}`, as: w.planadmin })).statusCode).toBe(204)
    expect((await call(app, { method: 'DELETE', url: `${base(plan.planId)}/${id}`, as: w.planadmin })).statusCode).toBe(404)
  })

  test('AC-GLD-1: money strings only, total = sum, at most 5 MB; covers must be extension rules; names unique', async () => {
    const plan = await draft()
    const lines = [{ payee_position_id: 'A', rule_key: 'unilevel', amount_minor: 800 }]
    expect((await create(w.planadmin, plan, { expected: { lines, total_minor: '800' } })).json().error.code).toBe('GOLDEN_INVALID')
    expect((await create(w.planadmin, plan, { expected: { ...GOLDEN_EXPECTED, total_minor: '801' } })).json().error).toMatchObject({ code: 'GOLDEN_INVALID', details: { sum_minor: '800' } })
    expect((await create(w.planadmin, plan, { input: { snapshot: { pad: 'x'.repeat(5_300_000) }, settings: {} } })).json().error.code).toBe('GOLDEN_TOO_LARGE')
    expect((await create(w.planadmin, plan, { input: { snapshot: [] } })).json().error.code).toBe('GOLDEN_INVALID')
    // about 4 MB compact, about 6 MB as jsonb text (the stored CHECK): refused as too large, not as a constraint error
    expect((await create(w.planadmin, plan, { input: { snapshot: { pad: Array(2_000_000).fill(1) }, settings: {} } })).json().error.code).toBe('GOLDEN_TOO_LARGE')
    const badMinor = { ...GOLDEN_INPUT, snapshot: { ...GOLDEN_INPUT.snapshot, knownAtUs: '1.5' } }
    expect((await create(w.planadmin, plan, { input: badMinor })).json().error.code).toBe('GOLDEN_INVALID')
    const twice = [{ payee_position_id: 'A', rule_key: 'unilevel', amount_minor: '400' }, { payee_position_id: 'A', rule_key: 'unilevel', amount_minor: '400' }]
    expect((await create(w.planadmin, plan, { expected: { lines: twice, total_minor: '800' } })).json().error).toMatchObject({ code: 'GOLDEN_INVALID', details: { lines: [twice[1]] } })
    expect((await create(w.planadmin, plan, { covers: ['unilevel'] })).json().error).toMatchObject({ code: 'UNKNOWN_EXTENSION_RULE', details: { rule_keys: ['unilevel'] } })
    expect((await create(w.planadmin, plan, { calendar_id: other.calendarA })).json().error.code).toBe('CALENDAR_NOT_IN_PLAN')
    expect((await create(w.planadmin, plan, {})).statusCode).toBe(201)
    expect((await create(w.planadmin, plan, {})).json().error.code).toBe('GOLDEN_NAME_TAKEN')
    expect((await call(app, { method: 'POST', url: base(plan.planId), as: w.planadmin, idempotencyKey: true, body: { name: 'x' } })).statusCode).toBe(400)
  })

  test('AC-10.3 / TS-46: an expected line off by 0.01 -> submit 422 GOLDEN_FAILED stored with last_result, version stays draft', async () => {
    const plan = await draft()
    const off = { lines: [{ payee_position_id: 'A', rule_key: 'unilevel', amount_minor: '801' }], total_minor: '801' }
    const id = (await create(w.planadmin, plan, { covers: ['capped'], expected: off })).json().data.id
    const key = `submit-${id}`
    const submit = () => call(app, { method: 'POST', url: `/v1/plans/${plan.planId}/versions/1/submit`, as: w.planadmin, idempotencyKey: key })
    const refused = await submit()
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({
      code: 'GOLDEN_FAILED',
      details: { datasets: [{ id, name: 'case', mismatches: [{ payee_position_id: 'A', rule_key: 'unilevel', expected_minor: '801', actual_minor: '800' }] }] },
    })
    const [row] = await ownerRows<{ last_result: { status: string }; state: string }>(
      'SELECT g.last_result, v.state FROM golden_dataset g JOIN plan_version v ON v.id = g.plan_version_id WHERE g.id = $1', [id])
    expect(row).toMatchObject({ last_result: { status: 'fail' }, state: 'draft' })
    const audited = await ownerRows("SELECT 1 FROM audit.audit_event a JOIN plan_version v ON v.id = a.object_id WHERE v.plan_id = $1 AND a.action = 'GOLDEN_DATASET.RUN'", [plan.planId])
    expect(audited).toHaveLength(1)
    const replay = await submit()
    expect([replay.statusCode, replay.headers['idempotent-replayed']]).toEqual([422, 'true'])
  })

  test('AC-GLD-2: frozen from a completed simulation, it passes at once; only a completed simulation of the version', async () => {
    const plan = await draft()
    const versionId = (await ownerRows<{ id: string }>('SELECT id FROM plan_version WHERE plan_id = $1', [plan.planId]))[0]!.id
    const simulationId = await completedSimulation(versionId, plan.calendarA)
    const frozen = await call(app, { method: 'POST', url: base(plan.planId), as: w.planadmin, idempotencyKey: true, body: { name: 'from simulation', covers: ['capped'], from_simulation_id: simulationId } })
    expect(frozen.statusCode).toBe(201)
    expect(frozen.json().data).toMatchObject({ source_simulation_id: simulationId, calendar_id: plan.calendarA })
    const detailAs = async (as: TestUser) => (await call(app, { method: 'GET', url: `${base(plan.planId)}/${frozen.json().data.id}`, as })).json().data
    // The frozen snapshot holds the tenant's genealogy and the market's orders: plan.read alone does not show it.
    const planReader = await detailAs(w.planadmin)
    expect([planReader.expected, planReader.input]).toEqual([{ lines: [], total_minor: '0' }, null])
    expect((await detailAs(await customRoleUser(w.tenantId, ['plan.read', 'genealogy.read']))).input).toBeNull()
    const detail = await detailAs(await customRoleUser(w.tenantId, ['plan.read', 'genealogy.read', 'order.read']))
    expect(detail.input.settings).toMatchObject({ roundingMode: 'half_up', restockingFeeAffectsVolume: false })
    const ran = await call(app, { method: 'POST', url: `${base(plan.planId)}/run`, as: w.planadmin, idempotencyKey: true })
    expect(ran.json().data[0]).toMatchObject({ status: 'pass' })
    // a stored input whose *Us value is not a whole number fails the golden instead of failing the request
    await ownerRows(`UPDATE golden_dataset SET input = jsonb_set(input, '{snapshot,knownAtUs}', '"abc"') WHERE id = $1`, [frozen.json().data.id])
    const broken = await call(app, { method: 'POST', url: `${base(plan.planId)}/run`, as: w.planadmin, idempotencyKey: true })
    expect([broken.statusCode, broken.json().data[0]]).toMatchObject([200, { status: 'fail', error: { code: 'INVALID_INPUT' } }])
    const otherPlan = await draft()
    const foreign = await call(app, { method: 'POST', url: base(otherPlan.planId), as: w.planadmin, idempotencyKey: true, body: { name: 'x', covers: [], from_simulation_id: simulationId } })
    expect(foreign.json().error.code).toBe('SIMULATION_NOT_COMPLETED')
  })

  test('a version with validation errors cannot run its goldens; draft-only writes; permissions and tenants', async () => {
    const plan = await newPlan(app, w)
    await putRule(app, w.planadmin, plan.planId, 'unilevel', UNILEVEL)
    expect((await call(app, { method: 'POST', url: `${base(plan.planId)}/run`, as: w.planadmin, idempotencyKey: true })).json().error.code).toBe('PLAN_INVALID')
    expect((await create(w.compliance, plan, {})).statusCode).toBe(403)
    expect((await call(app, { method: 'POST', url: `${base(plan.planId)}/run`, as: w.compliance, idempotencyKey: true })).statusCode).toBe(403)
    expect((await create(other.planadmin, plan, {})).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: base(plan.planId), as: other.planadmin })).statusCode).toBe(404)
    const ready = await draft()
    const id = (await create(w.planadmin, ready, { covers: ['capped'] })).json().data.id
    await ownerRows(
      `WITH a AS (INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
                  SELECT tenant_id, 'plan_version', id, created_by, $2, 'approved', now(), $2 FROM plan_version WHERE plan_id = $1 RETURNING id)
       UPDATE plan_version SET state = 'approved', approval_id = (SELECT id FROM a), submitted_by = created_by, submitted_at = now() WHERE plan_id = $1`,
      [ready.planId, w.compliance.id],
    )
    expect((await call(app, { method: 'DELETE', url: `${base(ready.planId)}/${id}`, as: w.planadmin })).json().error.code).toBe('VERSION_NOT_DRAFT')
    expect((await create(w.planadmin, ready, { name: 'late' })).json().error.code).toBe('VERSION_NOT_DRAFT')
  })

  test('AC-44.1 / TS-01: the unilevel 8/5/4/4/4 plan entered as rule rows reproduces the engine golden (925.00)', async () => {
    const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../packages/engine/test/fixtures/ts01-unilevel.json'), 'utf8'))
    const [c] = fixture.cases
    const plan = await newPlan(app, w)
    await putRule(app, w.planadmin, plan.planId, 'cv', { kind: 'volume.personal', params: personal('cv', []) })
    await putRule(app, w.planadmin, plan.planId, 'unilevel', { ...UNILEVEL, params: { ...UNILEVEL.params, measure: 'cv', levels: ['0.08', '0.05', '0.04', '0.04', '0.04'] } })
    const lines = c.expected.lines.map((l: { payeePositionId: string; ruleKey: string; amountMinor: string }) => ({ payee_position_id: l.payeePositionId, rule_key: l.ruleKey, amount_minor: l.amountMinor }))
    const total = lines.reduce((acc: bigint, l: { amount_minor: string }) => acc + BigInt(l.amount_minor), 0n).toString()
    expect(lines.find((l: { payee_position_id: string }) => l.payee_position_id === 'P0').amount_minor).toBe('92500')
    expect((await create(w.planadmin, plan, { name: 'ts01', input: { snapshot: c.input.snapshot, settings: c.input.settings }, expected: { lines, total_minor: total } })).statusCode).toBe(201)
    const ran = await call(app, { method: 'POST', url: `${base(plan.planId)}/run`, as: w.planadmin, idempotencyKey: true })
    expect(ran.json().data).toMatchObject([{ name: 'ts01', status: 'pass', mismatches: [] }])
  })
})
