import { randomUUID } from 'node:crypto'
import { stringifyEngineJson } from '@nmp/engine'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, ownerRows, resetApiDb, runQueuedJobs, type TestUser } from '../../../test/helpers/index.js'
import { compModule } from './index.js'
import { simulationJob } from './simulations.js'
import { activePlan, calculate, commit, createWorld, inside, member, order, ts10Plan, user, type Member, type World } from './test-support.js'

// FR-PLN-004 preview / FR-PLN-005 (D-B3-15): T-B3-11 cap preview, T-B3-12 lifecycle and reconciliation, T-B3-13 isolation.

let app: FastifyInstance
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule] })
})

afterAll(async () => {
  await app.close()
})

interface Setup { w: World; a: Member; c: Member; planId: string; admin: TestUser }

/** TS-10 period 0 committed under version 1; period 1 has an order but is not committed. */
async function setup(): Promise<Setup> {
  const w = await createWorld()
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  const { planId } = await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  await order(w, a, inside(w.periods[0]!, 2), 50_000)
  await commit(app, w, await calculate(app, w, w.periods[0]!.id))
  await order(w, a, inside(w.periods[1]!), 10_000)
  return { w, a, c, planId, admin: await user(w.tenantId, ['Plan administrator']) }
}

/** A draft version 2 of the plan with a compiled document (what PLN stores while the draft validates); state items carry over. */
async function draft(s: Setup, base = ts10Plan({ capRate: '0.05' })): Promise<string> {
  const id = randomUUID()
  const carry = (stateItem: string) => ({ stateItem, rule: 'carry' as const, map: [], reason: null })
  const plan = { ...base, transitions: [carry('title.*'), carry('paid_as.*')] }
  const compiled = JSON.parse(stringifyEngineJson({ [s.w.calendarId]: { ...plan, planVersionId: id, calendars: [s.w.calendarId] } })) as unknown
  await ownerRows(
    `INSERT INTO plan_version (id, tenant_id, plan_id, version, engine_version, compiled, created_by) VALUES ($1, $2, $3, 2, '0.2.0', $4, $5)`,
    [id, s.w.tenantId, s.planId, compiled, s.admin.id])
  return id
}

const simulate = (as: TestUser, planVersionId: string, periodId: string) =>
  call(app, { method: 'POST', url: '/v1/simulations', as, idempotencyKey: true, body: { plan_version_id: planVersionId, period_id: periodId } })

const counts = (tenantId: string) => ownerRows<Record<string, string>>(
  `SELECT (SELECT count(*) FROM result_line WHERE tenant_id = $1)::text AS lines, (SELECT count(*) FROM qualification_state WHERE tenant_id = $1)::text AS states,
          (SELECT count(*) FROM adjustment_origin WHERE tenant_id = $1)::text AS origins, (SELECT count(*) FROM outbox_event WHERE tenant_id = $1)::text AS outbox,
          (SELECT string_agg(state, ',' ORDER BY starts_at) FROM period WHERE tenant_id = $1) AS periods`, [tenantId])

describe('simulations (D-B3-15)', () => {
  test('AC-10.1 / T-B3-11 / T-B3-12 / AC-SIM-2: a draft on a committed period: totals reconcile, by rule, distribution, cap effects; nothing else written', async () => {
    const s = await setup()
    const versionId = await draft(s)
    const before = await counts(s.w.tenantId)

    const requested = await simulate(s.admin, versionId, s.w.periods[0]!.id)
    expect(requested.statusCode).toBe(202)
    expect(requested.json().data).toMatchObject({ plan_version_id: versionId, period_id: s.w.periods[0]!.id, kind: 'simulation', state: 'queued' })
    await runQueuedJobs(simulationJob)

    const detail = await call(app, { method: 'GET', url: `/v1/simulations/${requested.json().data.id}`, as: s.admin })
    expect(detail.statusCode).toBe(200)
    const data = detail.json().data
    expect(data.simulation).toMatchObject({ state: 'completed', baseline_run_id: expect.any(String) })
    expect(data.totals.baseline_minor).toBe('9600')
    expect(BigInt(data.totals.simulated_minor) + -BigInt(data.totals.baseline_minor)).toBe(BigInt(data.totals.delta_minor))
    const [sum] = await ownerRows<{ total: string }>('SELECT coalesce(sum(amount_minor), 0)::text AS total FROM sim_result_line WHERE simulation_id = $1', [requested.json().data.id])
    expect(data.totals.simulated_minor).toBe(sum!.total)
    expect(data.comparison.reconciles).toBe(true)
    expect(data.comparison.by_rule).toContainEqual(expect.objectContaining({ rule_key: 'rank_bonus', baseline_minor: '8000', simulated_minor: '4000', delta_minor: '-4000' }))
    expect(data.comparison.cap_effects).toEqual([{
      cap_key: 'company_cap', method: 'proportional', base_minor: '80000', cap_minor: '4000', proposed_minor: '8000', bound: true,
      affected: [{ payee_position_id: s.a.positionId, rule_key: 'rank_bonus', before_minor: '8000', after_minor: '4000' }],
    }])
    expect(data.comparison.distribution.find((d: { bucket: string }) => d.bucket === '<-10%').payees).toBeGreaterThanOrEqual(1)
    expect(data.comparison.guardrail_flags).toEqual([])
    expect(await counts(s.w.tenantId)).toEqual(before)

    const payees = await call(app, { method: 'GET', url: `/v1/simulations/${requested.json().data.id}/payees?limit=1`, as: s.admin })
    expect(payees.json().data[0]).toMatchObject({ participant: { id: s.a.participantId }, baseline_minor: '8000', simulated_minor: '4000', delta_minor: '-4000' })
    expect(payees.json().meta.next_cursor).not.toBeNull()
    const csv = await call(app, { method: 'GET', url: `/v1/simulations/${requested.json().data.id}/payees?format=csv`, as: s.admin })
    expect(csv.body.split('\r\n')[0]).toBe('participant_id,external_ref,baseline_minor,simulated_minor,delta_minor')
    const list = await call(app, { method: 'GET', url: `/v1/simulations?plan_version_id=${versionId}`, as: s.admin })
    expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([requested.json().data.id])
  })

  test('an ended period not committed uses a fresh snapshot; without a committed prior state it warns PRIOR_STATE_ABSENT', async () => {
    const s = await setup()
    const versionId = await draft(s)
    const fresh = await simulate(s.admin, versionId, s.w.periods[1]!.id)
    const absent = await simulate(s.admin, versionId, s.w.periods[2]!.id)
    await runQueuedJobs(simulationJob)
    const freshDetail = (await call(app, { method: 'GET', url: `/v1/simulations/${fresh.json().data.id}`, as: s.admin })).json().data
    expect(freshDetail.simulation.error).toBeNull()
    expect(freshDetail).toMatchObject({ simulation: { state: 'completed', baseline_run_id: null }, totals: { baseline_minor: null, delta_minor: null } })
    expect(freshDetail.comparison.distribution.find((d: { bucket: string }) => d.bucket === 'new').payees).toBeGreaterThan(0)
    const absentDetail = (await call(app, { method: 'GET', url: `/v1/simulations/${absent.json().data.id}`, as: s.admin })).json().data
    expect(absentDetail.warnings).toContainEqual(expect.objectContaining({ code: 'PRIOR_STATE_ABSENT' }))
  })

  test('PRIOR_STATE_ABSENT also at a chain start (previous period without a plan version); the lifecycle is audited', async () => {
    const w = await createWorld()
    await member(w, 'DE-A')
    const { versionId } = await activePlan(w, ts10Plan(), w.periods[1]!.starts_at)
    const admin = await user(w.tenantId, ['Plan administrator'])
    const requested = await simulate(admin, versionId, w.periods[1]!.id)
    expect(requested.statusCode, requested.body).toBe(202)
    await runQueuedJobs(simulationJob)
    const detail = (await call(app, { method: 'GET', url: `/v1/simulations/${requested.json().data.id}`, as: admin })).json().data
    expect(detail.simulation.state).toBe('completed')
    expect(detail.warnings).toContainEqual(expect.objectContaining({ code: 'PRIOR_STATE_ABSENT' }))
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['SIMULATION.REQUESTED', 'SIMULATION.COMPLETED']))
    const [job] = await ownerRows<{ expire: string }>(
      `SELECT expire_in::text AS expire FROM pgboss.job WHERE name = $1 AND data -> 'payload' ->> 'simulationId' = $2`, [simulationJob.name, requested.json().data.id])
    expect(job!.expire).toBe('01:15:00')
  })

  test('AC-SIM-1: period not ended, version without compiled, calendar outside the plan; a draft changed after the request fails', async () => {
    const s = await setup()
    const versionId = await draft(s)
    expect((await simulate(s.admin, versionId, s.w.periods.at(-1)!.id)).json().error.code).toBe('PERIOD_NOT_ENDED')
    const other = await createWorld()
    expect((await simulate(s.admin, versionId, other.periods[0]!.id)).statusCode).toBe(404)
    const [cal] = await ownerRows<{ id: string }>(
      `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start) VALUES ($1, $2, 'Other', 'monthly', 'Europe/Berlin', '2025-01-01') RETURNING id`,
      [s.w.tenantId, s.w.marketId])
    const [outside] = await ownerRows<{ id: string }>(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at) VALUES ($1, $2, '2025-01-01', '2025-02-01') RETURNING id`, [s.w.tenantId, cal!.id])
    expect((await simulate(s.admin, versionId, outside!.id)).json().error.code).toBe('CALENDAR_NOT_IN_PLAN')
    const requested = await simulate(s.admin, versionId, s.w.periods[0]!.id)
    await ownerRows(`UPDATE plan_version SET compiled = NULL WHERE id = $1`, [versionId])
    expect((await simulate(s.admin, versionId, s.w.periods[0]!.id)).json().error.code).toBe('PLAN_INVALID')
    await runQueuedJobs(simulationJob)
    const [failed] = await ownerRows<{ state: string; error: { code: string } }>('SELECT state, error FROM simulation WHERE id = $1', [requested.json().data.id])
    expect(failed).toEqual({ state: 'failed', error: expect.objectContaining({ code: 'PLAN_CHANGED' }) })
    expect((await call(app, { method: 'POST', url: '/v1/simulations', as: s.admin, idempotencyKey: true, body: { plan_version_id: versionId } })).statusCode).toBe(400)
  })

  test('AC-SIM-3, permissions and tenant isolation: sandboxes are not simulations; plan.simulate/plan.read; plan markets in scope', async () => {
    const s = await setup()
    const versionId = await draft(s)
    const requested = await simulate(s.admin, versionId, s.w.periods[0]!.id)
    await runQueuedJobs(simulationJob)
    const id = requested.json().data.id as string
    const [sandbox] = await ownerRows<{ id: string }>(
      `INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, content_hash, requested_by)
       SELECT tenant_id, id, $2, 'restatement_sandbox', digest(compiled::text, 'sha256'), $3 FROM plan_version WHERE id = $1 RETURNING id`,
      [versionId, s.w.periods[0]!.id, s.admin.id])
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${sandbox!.id}`, as: s.admin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/simulations', as: s.admin })).json().data.map((x: { id: string }) => x.id)).toEqual([id])
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}`, as: s.w.analyst })).statusCode).toBe(200)
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}/payees`, as: s.w.analyst })).statusCode).toBe(403)
    expect((await simulate(s.w.analyst, versionId, s.w.periods[0]!.id)).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/simulations', as: await user(s.w.tenantId, ['Payout officer']) })).statusCode).toBe(403)
    const other = await createWorld()
    const otherAdmin = await user(other.tenantId, ['Plan administrator'])
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}`, as: otherAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}/payees`, as: otherAdmin })).statusCode).toBe(404)
    expect((await simulate(otherAdmin, versionId, s.w.periods[0]!.id)).statusCode).toBe(404)
    const scoped = await user(s.w.tenantId, ['Plan administrator'], [other.marketId])
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}`, as: scoped })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/simulations', as: scoped })).json().data).toEqual([])

    // D-B3-23: plan.read over one plan market and plan.simulate over the other is neither permission over the plan.
    const gb = await createMarket(s.w.tenantId)
    await ownerRows('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [s.w.tenantId, s.planId, gb])
    const split = await createSignedInUser({ tenantId: s.w.tenantId, stepUp: true })
    for (const [permission, market] of [['plan.read', s.w.marketId], ['plan.simulate', gb]] as const) {
      await ownerRows(
        `WITH r AS (INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, $2, $3, false, true) RETURNING id)
         INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from) SELECT $1, $4, r.id, $5, now() FROM r`,
        [s.w.tenantId, `split ${permission} ${randomUUID().slice(0, 8)}`, [permission], split.id, [market]])
    }
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}`, as: split })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/simulations', as: split })).json().data).toEqual([])
    const both = await user(s.w.tenantId, ['Plan administrator'], [s.w.marketId, gb])
    expect((await call(app, { method: 'GET', url: `/v1/simulations/${id}`, as: both })).statusCode).toBe(200)
    expect((await call(app, { method: 'GET', url: '/v1/simulations', as: both })).json().data.map((x: { id: string }) => x.id)).toEqual([id])
  })
})
