import { randomUUID } from 'node:crypto'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { ordModule } from '../ord/index.js'
import { SUPPORT_SESSION_HEADER, supportModule } from '../support/index.js'
import { compModule } from './index.js'
import { calculateRunJob } from './runs.js'
import {
  activePlan, calculate, commit, createWorld, inside, lateItem, linesOf, member, order, orderEvent, ts10Plan, user, type Member, type World,
} from './test-support.js'

let app: FastifyInstance
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, supportModule, ordModule] })
})

afterAll(async () => {
  await app.close()
})

interface Ts10 { w: World; a: Member; c: Member; orders: string[] }

async function ts10World(settings: Record<string, unknown> = {}): Promise<Ts10> {
  const w = await createWorld({ settings })
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  const orders = [await order(w, a, inside(w.periods[0]!), 30_000), await order(w, a, inside(w.periods[0]!, 2), 50_000)]
  return { w, a, c, orders }
}

const review = (runId: string, as: TestUser, query = '') => call(app, { method: 'GET', url: `/v1/runs/${runId}/review${query}`, as })
const requestCommit = (runId: string, as: TestUser) => call(app, { method: 'POST', url: `/v1/runs/${runId}/request-commit`, as, idempotencyKey: true })
const commitAs = (runId: string, as: TestUser, acknowledged: string[] = [], key: true | string = true) =>
  call(app, { method: 'POST', url: `/v1/runs/${runId}/commit`, as, idempotencyKey: key, body: { acknowledged_exceptions: acknowledged } })

describe('GET /v1/runs/:id/review (FR-COMP-005)', () => {
  test('AC-06.1: totals vs the previous committed period, variance, movers, exceptions, changes, adjustments; first read opens it', async () => {
    const { w, a, c } = await ts10World()
    const first = await calculate(app, w, w.periods[0]!.id)
    await commit(app, w, first)
    await order(w, a, inside(w.periods[1]!), 10_000)
    const second = await calculate(app, w, w.periods[1]!.id)

    const response = await review(second, w.analyst)

    expect(response.statusCode).toBe(200)
    const data = response.json().data
    expect(data.comparison).toMatchObject({ run_id: first, period: { id: w.periods[0]!.id } })
    expect(data.totals).toMatchObject({ current: { gross_minor: '600' }, previous: { gross_minor: '9600' } })
    expect(data.variance).toEqual([
      { rule_key: 'match', kind: 'pay.matching', pass: 5, previous_minor: '1600', current_minor: '100', delta_minor: '-1500' },
      { rule_key: 'rank_bonus', kind: 'pay.percent_of_measure', pass: 4, previous_minor: '8000', current_minor: '500', delta_minor: '-7500' },
    ])
    expect(data.movers.map((m: { participant: { id: string } }) => m.participant.id)).toEqual([a.participantId, c.participantId])
    expect(data.exceptions.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining(['sync_thresholds_unset', 'large_line_check_unset', 'warning:NO_WITHHOLDING_RULE']))
    expect(data.exceptions.every((e: { blocking: boolean }) => !e.blocking)).toBe(true)
    expect(data.changes).toMatchObject({ plan_version_changed: false, settings_version_changed: false, inputs: { current: { orders: 1 }, previous: { orders: 2 } }, transition_changes: 0 })
    expect(data.adjustments).toEqual([])
    const [run] = await ownerRows<{ review_opened_by: string }>('SELECT review_opened_by FROM run WHERE id = $1', [second])
    expect(run!.review_opened_by).toBe(w.analyst.id)
    expect((await auditActions(w.tenantId)).filter((x) => x === 'RUN.REVIEW_OPENED')).toHaveLength(2)
    const transitions = await call(app, { method: 'GET', url: `/v1/runs/${second}/transitions`, as: w.finance })
    expect(transitions.json()).toEqual({ data: [], meta: { next_cursor: null } })
  })

  test('AC-COMP5-1: a large line and a stale source block; unset threshold is an info exception', async () => {
    const { w } = await ts10World({ 'runs.exception_thresholds': { large_line_minor: '5000' } })
    const runId = await calculate(app, w, w.periods[0]!.id)
    const [line] = await ownerRows<{ id: string }>(`SELECT id FROM result_line WHERE run_id = $1 AND amount_minor = 8000`, [runId])
    await ownerRows(
      `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
       VALUES ($1, 'api:fixture', 'order:bad', sha256('x'::bytea), now(), 'rejected', $2, 'system')`, [w.tenantId, w.analyst.id])
    // A settings version after the run lowers the threshold: the run keeps the threshold it was calculated under.
    await ownerRows(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
       VALUES ($1, 2, now(), '{"runs.exception_thresholds": {"large_line_minor": "1"}}', 'fixture', $2)`, [w.tenantId, w.analyst.id])
    const exceptions = (await review(runId, w.analyst)).json().data.exceptions as { id: string; blocking: boolean }[]
    expect(exceptions.filter((e) => e.blocking).map((e) => e.id).sort()).toEqual([`large_line:${line!.id}`, 'sync_stale'])
    expect(exceptions.map((e) => e.id)).not.toContain('large_line_check_unset')
    const refused = await commitAs(runId, w.finance, ['sync_stale'])
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({ code: 'EXCEPTIONS_NOT_ACKNOWLEDGED', details: { exception_ids: [`large_line:${line!.id}`] } })
    expect((await commitAs(runId, w.finance, ['sync_stale', `large_line:${line!.id}`])).statusCode).toBe(200)
  })

  test('an in-period refund naming no lines is not reversed by the run: a blocking exception until acknowledged', async () => {
    const { w, orders } = await ts10World()
    const [inbound] = await ownerRows<{ id: string }>(
      `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
       VALUES ($1, 'api:fixture', 'event:amount-only', sha256('y'::bytea), now(), 'processed', $2, 'system') RETURNING id`, [w.tenantId, w.analyst.id])
    const [event] = await ownerRows<{ id: string }>(
      `INSERT INTO order_event (tenant_id, order_id, source_system, source_event_id, type, occurred_at, lines, refund_minor, fee_minor,
         volume_effect, inbound_event_id, created_by, created_by_type)
       VALUES ($1, $2, 'fixture', 'amount-only', 'refund', $3, '[]', 2500, 0, '{}', $4, $5, 'system') RETURNING id`,
      [w.tenantId, orders[1], inside(w.periods[0]!, 3), inbound!.id, w.analyst.id])
    const runId = await calculate(app, w, w.periods[0]!.id)
    const exceptions = (await review(runId, w.analyst)).json().data.exceptions as { id: string; blocking: boolean }[]
    expect(exceptions.filter((e) => e.blocking).map((e) => e.id)).toEqual([`unreversed_event:${event!.id}`])
    expect((await commitAs(runId, w.finance)).json().error).toMatchObject({ code: 'EXCEPTIONS_NOT_ACKNOWLEDGED' })
    expect((await commitAs(runId, w.finance, [`unreversed_event:${event!.id}`])).statusCode).toBe(200)
  })

  test('AC-COMP5-2: a review read in a support session writes nothing; the first tenant read opens it', async () => {
    const { w } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)
    const decider = await createSignedInUser({ tenantId: w.tenantId, roles: ['Tenant admin', 'Finance approver'], stepUp: true })
    const engineer = await createSignedInUser({ tenantId: null })
    await ownerRows(`UPDATE user_account SET work_region = 'eu' WHERE id = $1`, [engineer.id])
    const body = { tenant: w.tenantId, reason: 'Ticket 7', scope: { permissions: ['run.review'] }, minutes: 60 }
    const filed = await call(app, { method: 'POST', url: '/v1/support-sessions', as: engineer, body, idempotencyKey: true })
    const id = filed.json().data.id as string
    const decided = await call(app, { method: 'POST', url: `/v1/support-sessions/${id}/decision`, as: decider, body: { approved: true, minutes: 30 }, idempotencyKey: true })
    expect(decided.statusCode, decided.body).toBe(200)

    const inSession = await call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as: engineer, headers: { [SUPPORT_SESSION_HEADER]: id } })

    expect(inSession.statusCode).toBe(200)
    expect(await ownerRows('SELECT 1 FROM run WHERE id = $1 AND review_opened_at IS NULL', [runId])).toHaveLength(1)
    expect(await auditActions(w.tenantId)).not.toContain('RUN.REVIEW_OPENED')
    await review(runId, w.finance)
    expect(await ownerRows('SELECT 1 FROM run WHERE id = $1 AND review_opened_by = $2', [runId, w.finance.id])).toHaveLength(1)
  })

  test('refusals: not calculated 409, no run.review 403, other tenant 404, bad compare id 400', async () => {
    const { w } = await ts10World()
    const accepted = await call(app, { method: 'POST', url: `/v1/periods/${w.periods[0]!.id}/runs`, as: w.analyst, headers: { 'run-request-id': 'x' } })
    const runId = accepted.json().data.run_id
    expect((await review(runId, w.analyst)).json().error.code).toBe('RUN_NOT_CALCULATED')
    await runQueuedJobs(calculateRunJob)
    expect((await review(runId, await user(w.tenantId, ['Payout officer']))).statusCode).toBe(403)
    const other = await createWorld()
    expect((await review(runId, other.analyst)).statusCode).toBe(404)
    expect((await review(runId, w.analyst, '?compare_run_id=nope')).statusCode).toBe(400)
    expect((await call(app, { method: 'GET', url: `/v1/runs/${runId}`, as: other.analyst })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/runs/${runId}/transitions`, as: other.analyst })).statusCode).toBe(404)
  })
})

describe('POST /v1/runs/:id/request-commit and /commit (FR-COMP-006)', () => {
  test('request-commit records the requester once and lists who may commit', async () => {
    const { w } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)
    const first = await requestCommit(runId, w.analyst)
    expect(first.statusCode).toBe(200)
    const eligible = first.json().data.eligible_approvers.map((u: { user_id: string }) => u.user_id)
    expect(eligible.sort()).toEqual([w.finance.id, w.finance2.id].sort())
    expect((await requestCommit(runId, w.analyst)).json().data.commit_requested_at).toBe(first.json().data.commit_requested_at)
    expect((await requestCommit(runId, w.finance)).statusCode).toBe(403)
    expect((await requestCommit(runId, (await createWorld()).analyst)).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/runs/${runId}/request-commit`, as: w.analyst })).statusCode).toBe(400)
  })

  test('TS-42 / AC-07.1 / AC-07.2: SoD with a custom role, 403 for the analyst, step-up required, another approver commits', async () => {
    const { w } = await ts10World()
    const [role] = await ownerRows<{ id: string }>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, 'Run both', '{run.execute,run.review,run.commit,period.read}', false, true) RETURNING id`,
      [w.tenantId])
    const both = await createSignedInUser({ tenantId: w.tenantId, stepUp: true })
    await ownerRows(`INSERT INTO role_assignment (tenant_id, user_id, role_id, valid_from) VALUES ($1, $2, $3, now())`, [w.tenantId, both.id, role!.id])
    const runId = await calculate(app, w, w.periods[0]!.id, both)
    await review(runId, both)

    const self = await commitAs(runId, both)
    expect(self.statusCode).toBe(422)
    expect(self.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
    expect(self.json().error.details.eligible_approvers.map((u: { user_id: string }) => u.user_id).sort()).toEqual([w.finance.id, w.finance2.id].sort())
    expect((await commitAs(runId, w.analyst)).statusCode).toBe(403)
    const stale = await createSignedInUser({ tenantId: w.tenantId, roles: ['Finance approver'] })
    expect((await commitAs(runId, stale)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await commitAs(runId, (await createWorld()).finance)).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/runs/${runId}/commit`, as: w.finance2, idempotencyKey: true, body: { acknowledged_exceptions: 'x' } })).statusCode).toBe(400)
    expect((await commitAs(runId, w.finance2)).statusCode).toBe(200)
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['APPROVAL.REFUSED', 'RUN.COMMITTED']))
  })

  test('T-B3-22 / E-PER-09: staleness gates and review gate', async () => {
    const { w } = await ts10World()
    const period = w.periods[0]!
    const discarded = await calculate(app, w, period.id)
    const current = await calculate(app, w, period.id)
    await review(current, w.analyst)
    expect((await commitAs(discarded, w.finance)).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'discarded' } })

    const queued = await call(app, { method: 'POST', url: `/v1/periods/${period.id}/runs`, as: w.analyst, headers: { 'run-request-id': randomUUID() } })
    expect((await commitAs(current, w.finance)).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'newer_run' } })
    await runQueuedJobs(calculateRunJob)
    const latest = queued.json().data.run_id as string
    expect((await commitAs(latest, w.finance)).json().error.code).toBe('REVIEW_NOT_OPENED')
    await review(latest, w.analyst)

    const plan = await ownerRows<{ plan_id: string }>('SELECT plan_id FROM plan_version WHERE tenant_id = $1', [w.tenantId])
    const v2 = await activePlan(w, ts10Plan(), period.starts_at, { planId: plan[0]!.plan_id, version: 2, state: 'scheduled' })
    expect((await commitAs(latest, w.finance)).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'plan_version_changed' } })
    await getOwnerPool().query('DELETE FROM plan_version WHERE id = $1', [v2.versionId])

    await ownerRows(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
       VALUES ($1, 2, $2, '{}', 'back-dated', $3)`, [w.tenantId, inside(period), w.analyst.id])
    expect((await commitAs(latest, w.finance)).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'settings_version_changed' } })
  })

  test('E-PER-09: a late item behind an origin switched to restatement after the run supersedes it', async () => {
    const { w, orders } = await ts10World()
    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    const refund = await orderEvent(w, orders[1]!, inside(w.periods[1]!))
    const late = await lateItem(w, { eventId: refund }, w.periods[0]!.id)
    const runId = await calculate(app, w, w.periods[1]!.id)
    await review(runId, w.analyst)
    await ownerRows(`UPDATE late_transaction SET handling = 'restatement' WHERE id = $1`, [late])
    expect((await commitAs(runId, w.finance)).json().error).toEqual(expect.objectContaining({
      code: 'RUN_SUPERSEDED', details: { reason: 'late_items_changed', late_ids: [late] },
    }))
  })

  test('AC-COMP6-1 / T-B3-23: effects of a commit, idempotent replay, a never-decided late item, the run\'s journal entry', async () => {
    const { w, orders } = await ts10World()
    const first = await calculate(app, w, w.periods[0]!.id)
    await commit(app, w, first)
    const refund = await orderEvent(w, orders[1]!, inside(w.periods[1]!))
    const late = await lateItem(w, { eventId: refund }, w.periods[0]!.id)
    const runId = await calculate(app, w, w.periods[1]!.id)
    await review(runId, w.analyst)
    const key = randomUUID()
    const committed = await commitAs(runId, w.finance, [], key)

    expect(committed.statusCode).toBe(200)
    expect(committed.json().data).toMatchObject({
      run_id: runId, state: 'committed', period_id: w.periods[1]!.id, totals: { gross_minor: expect.any(String) }, journal_entry_id: expect.any(String),
    })
    expect((await commitAs(runId, w.finance, [], key)).headers['idempotent-replayed']).toBe('true')
    expect((await commitAs(runId, w.finance)).json().error.code).toBe('RUN_NOT_CALCULATED')
    expect(await ownerRows(`SELECT 1 FROM period WHERE id = $1 AND state = 'committed' AND committed_run_id = $2`, [w.periods[1]!.id, runId])).toHaveLength(1)
    const [item] = await ownerRows<{ state: string; decided_by: string; consumed_by_run_id: string; decision_reason: string }>(
      'SELECT state, decided_by, consumed_by_run_id, decision_reason FROM late_transaction WHERE id = $1', [late])
    expect(item).toEqual({ state: 'consumed', decided_by: w.finance.id, consumed_by_run_id: runId, decision_reason: `Adjusted by run ${runId}` })
    // BUG-086: the queue names the consuming run and its period (SC-32 "Adjusted in run <link>").
    const consumed = await call(app, { method: 'GET', url: '/v1/late-transactions?state=consumed', as: w.analyst })
    expect(consumed.json().data).toEqual([expect.objectContaining({ id: late, consumed_by_run_id: runId, consumed_by_period_id: w.periods[1]!.id })])
    expect(await ownerRows(`SELECT 1 FROM adjustment_origin WHERE run_id = $1 AND consumed_run_id = $1`, [runId])).toHaveLength(1)
    expect(await ownerRows(`SELECT payload FROM outbox_event WHERE topic = 'run.committed' AND tenant_id = $1 AND key = $2`, [w.tenantId, runId])).toHaveLength(1)
    // D-B4-02: one entry per committed run (posting details in posting.test.ts).
    expect(await ownerRows('SELECT id FROM journal_entry WHERE origin_id = $1', [runId])).toEqual([{ id: committed.json().data.journal_entry_id }])
    // The next period's run does not adjust the consumed item again (AC-COMP10-1).
    const next = await calculate(app, w, w.periods[2]!.id)
    expect((await linesOf(next)).filter((l) => l.origin !== null)).toEqual([])
  })

  test('AC-COMP6-2 / E-PER-06: an order ingested after known_at and a refund dated after ends_at become pending adjust items at commit', async () => {
    const { w, a, orders } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)
    const lateOrder = await order(w, a, inside(w.periods[0]!, 5), 20_000)
    const lateRefund = await orderEvent(w, orders[0]!, inside(w.periods[1]!))
    await commit(app, w, runId)
    const items = await ownerRows<{ order_id: string | null; order_event_id: string | null; handling: string; state: string }>(
      'SELECT order_id, order_event_id, handling, state FROM late_transaction WHERE original_period_id = $1 ORDER BY order_id NULLS LAST', [w.periods[0]!.id])
    expect(items).toEqual([
      { order_id: lateOrder, order_event_id: null, handling: 'adjust', state: 'pending' },
      { order_id: null, order_event_id: lateRefund, handling: 'adjust', state: 'pending' },
    ])
    const next = await calculate(app, w, w.periods[1]!.id)
    expect((await linesOf(next)).filter((l) => l.origin !== null).map((l) => l.origin).sort()).toEqual(['clawback', 'late_transaction'])
  })

  test('T-B3-23: an order ingested concurrently with the commit is in the catch-up (shared/exclusive market-periods lock)', async () => {
    const { w, orders } = await ts10World()
    const runId = await calculate(app, w, w.periods[0]!.id)
    await review(runId, w.analyst)
    const ingest = await getOwnerPool().connect()
    try {
      await ingest.query('BEGIN')
      await ingest.query(`SELECT pg_advisory_xact_lock_shared(hashtextextended('periods:' || $1 || ':' || $2, 0))`, [w.tenantId, w.marketId])
      const committing = commitAs(runId, w.finance)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const [copy] = (await ingest.query<{ id: string }>(
        `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
           attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency,
           payload_hash, inbound_event_id, created_by, created_by_type)
         SELECT tenant_id, source_system, 'concurrent', market_id, buyer_id, buyer_type_id, purpose, purpose_missing, attributed_position_id,
           attribution_source, attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id,
           created_by, created_by_type FROM sales_order WHERE id = $1 RETURNING id`, [orders[0]])).rows
      await ingest.query('COMMIT')
      expect((await committing).statusCode).toBe(200)
      expect(await ownerRows('SELECT 1 FROM late_transaction WHERE order_id = $1', [copy!.id])).toHaveLength(1)
    } finally {
      ingest.release()
    }
  })
})
