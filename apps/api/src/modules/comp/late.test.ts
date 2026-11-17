import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb } from '../../../test/helpers/index.js'
import { compModule } from './index.js'
import {
  activePlan, calculate, commit, createWorld, inside, lateItem, linesOf, member, order, orderEvent, ts10Plan, type Member, type World,
} from './test-support.js'

// T-B3-27: late items of committed periods become adjustment origins of the next run of the calendar (D-B3-13).

let app: FastifyInstance
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule] })
})

afterAll(async () => {
  await app.close()
})

interface Ts10 { w: World; a: Member; c: Member; o1: string; o2: string; firstRun: string }

/** TS-10 period M1 committed: A 80.00 (rank_bonus, order_line policy), C 16.00 (match). */
async function committedTs10(settings: Record<string, unknown> = {}, amounts: [number, number] = [30_000, 50_000]): Promise<Ts10> {
  const w = await createWorld({ settings })
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  const o1 = await order(w, a, inside(w.periods[0]!), amounts[0])
  const o2 = await order(w, a, inside(w.periods[0]!, 2), amounts[1])
  const firstRun = await calculate(app, w, w.periods[0]!.id)
  await commit(app, w, firstRun)
  return { w, a, c, o1, o2, firstRun }
}

const originsOf = (runId: string) => ownerRows<{ type: string; position: string; rule: string; amount: string; original: string }>(
  `SELECT origin_type AS type, payee_position_id AS position, rule_key AS rule, amount_minor::text AS amount, original_period_id AS original
   FROM adjustment_origin WHERE run_id = $1 ORDER BY origin_type, amount_minor`, [runId])

const linesHash = async (runId: string) => (await ownerRows<{ lines_hash: string }>('SELECT lines_hash FROM run WHERE id = $1', [runId]))[0]!.lines_hash

describe('late consumption (FR-COMP-010)', () => {
  test('TS-10 order line: a refund of the 500.00 order claws back A -50.00, C nothing (matching has no order parts)', async () => {
    const { w, a, o2, firstRun } = await committedTs10()
    const hash = await linesHash(firstRun)
    await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!)) }, w.periods[0]!.id)

    const runId = await calculate(app, w, w.periods[1]!.id)

    expect(await originsOf(runId)).toEqual([{ type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '-5000', original: w.periods[0]!.id }])
    expect(await ownerRows(`SELECT bonus_type, source_kind, amount_minor::text AS amount, original_period_id FROM result_line WHERE run_id = $1 AND origin_type IS NOT NULL`, [runId]))
      .toEqual([{ bonus_type: 'adjustment', source_kind: 'clawback', amount: '-5000', original_period_id: w.periods[0]!.id }])
    expect(await linesHash(firstRun)).toBe(hash)
  })

  test('BUG-084: a 2-unit line counts its stored line-total pv once; its full refund claws back the whole line', async () => {
    const w = await createWorld()
    const c = await member(w, 'DE-C')
    const a = await member(w, 'DE-A', c)
    const plan = ts10Plan()
    const pv = { ...plan.measures[0]!, source: { from: 'volume' as const, name: 'pv' } } as (typeof plan.measures)[number]
    await activePlan(w, { ...plan, measures: [pv, plan.measures[1]!] }, w.periods[0]!.starts_at)
    const o = await order(w, a, inside(w.periods[0]!), 20_000, { quantity: 2 })
    const first = await calculate(app, w, w.periods[0]!.id)

    // pv 200.00 (2 x 100.00), not 400.00: rank_bonus 5 % = 10.00.
    expect((await linesOf(first)).filter((l) => l.rule === 'rank_bonus')).toEqual([expect.objectContaining({ position: a.positionId, amount: '1000' })])
    await commit(app, w, first)
    await lateItem(w, { eventId: await orderEvent(w, o, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const second = await calculate(app, w, w.periods[1]!.id)
    expect(await originsOf(second)).toEqual([{ type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '-1000', original: w.periods[0]!.id }])
  })

  test('TS-13 / AC-08.1 and AC-COMP10-3: a late order is paid in the next run; its later full refund claws back exactly that', async () => {
    const { w, a, firstRun } = await committedTs10()
    const hash = await linesHash(firstRun)
    const late = await order(w, a, inside(w.periods[0]!, 3), 10_000)
    await lateItem(w, { orderId: late }, w.periods[0]!.id)

    const second = await calculate(app, w, w.periods[1]!.id)

    // P + O3: A's gv 900.00 at 10 %, the order's part 10.00.
    expect(await originsOf(second)).toEqual([{ type: 'late_transaction', position: a.positionId, rule: 'rank_bonus', amount: '1000', original: w.periods[0]!.id }])
    expect(await linesHash(firstRun)).toBe(hash)
    await commit(app, w, second)
    await lateItem(w, { eventId: await orderEvent(w, late, inside(w.periods[2]!)) }, w.periods[0]!.id)
    const third = await calculate(app, w, w.periods[2]!.id)
    expect(await originsOf(third)).toEqual([{ type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '-1000', original: w.periods[0]!.id }])
  })

  test('AC-COMP10-3: a late order and its refund consumed in the same run net to zero', async () => {
    const { w, a } = await committedTs10()
    const late = await order(w, a, inside(w.periods[0]!, 3), 10_000)
    await lateItem(w, { orderId: late }, w.periods[0]!.id)
    await lateItem(w, { eventId: await orderEvent(w, late, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const runId = await calculate(app, w, w.periods[1]!.id)
    expect((await originsOf(runId)).map((o) => o.amount)).toEqual(['-1000', '1000'])
    const adjusted = (await linesOf(runId)).filter((l) => l.origin !== null)
    expect(adjusted.reduce((sum, l) => sum + BigInt(l.amount), 0n)).toBe(0n)
  })

  test('AC-COMP10-1: a re-run recomputes the same origins; commit consumes them once; the next period does not repeat them', async () => {
    const { w, o2 } = await committedTs10()
    await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const first = await calculate(app, w, w.periods[1]!.id)
    const rerun = await calculate(app, w, w.periods[1]!.id)
    const strip = (rows: Awaited<ReturnType<typeof originsOf>>) => rows.map(({ type, position, rule, amount }) => ({ type, position, rule, amount }))
    expect(strip(await originsOf(rerun))).toEqual(strip(await originsOf(first)))
    await commit(app, w, rerun)
    expect(await ownerRows('SELECT 1 FROM adjustment_origin WHERE run_id = $1 AND consumed_run_id IS NULL', [first])).toHaveLength(1)
    expect(await ownerRows('SELECT 1 FROM adjustment_origin WHERE run_id = $1 AND consumed_run_id = $1', [rerun])).toHaveLength(1)
    const next = await calculate(app, w, w.periods[2]!.id)
    expect(await originsOf(next)).toEqual([])
  })

  test('AC-COMP10-2: an item switched to restatement handling gets no line and shows as origin_skipped', async () => {
    const { w, o2 } = await committedTs10()
    const late = await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!)) }, w.periods[0]!.id, 'restatement')
    const runId = await calculate(app, w, w.periods[1]!.id)
    expect(await originsOf(runId)).toEqual([])
    const exceptions = (await call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as: w.analyst })).json().data.exceptions
    expect(exceptions).toContainEqual(expect.objectContaining({ id: `origin_skipped:${late}`, blocking: false, ref: late }))
  })

  test('restatement-policy bonuses get no automatic line; the item is still consumed by the commit', async () => {
    const w = await createWorld()
    const c = await member(w, 'DE-C')
    const a = await member(w, 'DE-A', c)
    await activePlan(w, ts10Plan({ rank: 'restatement' }), w.periods[0]!.starts_at)
    const o = await order(w, a, inside(w.periods[0]!), 50_000)
    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    const late = await lateItem(w, { eventId: await orderEvent(w, o, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const runId = await calculate(app, w, w.periods[1]!.id)
    expect(await originsOf(runId)).toEqual([])
    await commit(app, w, runId)
    expect(await ownerRows(`SELECT 1 FROM late_transaction WHERE id = $1 AND state = 'consumed' AND consumed_by_run_id = $2`, [late, runId])).toHaveLength(1)
  })

  test('AC-COMP12-3: with money.rounding_mode half_even a clawback of magnitude x.xx5 rounds half-even (half_up rounds away)', async () => {
    // O2 100.00 of A's gv 1,100.00 at 10 % is 10.00 of the line; refunding 0.25 of it claws back 0.025 -> 0.02 / 0.03.
    for (const [mode, expected] of [['half_even', '-2'], ['half_up', '-3']] as const) {
      const { w, o2 } = await committedTs10({ 'money.rounding_mode': mode }, [100_000, 10_000])
      await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!), 'refund', { refundMinor: 25 }) }, w.periods[0]!.id)
      const runId = await calculate(app, w, w.periods[1]!.id)
      expect((await originsOf(runId)).map((o) => o.amount)).toEqual([expected])
    }
  })

  test('a unit refunded in period and the other refunded late: the clawback takes the whole remaining commission', async () => {
    const w = await createWorld()
    const c = await member(w, 'DE-C')
    const a = await member(w, 'DE-A', c)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    const o = await order(w, a, inside(w.periods[0]!), 20_000, { quantity: 2 })
    await orderEvent(w, o, inside(w.periods[0]!, 3), 'refund', { quantity: 1 })
    const first = await calculate(app, w, w.periods[0]!.id)
    // A's pv 100.00 net of the in-period refund: rank_bonus 5 % = 5.00.
    expect((await linesOf(first)).filter((l) => l.rule === 'rank_bonus')).toEqual([expect.objectContaining({ position: a.positionId, amount: '500' })])
    await commit(app, w, first)
    await lateItem(w, { eventId: await orderEvent(w, o, inside(w.periods[1]!), 'refund', { quantity: 1 }) }, w.periods[0]!.id)
    const second = await calculate(app, w, w.periods[1]!.id)
    expect(await originsOf(second)).toEqual([{ type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '-500', original: w.periods[0]!.id }])
  })

  test('a late chargeback_reversed of an in-period chargeback gives back what the chargeback took', async () => {
    const w = await createWorld()
    const c = await member(w, 'DE-C')
    const a = await member(w, 'DE-A', c)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, a, inside(w.periods[0]!), 30_000)
    const o2 = await order(w, a, inside(w.periods[0]!, 2), 50_000)
    const chargeback = await orderEvent(w, o2, inside(w.periods[0]!, 3), 'chargeback')
    const first = await calculate(app, w, w.periods[0]!.id)
    // A's gv 300.00 without O2: R1 5 % = 15.00.
    expect((await linesOf(first)).filter((l) => l.rule === 'rank_bonus')).toEqual([expect.objectContaining({ position: a.positionId, amount: '1500' })])
    await commit(app, w, first)
    await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!), 'chargeback_reversed', { reverses: chargeback }) }, w.periods[0]!.id)
    const second = await calculate(app, w, w.periods[1]!.id)
    // P with O2 credited: gv 800.00 at 10 %, O2's part 5.00.
    expect(await originsOf(second)).toEqual([{ type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '5000', original: w.periods[0]!.id }])
  })

  test('a late chargeback and its late reversal net to zero', async () => {
    const { w, a, o2 } = await committedTs10()
    const chargeback = await orderEvent(w, o2, inside(w.periods[1]!), 'chargeback')
    await lateItem(w, { eventId: chargeback }, w.periods[0]!.id)
    await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!, 2), 'chargeback_reversed', { reverses: chargeback }) }, w.periods[0]!.id)
    const runId = await calculate(app, w, w.periods[1]!.id)
    expect(await originsOf(runId)).toEqual([
      { type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '-5000', original: w.periods[0]!.id },
      { type: 'clawback', position: a.positionId, rule: 'rank_bonus', amount: '5000', original: w.periods[0]!.id },
    ])
  })

  test('an equal-value exchange claws back nothing; the item is consumed', async () => {
    const { w, o2 } = await committedTs10()
    await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!), 'exchange', { refundMinor: 0, equalValue: true }) }, w.periods[0]!.id)
    const runId = await calculate(app, w, w.periods[1]!.id)
    expect(await originsOf(runId)).toEqual([])
    const [snapshot] = await ownerRows<{ late: string[] }>(
      `SELECT s.row_counts -> 'late_item_ids' AS late FROM run r JOIN run_snapshot s ON s.id = r.snapshot_id WHERE r.id = $1`, [runId])
    expect(snapshot!.late).toHaveLength(1)
  })
})
