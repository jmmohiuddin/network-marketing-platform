import { gunzipSync } from 'node:zlib'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb } from '../../../test/helpers/index.js'
import { compModule } from './index.js'
import {
  activePlan, calculate, commit, createWorld, inside, member, order, relate, ts10Plan, user, type Member, type World,
} from './test-support.js'

// FR-COMP-004/005/007/008: lines, traces (T-B3-24), replay (T-B3-25, TS-03, G-B3-REPLAY) and qualification state
// (TS-59, TS-63, T-B3-20).

let app: FastifyInstance
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule] })
})

afterAll(async () => {
  await app.close()
})

interface Ts10 { w: World; a: Member; c: Member; orders: string[]; runId: string }

async function committedTs10(plan = ts10Plan()): Promise<Ts10> {
  const w = await createWorld()
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  await activePlan(w, plan, w.periods[0]!.starts_at)
  const orders = [await order(w, a, inside(w.periods[0]!), 30_000), await order(w, a, inside(w.periods[0]!, 2), 50_000)]
  const runId = await calculate(app, w, w.periods[0]!.id)
  await commit(app, w, runId)
  return { w, a, c, orders, runId }
}

describe('GET /v1/runs/:id/lines', () => {
  test('pages and filters lines; the CSV is an audited export', async () => {
    const { w, a, runId } = await committedTs10()
    const page = await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines?limit=1`, as: w.analyst })
    expect(page.json().data).toHaveLength(1)
    const next = await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines?limit=1&cursor=${page.json().meta.next_cursor}`, as: w.analyst })
    expect(next.json().data[0].id > page.json().data[0].id).toBe(true)
    const filtered = await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines?payee_position_id=${a.positionId}&rule_key=rank_bonus`, as: w.analyst })
    expect(filtered.json().data).toEqual([expect.objectContaining({ payee_position_id: a.positionId, rule_key: 'rank_bonus', amount_minor: '8000', currency: 'EUR', origin_type: null })])

    const csv = await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines?format=csv`, as: w.analyst })
    expect(csv.statusCode).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.body.split('\r\n')[0]).toBe('id,payee_position_id,payee_participant_id,rule_key,bonus_type,source_kind,pass,amount_minor,currency,origin_type,origin_id,original_period_id')
    expect(csv.body.trim().split('\r\n')).toHaveLength(3)
    expect(await auditActions(w.tenantId)).toContain('EXPORT.CREATED')

    expect((await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines?rule_key=Bad-Key`, as: w.analyst })).statusCode).toBe(400)
    expect((await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines`, as: await user(w.tenantId, ['Payout officer']) })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/runs/${runId}/lines`, as: (await createWorld()).analyst })).statusCode).toBe(404)
  })
})

describe('GET /v1/result-lines/:id/trace (FR-COMP-007)', () => {
  test('TS-59 / AC-13.1: the compact trace; expanded by replay it cites the source orders, explains and reconciles to the stored amount', async () => {
    const { w, a, orders, runId } = await committedTs10()
    const [line] = await ownerRows<{ id: string }>(`SELECT id FROM result_line WHERE run_id = $1 AND payee_position_id = $2`, [runId, a.positionId])
    const compact = await call(app, { method: 'GET', url: `/v1/result-lines/${line!.id}/trace`, as: w.analyst })
    expect(compact.statusCode).toBe(200)
    expect(compact.json().data).toMatchObject({ line: { id: line!.id, amount_minor: '8000', rule_key: 'rank_bonus' }, trace: { rule: 'rank_bonus', pass: 4 }, expanded: null, expressions: [] })

    const expanded = (await call(app, { method: 'GET', url: `/v1/result-lines/${line!.id}/trace?expand=true`, as: w.analyst })).json().data
    expect(expanded.explanation.reconciles).toBe(true)
    expect(expanded.explanation.lines.at(-1)).toBe('amount 80.00 EUR')
    expect(expanded.expanded.rankEvaluated).toEqual([{ ladder: 'main', rank: 'R2' }])
    const cited = expanded.expanded.sources.flatMap((s: { orders: { orderId: string }[] }) => s.orders.map((o) => o.orderId))
    expect(cited.sort()).toEqual([...orders].sort())
    expect(expanded.expanded.steps).toEqual([expect.objectContaining({ step: 'rounding', mode: 'half_up', minor: '8000' })])

    expect((await call(app, { method: 'GET', url: `/v1/result-lines/${line!.id}/trace`, as: await user(w.tenantId, ['Payout officer']) })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/result-lines/${line!.id}/trace`, as: (await createWorld()).analyst })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/result-lines/${line!.id}/trace?expand=yes`, as: w.analyst })).statusCode).toBe(400)
  })
})

describe('POST /v1/runs/:id/replay (FR-COMP-008)', () => {
  test('G-B3-REPLAY / TS-03: a committed period replays to identical lines and lines_hash, also after a genealogy correction', async () => {
    const { w, a, runId } = await committedTs10()
    const b = await member(w, 'DE-B')
    await getOwnerPool().query(`UPDATE relationship SET superseded_at = now() WHERE child_position_id = $1 AND superseded_at IS NULL`, [a.positionId])
    await relate(w, b, a, w.periods[0]!.starts_at.toISOString(), 'migration')
    const [run] = await ownerRows<{ inputs_hash: string; lines_hash: string; result_hash: string }>(
      `SELECT inputs_hash, lines_hash, outputs ->> 'result_hash' AS result_hash FROM run WHERE id = $1`, [runId])

    const replayed = await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: w.analyst })

    expect(replayed.statusCode).toBe(200)
    expect(replayed.json().data).toEqual({
      status: 'match', inputs_hash: run!.inputs_hash, result_hash: run!.result_hash, lines_hash: run!.lines_hash, engine_version: expect.any(String),
    })
    expect(await auditActions(w.tenantId)).toContain('RUN.REPLAYED')
  })

  test('AC-COMP8-1: a tampered snapshot answers 500 SNAPSHOT_CORRUPT and audits RUN.REPLAY_FAILED', async () => {
    const { w, runId } = await committedTs10()
    const client = await getOwnerPool().connect()
    try {
      await client.query(`SET session_replication_role = replica`)
      await client.query(
        `UPDATE run_snapshot SET content = overlay(content PLACING '\\x00'::bytea FROM 20 FOR 1) WHERE id = (SELECT snapshot_id FROM run WHERE id = $1)`, [runId])
    } finally {
      await client.query(`RESET session_replication_role`)
      client.release()
    }
    const replayed = await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: w.analyst })
    expect(replayed.statusCode).toBe(500)
    expect(replayed.json().error.code).toBe('SNAPSHOT_CORRUPT')
    expect(await auditActions(w.tenantId)).toContain('RUN.REPLAY_FAILED')
    // Trace expansion replays the same snapshot: the same answer, audited too.
    const [line] = await ownerRows<{ id: string }>('SELECT id FROM result_line WHERE run_id = $1 LIMIT 1', [runId])
    const expanded = await call(app, { method: 'GET', url: `/v1/result-lines/${line!.id}/trace?expand=true`, as: w.analyst })
    expect(expanded.statusCode).toBe(500)
    expect(expanded.json().error.code).toBe('SNAPSHOT_CORRUPT')
    expect((await auditActions(w.tenantId)).filter((action) => action === 'RUN.REPLAY_FAILED')).toHaveLength(2)
  })

  test('refusals: a queued run 409, no run.execute 403, other tenant 404', async () => {
    const { w, runId } = await committedTs10()
    const queued = await call(app, { method: 'POST', url: `/v1/periods/${w.periods[1]!.id}/runs`, as: w.analyst, headers: { 'run-request-id': 'q' } })
    expect((await call(app, { method: 'POST', url: `/v1/runs/${queued.json().data.run_id}/replay`, as: w.analyst })).json().error.code).toBe('RUN_NOT_CALCULATED')
    expect((await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: w.finance })).statusCode).toBe(403)
    expect((await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: (await createWorld()).analyst })).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: '/v1/runs/x/replay', as: w.analyst })).statusCode).toBe(400)
  })
})

describe('qualification state across periods (FR-COMP-004)', () => {
  test('T-B3-20 / TS-63 / AC-46.1: a counter carries across a commit, the rolling window reads committed history, paid-as and titles per period', async () => {
    const plan = { ...ts10Plan({ rolling: 3 }), counters: [{ key: 'streak', incrementIf: { ladder: 'main', rank: 'R1' } }] }
    const { w, a } = await committedTs10(plan)
    await order(w, a, inside(w.periods[1]!), 10_000)
    const second = await calculate(app, w, w.periods[1]!.id)
    await commit(app, w, second)
    await order(w, a, inside(w.periods[2]!), 10_000)
    const third = await calculate(app, w, w.periods[2]!.id)
    await commit(app, w, third)

    const [snapshot] = await ownerRows<{ content: Buffer }>('SELECT s.content FROM run r JOIN run_snapshot s ON s.id = r.snapshot_id WHERE r.id = $1', [third])
    const stored = JSON.parse(gunzipSync(snapshot!.content).toString('utf8')) as { history: { periodId: string }[]; priorState: { periodId: string } }
    expect(stored.history.map((h) => h.periodId)).toEqual([w.periods[1]!.id, w.periods[0]!.id])
    expect(stored.priorState.periodId).toBe(w.periods[1]!.id)

    const response = await call(app, { method: 'GET', url: `/v1/positions/${a.positionId}/qualification?calendar_id=${w.calendarId}`, as: w.analyst })
    expect(response.statusCode).toBe(200)
    const periods = response.json().data
    expect(periods.map((p: { period: { id: string } }) => p.period.id)).toEqual([w.periods[2]!.id, w.periods[1]!.id, w.periods[0]!.id])
    expect(periods[0]).toMatchObject({ run_id: third, counters: [{ key: 'streak', value: 3 }], paid_as: [{ ladder: 'main', rank: 'R3' }], titles: [{ ladder: 'main', rank: 'R3' }] })
    expect(periods[2].measures).toEqual(expect.arrayContaining([{ measure: 'pv', valueMinor: '80000' }]))
    const page = await call(app, { method: 'GET', url: `/v1/positions/${a.positionId}/qualification?limit=1`, as: w.analyst })
    const rest = await call(app, { method: 'GET', url: `/v1/positions/${a.positionId}/qualification?limit=5&cursor=${page.json().meta.next_cursor}`, as: w.analyst })
    expect(rest.json().data).toHaveLength(2)

    expect((await call(app, { method: 'GET', url: `/v1/positions/${a.positionId}/qualification`, as: await user(w.tenantId, ['Plan administrator']) })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/positions/${a.positionId}/qualification`, as: (await createWorld()).analyst })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/positions/${a.positionId}/qualification?calendar_id=x`, as: w.analyst })).statusCode).toBe(400)
  })
})
