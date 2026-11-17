import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, runQueuedJobs, testConfig } from '../../../test/helpers/index.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { runTenantJob } from '../../lib/jobs.js'
import { compModule } from './index.js'
import { loadPeriod } from './period.js'
import { prepareRun, calculateRunJob } from './runs.js'
import { buildSnapshot } from './snapshot.js'
import {
  activePlan, calculate, commit, createWorld, inside, linesOf, member, order, ts10Plan, user, type Member, type World,
} from './test-support.js'

// The engine throws a transient SQLSTATE while `transient` is set (a database error the queue would retry).
const engineFault = vi.hoisted(() => ({ transient: false }))
vi.mock('@nmp/engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('@nmp/engine')>()
  return {
    ...engine,
    run: (...args: Parameters<typeof engine.run>) => {
      if (engineFault.transient) throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' })
      return engine.run(...args)
    },
  }
})

let app: FastifyInstance
closePoolsAfterAll()
const SYSTEM_ACTOR = { actorType: 'system' as const, requestId: null, supportSessionId: null }

const requestRun = (w: World, periodId: string, requestId: string = randomUUID(), as = w.analyst) =>
  call(app, { method: 'POST', url: `/v1/periods/${periodId}/runs`, as, headers: { 'run-request-id': requestId } })

interface Ts10 { w: World; a: Member; c: Member }

/** TS-10 shape: C sponsors A; A buys 300.00 and 500.00 in the first period. Plan active from the first period. */
async function ts10World(options: Parameters<typeof ts10Plan>[0] = {}): Promise<Ts10> {
  const w = await createWorld()
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(options), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  await order(w, a, inside(w.periods[0]!, 2), 50_000)
  return { w, a, c }
}

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule] })
})

afterAll(async () => {
  await app.close()
})

describe('POST /v1/periods/:id/runs and the worker (FR-COMP-002)', () => {
  test('a run calculates the TS-10 period: lines, totals = Σ lines, state rows, period calculated (AC-COMP3-1)', async () => {
    const { w, a, c } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)

    expect(await linesOf(runId)).toEqual(expect.arrayContaining([
      { position: a.positionId, rule: 'rank_bonus', amount: '8000', origin: null },
      { position: c.positionId, rule: 'match', amount: '1600', origin: null },
    ]))
    const [run] = await ownerRows<{ state: string; totals: { gross_minor: string }; snapshot_id: string; period_state: string }>(
      `SELECT r.state, r.totals, r.snapshot_id, p.state AS period_state FROM run r JOIN period p ON p.id = r.period_id WHERE r.id = $1`, [runId])
    expect(run).toMatchObject({ state: 'calculated', totals: { gross_minor: '9600' }, period_state: 'calculated' })
    const states = await ownerRows('SELECT position_id FROM qualification_state WHERE run_id = $1', [runId])
    expect(states).toHaveLength(2)
    const [snapshot] = await ownerRows<{ row_counts: Record<string, unknown> }>('SELECT row_counts FROM run_snapshot WHERE id = $1', [run!.snapshot_id])
    expect(snapshot!.row_counts).toMatchObject({ orders: 2, positions: 2, late_item_ids: [] })
    const detail = await call(app, { method: 'GET', url: `/v1/runs/${runId}`, as: w.analyst })
    expect(detail.json().data).toMatchObject({ id: runId, state: 'calculated', snapshot: { row_counts: { orders: 2 } } })
    expect(detail.json().data.snapshot.row_counts.late_item_ids).toBeUndefined()
  })

  test('TS-14 / AC-06.3: two concurrent requests on two connections make one run; the same Run-Request-Id replays it', async () => {
    const { w } = await ts10World()
    const period = w.periods[0]!.id
    const [first, second] = await Promise.all([requestRun(w, period), requestRun(w, period)])
    expect([first.statusCode, second.statusCode]).toEqual([202, 202])
    expect(first.json().data.run_id).toBe(second.json().data.run_id)
    expect([first.json().meta.replayed, second.json().meta.replayed].sort()).toEqual([false, true])
    expect(await ownerRows('SELECT id FROM run WHERE period_id = $1', [period])).toHaveLength(1)
    await runQueuedJobs(calculateRunJob)
    const again = await requestRun(w, period, (await ownerRows<{ run_request_id: string }>('SELECT run_request_id FROM run WHERE period_id = $1', [period]))[0]!.run_request_id)
    expect(again.json()).toMatchObject({ data: { run_id: first.json().data.run_id, state: 'calculated' }, meta: { replayed: true } })
  })

  test('T-B3-17 / AC-COMP2-1: preflight refusals in §2.4 order, and the chain start', async () => {
    const w = await createWorld()
    const [p0, p1, p2] = w.periods
    const future = w.periods.at(-1)!
    expect((await requestRun(w, p0!.id)).json().error.code).toBe('PLAN_VERSION_MISSING')
    // A plan starting at p1: p0 is uncovered, so p1 is the chain start and p0 never blocks.
    await activePlan(w, ts10Plan(), p1!.starts_at)
    expect((await requestRun(w, future.id)).json().error.code).toBe('BEFORE_CUTOFF')
    expect((await requestRun(w, p2!.id)).json().error).toMatchObject({ code: 'PRIOR_PERIOD_OPEN', details: { period_id: p1!.id } })
    const runId = await calculate(app, w, p1!.id)
    await commit(app, w, runId)
    expect((await requestRun(w, p1!.id)).statusCode).toBe(409)
    expect((await requestRun(w, p1!.id)).json().error.code).toBe('PERIOD_COMMITTED')
    expect((await requestRun(w, p2!.id)).statusCode).toBe(202)
  })

  test('PRIOR_STATE_MISSING: a committed previous period without a run (migration needed)', async () => {
    const w = await createWorld()
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    // Owner pool: a period committed outside COMP (the one fixture that needs a committed period without a run).
    await getOwnerPool().query(`UPDATE period SET state = 'committed' WHERE id = $1`, [w.periods[0]!.id])
    const refused = await requestRun(w, w.periods[1]!.id)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'PRIOR_STATE_MISSING', details: { period_id: w.periods[0]!.id } })
  })

  test('E-PER-08: a period with no orders completes with zero lines, state rows for every position, and commits', async () => {
    const w = await createWorld()
    const c = await member(w, 'DE-C')
    await member(w, 'DE-A', c)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    const runId = await calculate(app, w, w.periods[0]!.id)
    expect(await linesOf(runId)).toEqual([])
    expect(await ownerRows('SELECT 1 FROM qualification_state WHERE run_id = $1', [runId])).toHaveLength(2)
    await commit(app, w, runId)
    expect(await ownerRows(`SELECT 1 FROM period WHERE id = $1 AND state = 'committed' AND committed_run_id = $2`, [w.periods[0]!.id, runId])).toHaveLength(1)
  })

  test('AC-COMP2-2: a crash after tx A resumes from the stored snapshot; an engine error fails the run with its code', async () => {
    const { w } = await ts10World()
    const accepted = await requestRun(w, w.periods[0]!.id)
    const runId = accepted.json().data.run_id
    await runInTenant({ tenantId: w.tenantId, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: null, supportSessionId: null },
      (tx) => prepareRun(tx, runId))
    const [before] = await ownerRows<{ snapshot_id: string; state: string }>('SELECT snapshot_id, state FROM run WHERE id = $1', [runId])
    expect(before!.state).toBe('running')
    await runQueuedJobs(calculateRunJob)
    const [after] = await ownerRows<{ snapshot_id: string; state: string }>('SELECT snapshot_id, state FROM run WHERE id = $1', [runId])
    expect(after).toEqual({ snapshot_id: before!.snapshot_id, state: 'calculated' })
    expect(await ownerRows('SELECT 1 FROM run_snapshot WHERE period_id = $1', [w.periods[0]!.id])).toHaveLength(1)

    // A plan whose bonus names an unknown measure: the engine refuses it; first run -> period open, no lines.
    const bad = await createWorld()
    const plan = ts10Plan()
    await activePlan(bad, { ...plan, bonuses: [{ ...plan.bonuses[0]!, measure: 'missing' } as (typeof plan.bonuses)[number]] }, bad.periods[0]!.starts_at)
    const failedRun = await calculate(app, bad, bad.periods[0]!.id)
    const [failed] = await ownerRows<{ state: string; error: { code: string }; period_state: string }>(
      `SELECT r.state, r.error, p.state AS period_state FROM run r JOIN period p ON p.id = r.period_id WHERE r.id = $1`, [failedRun])
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'INVALID_INPUT' }, period_state: 'open' })
    expect(await linesOf(failedRun)).toEqual([])
  })

  test('AC-COMP12-2: an amount beyond 64 bits fails the run with OVERFLOW', async () => {
    const w = await createWorld()
    await member(w, 'DE-A')
    await member(w, 'DE-B')
    const plan = ts10Plan()
    const flat = { key: 'flat', kind: 'pay.flat', amountMinor: 9_000_000_000_000_000_000n, sourceKind: 'other', reversalPolicy: 'restatement', eligibleIf: null } as const
    await activePlan(w, { ...plan, bonuses: [flat] }, w.periods[0]!.starts_at)
    const runId = await calculate(app, w, w.periods[0]!.id)
    const [failed] = await ownerRows<{ state: string; error: { code: string } }>('SELECT state, error FROM run WHERE id = $1', [runId])
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'OVERFLOW' } })
  })

  test('a re-run discards the earlier calculated run', async () => {
    const { w } = await ts10World()
    const first = await calculate(app, w, w.periods[0]!.id)
    const second = await calculate(app, w, w.periods[0]!.id)
    expect(await ownerRows<{ id: string; state: string }>('SELECT id, state FROM run WHERE period_id = $1 ORDER BY created_at', [w.periods[0]!.id]))
      .toEqual([{ id: first, state: 'discarded' }, { id: second, state: 'calculated' }])
  })

  test('E-PER-06: an order ingested while the run calculates is not in its snapshot but is in the next calculation', async () => {
    const { w, a } = await ts10World()
    const accepted = await requestRun(w, w.periods[0]!.id)
    const runId = accepted.json().data.run_id
    await runInTenant({ tenantId: w.tenantId, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: null, supportSessionId: null },
      (tx) => prepareRun(tx, runId))
    await order(w, a, inside(w.periods[0]!, 3), 10_000)
    await runQueuedJobs(calculateRunJob)
    expect((await linesOf(runId)).find((l) => l.rule === 'rank_bonus')!.amount).toBe('8000')
    const rerun = await calculate(app, w, w.periods[0]!.id)
    expect((await linesOf(rerun)).find((l) => l.rule === 'rank_bonus')!.amount).toBe('9000')
  })

  test('TS-62 / E-PER-02: orders 1 s around a Berlin cut-off land in the period containing credited_at, once', async () => {
    const w = await createWorld()
    const a = await member(w, 'DE-A')
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    const cut = w.periods[1]!.starts_at
    await order(w, a, new Date(cut.getTime() - 1000), 10_000)
    await order(w, a, new Date(cut.getTime() + 1000), 20_000)
    const first = await calculate(app, w, w.periods[0]!.id)
    await commit(app, w, first)
    const second = await calculate(app, w, w.periods[1]!.id)
    expect((await linesOf(first)).map((l) => l.amount)).toEqual(['500'])
    expect((await linesOf(second)).map((l) => l.amount)).toEqual(['1000'])
    // Calendar periods are [local midnight, local midnight) in Europe/Berlin, also across a DST change.
    const local = await ownerRows<{ starts: string }>(
      `SELECT to_char(starts_at AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS starts FROM period WHERE calendar_id = $1`, [w.calendarId])
    expect(new Set(local.map((p) => p.starts))).toEqual(new Set(['00:00']))
  })

  test('TS-62: a weekly and a monthly calendar of one market each take the orders inside their own periods', async () => {
    const w = await createWorld()
    const a = await member(w, 'DE-A')
    const weekly = await ownerRows<{ id: string }>(
      `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
       VALUES ($1, $2, 'DE weekly', 'weekly', 'Europe/Berlin', $3::date) RETURNING id`,
      [w.tenantId, w.marketId, w.periods[0]!.starts_at.toISOString().slice(0, 10)])
    const week = await ownerRows<{ id: string; starts_at: Date }>(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at) VALUES ($1, $2, $3, $3::timestamptz + interval '7 days') RETURNING id, starts_at`,
      [w.tenantId, weekly[0]!.id, w.periods[0]!.starts_at])
    const plan = await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await ownerRows('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [w.tenantId, plan.planId, weekly[0]!.id])
    await ownerRows(
      `UPDATE plan_version SET compiled = compiled || jsonb_build_object($2::text, compiled -> $3::text),
         content_hash = digest((compiled || jsonb_build_object($2::text, compiled -> $3::text))::text, 'sha256') WHERE id = $1`,
      [plan.versionId, weekly[0]!.id, w.calendarId])
    const weekEnd = new Date(week[0]!.starts_at.getTime() + 7 * 86_400_000)
    await order(w, a, new Date(weekEnd.getTime() - 1000), 10_000)
    await order(w, a, new Date(weekEnd.getTime() + 1000), 20_000)
    const weeklyRun = await calculate(app, w, week[0]!.id)
    const monthlyRun = await calculate(app, w, w.periods[0]!.id)
    expect((await linesOf(weeklyRun)).map((l) => l.amount)).toEqual(['500'])
    expect((await linesOf(monthlyRun)).map((l) => l.amount)).toEqual(['1500'])
  })

  test('validation, permission and tenant isolation', async () => {
    const { w } = await ts10World()
    const other = await createWorld()
    expect((await call(app, { method: 'POST', url: `/v1/periods/${w.periods[0]!.id}/runs`, as: w.analyst })).json().error.code)
      .toBe('RUN_REQUEST_ID_REQUIRED')
    expect((await requestRun(w, 'not-a-uuid')).statusCode).toBe(400)
    expect((await requestRun(w, w.periods[0]!.id, randomUUID(), w.finance)).statusCode).toBe(403)
    expect((await requestRun(w, other.periods[0]!.id)).statusCode).toBe(404)
    const scoped = await user(w.tenantId, ['Commission analyst'], [other.marketId])
    expect((await requestRun(w, w.periods[0]!.id, randomUUID(), scoped)).statusCode).toBe(404)
  })
})

describe('GET /v1/periods and /v1/periods/:id', () => {
  test('lists calendars and periods with blockers, latest run and late counts; detail adds runs, plan version and sync', async () => {
    const { w } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)
    const list = await call(app, { method: 'GET', url: `/v1/periods?calendar_id=${w.calendarId}&limit=50`, as: w.analyst })
    expect(list.statusCode).toBe(200)
    const { calendars, periods } = list.json().data
    expect(calendars).toEqual([expect.objectContaining({ id: w.calendarId, market: { id: w.marketId, code: 'DE' }, plan: expect.objectContaining({ name: expect.any(String) }) })])
    const first = periods.find((p: { id: string }) => p.id === w.periods[0]!.id)
    expect(first).toMatchObject({ state: 'calculated', cut_off_passed: true, latest_run: { id: runId, state: 'calculated', gross_minor: '9600' }, late: { pending: 0, decided: 0 } })
    expect(periods.find((p: { id: string }) => p.id === w.periods[1]!.id).blockers.map((b: { code: string }) => b.code)).toEqual(['PRIOR_PERIOD_OPEN'])
    expect(periods.at(0).blockers.map((b: { code: string }) => b.code)).toContain('BEFORE_CUTOFF')
    const page = await call(app, { method: 'GET', url: `/v1/periods?calendar_id=${w.calendarId}&limit=2`, as: w.analyst })
    const next = await call(app, { method: 'GET', url: `/v1/periods?calendar_id=${w.calendarId}&limit=2&cursor=${page.json().meta.next_cursor}`, as: w.analyst })
    expect(next.json().data.periods[0].starts_at < page.json().data.periods[1].starts_at).toBe(true)

    const detail = await call(app, { method: 'GET', url: `/v1/periods/${w.periods[0]!.id}`, as: w.analyst })
    expect(detail.json().data).toMatchObject({
      runs: [{ id: runId, state: 'calculated', gross_minor: '9600' }], plan_version: { version: 1 },
      sync: { state: 'thresholds_not_set' }, late: { pending: 0, decided: 0, consumed: 0 }, restatements: [],
    })
    expect((await call(app, { method: 'GET', url: '/v1/periods?state=bogus', as: w.analyst })).statusCode).toBe(400)
    const other = await createWorld()
    expect((await call(app, { method: 'GET', url: `/v1/periods/${other.periods[0]!.id}`, as: w.analyst })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/periods', as: w.analyst })).json().data.calendars).toHaveLength(1)
    const outsider = await user(w.tenantId, ['Payout officer'])
    expect((await call(app, { method: 'GET', url: '/v1/periods', as: outsider })).statusCode).toBe(403)
  })

  test('TS-58 / AC-06.2: a failing relevant source blocks the run with SYNC_BEHIND; the period stays open', async () => {
    const { w } = await ts10World()
    await ownerRows(
      `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
       VALUES ($1, 'api:fixture', 'order:rejected', sha256('x'::bytea), now(), 'rejected', $2, 'system')`, [w.tenantId, w.analyst.id])
    const refused = await requestRun(w, w.periods[0]!.id)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'SYNC_BEHIND', details: { sources: [expect.objectContaining({ source: 'api:fixture', state: 'failing' })] } })
    expect(refused.json().error.details.last_sync_at).not.toBeNull()
    expect(await ownerRows(`SELECT 1 FROM period WHERE id = $1 AND state = 'open'`, [w.periods[0]!.id])).toHaveLength(1)
    // A quiet API source of another market does not block: it never delivered an order of DE.
    const other = await createWorld()
    expect((await call(app, { method: 'GET', url: `/v1/periods/${other.periods[0]!.id}`, as: other.analyst })).json().data.sync.state).toBe('none')
  })
})

describe('database guards the run relies on (T-B3-15, T-B3-19, AC-46.2)', () => {
  test('illegal period transitions, lines outside running, state writes are refused for nmp_app', async () => {
    const { w } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)
    const asApp = (sql: string, params: unknown[]) => withTenant({ tenantId: w.tenantId, userId: w.analyst.id }, (tx) => tx.query(sql, params))
      .then(() => null, (e: { code: string }) => e.code)
    expect(await asApp(`UPDATE period SET state = 'committed' WHERE id = $1`, [w.periods[0]!.id])).toBe('23514')
    expect(await asApp(`UPDATE period SET state = 'calculating' WHERE id = $1`, [w.periods[1]!.id])).toBeNull()
    expect(await asApp(`UPDATE period SET state = 'paid' WHERE id = $1`, [w.periods[2]!.id])).toBe('23514')
    expect(await asApp(`UPDATE qualification_state SET counters = '[]' WHERE run_id = $1`, [runId])).toBe('42501')
    expect(await asApp(`DELETE FROM result_line WHERE run_id = $1`, [runId])).toBe('42501')
    const extra = await member(w, 'DE-X')
    expect(await asApp(
      `INSERT INTO qualification_state (tenant_id, run_id, position_id, paid_as_rank, highest_titles, grace_used, counters, carry, one_time_flags, banked, measures)
       VALUES (app_tenant_id(), $1, $2, '[]', '[]', '[]', '[]', '[]', '{}', '[]', '[]')`, [runId, extra.positionId])).toBe('23514')
    expect((await call(app, { method: 'POST', url: `/v1/positions/${extra.positionId}/qualification`, as: w.analyst })).statusCode).toBe(404)
    expect((await call(app, { method: 'PATCH', url: `/v1/positions/${extra.positionId}/qualification`, as: w.analyst })).statusCode).toBe(404)
  })
})

describe('run jobs pg-boss gives up on (RUN_RETRIES_EXHAUSTED)', () => {
  const jobOf = async (runId: string) => (await ownerRows<{ id: string; data: unknown; expire: string }>(
    `SELECT id, data, expire_in::text AS expire FROM pgboss.job WHERE name = $1 AND data -> 'payload' ->> 'runId' = $2`,
    [calculateRunJob.name, runId]))[0]!
  const runJob = (raw: { id: string; data: unknown }) => runTenantJob(calculateRunJob, raw, { config: testConfig(), log: fastify({ logger: false }).log })

  test('a transient failure is retried until the last attempt, which fails the run and reopens the period; the job outlives a 60-minute run', async () => {
    const { w } = await ts10World()
    const runId = (await requestRun(w, w.periods[0]!.id)).json().data.run_id
    const job = await jobOf(runId)
    expect(job.expire).toBe('01:15:00')
    engineFault.transient = true
    try {
      await expect(runJob(job)).rejects.toMatchObject({ code: '40001' })
      expect(await ownerRows(`SELECT 1 FROM run WHERE id = $1 AND state = 'running'`, [runId])).toHaveLength(1)
      await ownerRows('UPDATE pgboss.job SET retry_count = retry_limit WHERE name = $1 AND id = $2', [calculateRunJob.name, job.id])
      await runJob(job)
    } finally {
      engineFault.transient = false
      await ownerRows(`UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE name = $1 AND id = $2`, [calculateRunJob.name, job.id])
    }
    const [failed] = await ownerRows<{ state: string; error: { code: string }; period_state: string }>(
      `SELECT r.state, r.error, p.state AS period_state FROM run r JOIN period p ON p.id = r.period_id WHERE r.id = $1`, [runId])
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'RUN_RETRIES_EXHAUSTED' }, period_state: 'open' })
  })

  test('a run whose job pg-boss failed (worker lost on every attempt) is failed by the next request, which starts a new run', async () => {
    const { w } = await ts10World()
    const period = w.periods[0]!.id
    const stuck = (await requestRun(w, period)).json().data.run_id
    expect((await requestRun(w, period)).json()).toMatchObject({ data: { run_id: stuck }, meta: { replayed: true } })
    await ownerRows(`UPDATE pgboss.job SET state = 'failed', completed_on = now() WHERE name = $1 AND data -> 'payload' ->> 'runId' = $2`,
      [calculateRunJob.name, stuck])

    const next = await requestRun(w, period)
    expect(next.statusCode).toBe(202)
    expect(next.json()).toMatchObject({ data: { state: 'queued' }, meta: { replayed: false } })
    expect(next.json().data.run_id).not.toBe(stuck)
    expect(await ownerRows<{ state: string; error: { code: string } }>('SELECT state, error FROM run WHERE id = $1', [stuck]))
      .toEqual([expect.objectContaining({ state: 'failed', error: expect.objectContaining({ code: 'RUN_RETRIES_EXHAUSTED' }) })])
    expect(await auditActions(w.tenantId)).toContain('RUN.FAILED')
    await runQueuedJobs(calculateRunJob)
    expect(await ownerRows(`SELECT 1 FROM run WHERE id = $1 AND state = 'calculated'`, [next.json().data.run_id])).toHaveLength(1)
  })
})

describe('snapshot loader (D-B3-08, §0.1)', () => {
  test('rows committed between its statements never leave a reference the snapshot lacks', async () => {
    const w = await createWorld()
    const root = await member(w, 'DE-ROOT')
    for (let after = 1; after <= 7; after += 1) {
      let injected = false
      const { snapshot: s } = await runInTenant({ tenantId: w.tenantId, userId: SYSTEM_ACTOR_ID }, SYSTEM_ACTOR, async (tx) => {
        const period = await loadPeriod(tx, w.periods[0]!.id)
        let statements = 0
        // A tx whose `after`-th statement is followed by a commit elsewhere: a new member, its sponsorship and an order.
        const racing = new Proxy(tx, {
          get: (target, key) => (key !== 'query' ? Reflect.get(target, key) : async (text: string, values?: unknown[]) => {
            const result = await target.query(text, values)
            statements += 1
            if (statements === after) {
              await order(w, await member(w, `DE-R${after}`, root), inside(w.periods[0]!), 1000)
              injected = true
            }
            return result
          }),
        })
        return buildSnapshot(racing, period, { snapshotId: randomUUID(), chain: { priorState: null, priorRunId: null, history: [] }, adjustments: [] })
      })
      expect(injected, `statement ${after}`).toBe(true)
      const positions = new Set(s.positions.map((p) => p.positionId))
      const people = new Set(s.participants.map((p) => p.participantId))
      const types = new Set(s.participantTypes.map((t) => t.code))
      expect(s.orders.every((o) => o.creditPositionId === null || positions.has(o.creditPositionId)), `orders, statement ${after}`).toBe(true)
      expect(s.relationships.every((r) => positions.has(r.parentPositionId) && positions.has(r.childPositionId)), `relationships, statement ${after}`).toBe(true)
      expect(s.positions.every((p) => people.has(p.ownerParticipantId)) && s.orders.every((o) => people.has(o.buyerParticipantId)), `participants, statement ${after}`).toBe(true)
      expect(s.participants.every((p) => types.has(p.typeCode)), `types, statement ${after}`).toBe(true)
    }
  })

  test('D-B2-21: a cross-market sponsor stays in the tree; state rows are written only for positions of the calendar market', async () => {
    const w = await createWorld()
    const [austria] = await ownerRows<{ id: string }>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES ($1, 'AT', 'EUR', 2, 'Europe/Vienna', '{de}', 'none', 'live') RETURNING id`, [w.tenantId])
    const c = await member(w, 'AT-C', null, { marketId: austria!.id })
    const a = await member(w, 'DE-A', c)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, a, inside(w.periods[0]!), 30_000)
    const runId = await calculate(app, w, w.periods[0]!.id)
    expect(await ownerRows('SELECT state FROM run WHERE id = $1', [runId])).toEqual([{ state: 'calculated' }])
    const [snapshot] = await ownerRows<{ positions: number }>(
      `SELECT (s.row_counts ->> 'positions')::int AS positions FROM run r JOIN run_snapshot s ON s.id = r.snapshot_id WHERE r.id = $1`, [runId])
    expect(snapshot!.positions).toBe(2)
    expect(await ownerRows('SELECT position_id FROM qualification_state WHERE run_id = $1', [runId])).toEqual([{ position_id: a.positionId }])
  })
})
