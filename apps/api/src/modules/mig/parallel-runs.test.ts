// T-B6-46 parallel runs (D-B6-11, AC-28.1 / TS-52 comparison part, AC-MIG2-1/2/3/4): request through COMP's
// requestParallelRunSimulation, comparison by the cron, classification, acceptance, sign-off and the market checklist.
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, runQueuedJobs, testConfig, type TestUser } from '../../../test/helpers/index.js'
import type { TenantJob } from '../../lib/jobs.js'
import { compModule } from '../comp/index.js'
import { tenModule } from '../ten/index.js'
import { migModule } from './index.js'
import { compareParallelRunsJob } from './parallel-runs.js'
import { migrationMarket, migWorld, postedMigration, type MarketFixture, type MigWorld } from './test-support.js'

const simulationJob = compModule.jobs!.find((job) => job.name === 'comp.simulation.run') as TenantJob<unknown>

let app: FastifyInstance
let w: MigWorld
let globex: MigWorld
let at: MarketFixture
let migrationId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [migModule, tenModule] })
  w = await migWorld()
  globex = await migWorld()
  at = await migrationMarket(w, 'AT')
  // The dual user (consultant and Finance approver) creates and submits: it may neither accept its own nor sign off.
  migrationId = await postedMigration(app, w, 'AT', at, w.dual)
}, 120_000)

afterAll(async () => {
  await app.close()
})

const base = () => `/v1/migrations/${migrationId}`
const post = (as: TestUser, url: string, body?: unknown, idempotencyKey = true) =>
  call(app, { method: 'POST', url, as, ...(idempotencyKey ? { idempotencyKey: true as const } : {}), ...(body === undefined ? {} : { body }) })
const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const requestRun = (as: TestUser = w.consultant, bonusMap: Record<string, string> = { unilevel: 'unilevel' }) => post(as, `${base()}/parallel-runs`, { bonus_map: bonusMap })
const compare = () => compareParallelRunsJob.run({ jobId: 'test', log: fastify({ logger: false }).log, config: testConfig() })
type Difference = { id: string; payee_ref: string; rule_key: string | null; bonus_detail: boolean; legacy_minor: string; platform_minor: string; delta_minor: string }
const differences = async (runId: string, filter = 'all') =>
  (await get(w.finance, `${base()}/parallel-runs/${runId}/differences?filter=${filter}`)).json().data as Difference[]

describe('T-B6-46 parallel runs (D-B6-11)', () => {
  let failedRun: string
  let firstRun: string
  let run: string

  test('request refusals: RULE_UNKNOWN, a migration before its opening is posted (409), permissions', async () => {
    const draft = await migrationMarket(w, 'BE', { plan: null })
    const created = await post(w.consultant, '/v1/migrations', { import_batch_id: draft.batchId, cutover_period_id: draft.periods.c, volume_key: 'pv' })

    expect((await requestRun(w.consultant, { unilevel: 'unilevel', retail: 'retail_margin' })).json().error).toMatchObject({ code: 'RULE_UNKNOWN', details: { rule_keys: ['retail_margin'] } })
    expect((await post(w.consultant, `/v1/migrations/${created.json().data.id}/parallel-runs`, { bonus_map: {} })).json().error.code).toBe('MIGRATION_STATE')
    expect((await requestRun(w.finance)).statusCode).toBe(403)
    expect((await requestRun(globex.consultant)).statusCode).toBe(404)
    // BUG-125: the bonus map offers the batch's legacy bonus types of the cutover month before any run.
    expect((await get(w.consultant, base())).json().data.legacy_bonus_types).toEqual(['retail', 'unilevel'])
  })

  test('AC-MIG2-3: a failed simulation ends the parallel run failed with the simulation error code', async () => {
    const requested = await requestRun()
    failedRun = requested.json().data.id
    // FIXTURE: the simulation fails (COMP writes simulations).
    await ownerRows(`UPDATE simulation SET state = 'failed', error = '{"code": "PLAN_CHANGED", "message": "x"}', finished_at = now() WHERE id = $1`, [requested.json().data.simulation_id])
    await compare()

    expect(requested.statusCode).toBe(202)
    expect(requested.json().data).toMatchObject({ state: 'calculating', simulation_id: expect.any(String) })
    expect((await get(w.finance, `${base()}/parallel-runs/${failedRun}`)).json().data).toMatchObject({ state: 'failed', error: { code: 'PLAN_CHANGED' } })
  })

  test('AC-28.1 / TS-52: A 0, B -0.01, C -5.00 payee-level; unexplained 2 refuses sign-off; a newer run supersedes', async () => {
    firstRun = (await requestRun()).json().data.id
    await runQueuedJobs(simulationJob)
    await compare()
    await compare()
    const rows = await differences(firstRun)
    const view = await get(w.finance, `${base()}/parallel-runs/${firstRun}`)
    const signOff = await post(w.finance, `${base()}/sign-off`, { reason: 'All explained' })

    expect(rows.map((d) => [d.payee_ref, d.rule_key, d.bonus_detail, d.legacy_minor, d.platform_minor, d.delta_minor])).toEqual([
      ['AT-A', 'unilevel', true, '2300', '2300', '0'],
      ['AT-B', 'unilevel', true, '2401', '2400', '-1'],
      ['AT-C', null, false, '500', '0', '-500'],
    ])
    expect(view.json().data).toMatchObject({
      state: 'compared', legacy_total_minor: '5201', platform_total_minor: '4700', bonus_detail_missing: true,
      summary: { payees: 3, zero: 1, accepted: 0, unexplained: 2, by_class: { rule: 0, data: 0, rounding: 0, unclassified: 2 } },
    })
    expect((await differences(firstRun, 'mismatches')).map((d) => d.payee_ref)).toEqual(['AT-B', 'AT-C'])
    expect(signOff.json().error).toMatchObject({ code: 'UNEXPLAINED_DIFFERENCES', details: { count: 2 } })
    expect((await auditActions(w.tenantId)).filter((a) => a.startsWith('PARALLEL_RUN.'))).toEqual(expect.arrayContaining(['PARALLEL_RUN.REQUESTED', 'PARALLEL_RUN.FAILED', 'PARALLEL_RUN.COMPARED', 'PARALLEL_RUN.SUPERSEDED']))

    run = (await requestRun()).json().data.id
    await runQueuedJobs(simulationJob)
    await compare()
    const stale = (await differences(firstRun)).find((d) => d.payee_ref === 'AT-B')!
    expect((await get(w.finance, `${base()}/parallel-runs/${firstRun}`)).json().data.state).toBe('superseded')
    expect((await post(w.consultant, `${base()}/parallel-runs/${firstRun}/differences/${stale.id}/classify`, { class: 'rounding', note: 'x' }, false)).json().error.code).toBe('RUN_NOT_CURRENT')
    expect((await get(w.finance, `${base()}/parallel-runs`)).json().data.map((r: { id: string; state: string }) => [r.id, r.state])).toEqual([
      [run, 'compared'], [firstRun, 'superseded'], [failedRun, 'superseded'],
    ])
  })

  test('AC-MIG2-1: classification explains nothing; the classifier cannot accept; Finance accepts; sign-off by the creator is refused, by Finance signs off', async () => {
    const [atA, atB, atC] = await differences(run)
    const classify = (as: TestUser, d: Difference, cls: string) => post(as, `${base()}/parallel-runs/${run}/differences/${d.id}/classify`, { class: cls, note: 'Legacy rounded per line' }, false)
    const accept = (as: TestUser, d: Difference) => post(as, `${base()}/parallel-runs/${run}/differences/${d.id}/accept`, { reason: 'Understood' }, false)

    const zero = await classify(w.consultant, atA!, 'rounding')
    const classifiedB = await classify(w.dual, atB!, 'rounding')
    // A second classifier overwrites classified_by; the first stays barred from accepting (audit history, D-B6-11).
    const overwritten = await classify(w.consultant, atB!, 'rounding')
    await classify(w.consultant, atC!, 'data')
    const stillUnexplained = await post(w.finance, `${base()}/sign-off`, { reason: 'All explained' })
    const selfAccept = await accept(w.dual, atB!)
    const notClassified = await accept(w.finance, atA!)
    const accepted = [await accept(w.finance, atB!), await accept(w.finance, atC!)]
    const again = await accept(w.finance, atB!)
    const reclassify = await classify(w.consultant, atB!, 'rule')
    const byCreator = await post(w.dual, `${base()}/sign-off`, { reason: 'All explained' })
    const checklistBefore = await get(w.admin, `/v1/markets/${at.marketId}/checklist`)
    const signed = await post(w.finance, `${base()}/sign-off`, { reason: 'All explained' })
    const checklistAfter = await get(w.admin, `/v1/markets/${at.marketId}/checklist`)
    const item = (response: typeof signed) => response.json().data.items.find((i: { item: string }) => i.item === 'migration_parallel_run').status

    expect(zero.json().error.code).toBe('DIFFERENCE_ZERO')
    expect(classifiedB.json().data).toMatchObject({ class: 'rounding', classified_by: w.dual.id, accepted_at: null })
    expect(overwritten.json().data).toMatchObject({ class: 'rounding', classified_by: w.consultant.id })
    expect(stillUnexplained.json().error).toMatchObject({ code: 'UNEXPLAINED_DIFFERENCES', details: { count: 2 } })
    expect(selfAccept.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01', eligible_approvers: expect.arrayContaining([expect.objectContaining({ user_id: w.finance.id })]) } })
    expect(notClassified.json().error.code).toBe('NOT_CLASSIFIED')
    expect(accepted.map((r) => r.json().data.accepted_at)).toEqual([expect.any(String), expect.any(String)])
    expect(again.json().error.code).toBe('DIFFERENCE_ACCEPTED')
    expect(reclassify.json().error.code).toBe('DIFFERENCE_ACCEPTED')
    expect(byCreator.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL' })
    expect(item(checklistBefore)).toBe('missing')
    expect(signed.statusCode, signed.body).toBe(200)
    expect(signed.json().data).toMatchObject({ state: 'signed_off', signoff: { by: { id: w.finance.id } }, latest_parallel_run: { id: run, state: 'compared', unexplained: 0 } })
    expect(item(checklistAfter)).toBe('complete')
    expect((await get(w.finance, `${base()}/parallel-runs/${run}`)).json().data.summary).toMatchObject({ accepted: 2, unexplained: 0, by_class: { rounding: 1, data: 1 } })
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['PARALLEL_DIFFERENCE.CLASSIFIED', 'PARALLEL_DIFFERENCE.ACCEPTED', 'MIGRATION.SIGNED_OFF', 'APPROVAL.REFUSED']))
  })

  test('reads need a migration permission over the market; another tenant sees 404', async () => {
    for (const url of [`${base()}/parallel-runs`, `${base()}/parallel-runs/${run}`, `${base()}/parallel-runs/${run}/differences`]) {
      expect([(await get(w.executive, url)).statusCode, (await get(globex.finance, url)).statusCode], url).toEqual([403, 404])
    }
    const someDifference = (await differences(run))[1]!
    const difference = `${base()}/parallel-runs/${run}/differences/${(await differences(run))[1]!.id}`
    expect((await post(globex.consultant, `${difference}/classify`, { class: 'data', note: 'x' }, false)).statusCode).toBe(404)
    expect((await post(w.finance, `${difference}/classify`, { class: 'data', note: 'x' }, false)).statusCode).toBe(403)
    expect((await post(globex.finance, `${difference}/accept`, { reason: 'x' }, false)).statusCode).toBe(404)
    expect((await post(w.consultant, `${difference}/accept`, { reason: 'x' }, false)).statusCode).toBe(403)
    expect((await post(globex.finance, `${base()}/sign-off`, { reason: 'x' })).statusCode).toBe(404)
    expect((await post(w.consultant, `${base()}/sign-off`, { reason: 'x' })).statusCode).toBe(403)
  })
})
