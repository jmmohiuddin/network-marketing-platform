// T-B6-04 (D-B6-03, AC-27.2, AC-PLN8-2): two consecutive committed periods across a plan version change. The first run
// under version 2 applies its declared transitions in pass 0, reports only the values a rule changed, and the governance
// view of version 2 names that run.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, resetApiDb } from '../../../test/helpers/index.js'
import type { FastifyInstance } from 'fastify'
import { plnModule } from '../pln/index.js'
import { activePlan, calculate, commit, createWorld, inside, member, order, ts10Plan } from './test-support.js'
import { compModule } from './index.js'

let app: FastifyInstance
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [plnModule, compModule], env: { LOG_LEVEL: 'error' } })
}, 120_000)

afterAll(async () => {
  await app.close()
})

test('T-B6-04 / AC-27.2 / AC-PLN8-2: the first run under v2 reports the reset title only; governance names it as first_run_id', async () => {
  const w = await createWorld()
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  const [p0, p1] = [w.periods[0]!, w.periods[1]!]
  const { planId } = await activePlan(w, ts10Plan(), p0.starts_at)
  // a: pv 800.00 = gv 800.00 >= 700.00 -> title R2 under v1.
  await order(w, a, inside(p0), 80_000)
  await commit(app, w, await calculate(app, w, p0.id))
  const declare = (stateItem: string, rule: 'carry' | 'reset') => ({ stateItem, rule, map: [], reason: rule === 'reset' ? 'New ladder starts fresh' : null })
  await activePlan(w, { ...ts10Plan(), transitions: [declare('paid_as.main', 'carry'), declare('title.main', 'reset')] }, p1.starts_at,
    { planId, version: 2, state: 'scheduled' })
  const governance = () => call(app, { method: 'GET', url: `/v1/plans/${planId}/versions/2/governance`, as: w.compliance })
  const before = await governance()

  await order(w, a, inside(p1), 10_000)
  const runId = await calculate(app, w, p1.id)
  await commit(app, w, runId)
  const transitions = await call(app, { method: 'GET', url: `/v1/runs/${runId}/transitions`, as: w.finance })

  expect(before.statusCode, before.body).toBe(200)
  expect(before.json().data.first_run_id).toBeNull()
  expect(transitions.statusCode, transitions.body).toBe(200)
  expect(transitions.json().data).toEqual([{
    position_id: a.positionId,
    participant: { id: a.participantId, external_ref: 'DE-A', display_name: 'DE-A' },
    changed: [{ state_item: 'title.main', before: expect.stringContaining('R2'), after: expect.any(String) }],
  }])
  expect((await governance()).json().data.first_run_id).toBe(runId)
})
