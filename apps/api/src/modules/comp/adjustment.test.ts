import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule, type CaseRecord } from '../cas/index.js'
import { ADJUSTMENT_CASE_TYPE } from './adjustment.js'
import { compCaseTypes, compModule } from './index.js'
import {
  activePlan, calculate, commit, createWorld, evidenceDocument, inside, linesOf, member, order, ts10Plan, user, type Member, type World,
} from './test-support.js'

// T-B4-27 / T-B4-28: the adjustment case type (D-B4-09, FR-CAS-002) and its manual origins in runs, commits and
// restatements (AC-49.1, AC-49.2, AC-CAS2-1..3).

let app: FastifyInstance
closePoolsAfterAll()

const policy = (action: 'block' | 'escalate') =>
  ({ 'adjustments.policy': { second_approver_above_minor: '10000', new_account_days: 30, related_account_action: action } })

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, createCasModule({ types: compCaseTypes })] })
})

afterAll(async () => {
  await app.close()
})

interface Adjusting { w: World; a: Member }

async function adjusting(action: 'block' | 'escalate', settings = policy(action)): Promise<Adjusting> {
  const w = await createWorld({ settings })
  const a = await member(w, 'DE-A')
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 10_000)
  return { w, a }
}

const open = (w: World, positionId: string, periodId: string, amount: string, as: TestUser = w.analyst) => call(app, {
  method: 'POST', url: '/v1/cases', as, idempotencyKey: true,
  body: { type: 'adjustment', subject_type: 'position', subject_id: positionId, reason_code: 'COMMISSION_ERROR', payload: { period_id: periodId, amount_minor: amount, note: 'Missed bonus' } },
})

/** Opened, evidenced and submitted by `as`: the submitted case. */
async function proposed(w: World, positionId: string, periodId: string, amount: string, as: TestUser = w.analyst) {
  const opened = await open(w, positionId, periodId, amount, as)
  expect(opened.statusCode, opened.body).toBe(201)
  const caseId = opened.json().data.id as string
  await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as, idempotencyKey: true, body: { document_id: await evidenceDocument(as) } })
  const submitted = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as, body: {} })
  expect(submitted.statusCode, submitted.body).toBe(200)
  return submitted.json().data as CaseRecord<{ period_id: string; amount_minor: string; note: string }> & { effect_preview: Record<string, unknown> }
}

const decide = (caseId: string, as: TestUser) =>
  call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, idempotencyKey: true, body: { decision: 'approve', reason: 'Evidence checked' } })

const declareRelated = (w: World, u: TestUser, participantId: string, relation = 'relative') => ownerRows(
  `INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, $4, $2)`,
  [w.tenantId, u.id, participantId, relation])

const commitAs = (runId: string, as: TestUser) =>
  call(app, { method: 'POST', url: `/v1/runs/${runId}/commit`, as, idempotencyKey: true, body: { acknowledged_exceptions: [] } })

/** Waits until `count` other backends wait on a lock. */
async function lockWaiters(count: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const rows = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)
    if (rows[0]!.n >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`fewer than ${count} lock waiters`)
}

describe('adjustment case (FR-CAS-002, D-B4-09)', () => {
  test('T-B4-27 / AC-CAS2-1: amount 0, missing evidence, a period of another market, a committed period and an unset policy are refused', async () => {
    const { w, a } = await adjusting('escalate')
    expect((await open(w, a.positionId, w.periods[0]!.id, '0')).json().error.code).toBe('VALIDATION_FAILED')
    const opened = await open(w, a.positionId, w.periods[0]!.id, '500')
    expect(opened.statusCode, opened.body).toBe(201)
    const unproved = await call(app, { method: 'POST', url: `/v1/cases/${opened.json().data.id}/submit`, as: w.analyst, body: {} })
    expect(unproved.json().error.code).toBe('EVIDENCE_REQUIRED')
    const [fr] = await ownerRows<{ id: string }>(
      `WITH m AS (INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
                  VALUES ($1, 'FR', 'EUR', 2, 'Europe/Paris', '{fr}', 'none', 'live') RETURNING id),
            c AS (INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
                  SELECT $1, m.id, 'FR monthly', 'monthly', 'Europe/Paris', ($2::timestamptz AT TIME ZONE 'Europe/Paris')::date FROM m RETURNING id)
       INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at) SELECT $1, c.id, $3, $4 FROM c RETURNING id`,
      [w.tenantId, w.periods[0]!.starts_at, w.periods[0]!.starts_at, w.periods[0]!.ends_at])
    expect((await open(w, a.positionId, fr!.id, '500')).json().error.code).toBe('VALIDATION_FAILED')

    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    expect((await open(w, a.positionId, w.periods[0]!.id, '500')).json().error).toMatchObject({ code: 'PERIOD_NOT_OPEN', details: { state: 'committed' } })
    const unset = await createWorld()
    const b = await member(unset, 'DE-B')
    expect((await open(unset, b.positionId, unset.periods[0]!.id, '500')).json().error).toMatchObject({ code: 'SETTING_NOT_CONFIGURED', details: { key: 'adjustments.policy' } })
  })

  test('AC-49.1 block: a payee related to the proposer or enrolled within new_account_days is blocked', async () => {
    const { w, a } = await adjusting('block')
    await declareRelated(w, w.analyst, a.participantId, 'self')
    expect((await open(w, a.positionId, w.periods[0]!.id, '500')).json().error).toMatchObject({ code: 'ADJUSTMENT_BLOCKED', details: { reason: 'related_party' } })
    const newcomer = await member(w, 'DE-NEW', null, { since: new Date(Date.now() - 86_400_000).toISOString() })
    expect((await open(w, newcomer.positionId, w.periods[4]!.id, '500')).json().error).toMatchObject({ code: 'ADJUSTMENT_BLOCKED', details: { reason: 'new_account' } })
    const other = await user(w.tenantId, ['Commission analyst'])
    expect((await open(w, a.positionId, w.periods[0]!.id, '500', other)).statusCode).toBe(201)
  })

  test('AC-49.1 escalate: two approvals with the escalations listed; related approvers excluded; the proposer cannot approve', async () => {
    const { w, a } = await adjusting('escalate')
    await declareRelated(w, w.analyst, a.participantId)
    await declareRelated(w, w.finance2, a.participantId)
    const submitted = await proposed(w, a.positionId, w.periods[0]!.id, '-20000')
    expect(submitted.effect_preview).toMatchObject({
      payee: { participant: { id: a.participantId, external_ref: 'DE-A' }, position: { id: a.positionId, position_ref: 'DE-A' } },
      period: { id: w.periods[0]!.id, state: 'open' }, amount_minor: '-20000', approvals_required: 2,
      escalations: ['related_party', 'above_threshold'], included_in: 'next calculation of this period',
    })
    // BUG-109: the stored preview names no one (erasure cannot clear it); the view carries the current name.
    const [stored] = await ownerRows<{ names: string; name: string | null }>(
      `SELECT jsonb_path_query_array(f.effect_preview, 'strict $.**.display_name')::text AS names, p.display_name AS name FROM case_file f, participant p WHERE f.id = $1 AND p.id = $2`, [submitted.id, a.participantId])
    expect(stored!.names).toBe('[null]')
    expect(submitted.effect_preview).toMatchObject({ payee: { participant: { display_name: stored!.name } } })
    const hooks = await withTenant({ tenantId: w.tenantId, userId: w.finance.id }, async (tx) => ({
      approvals: await ADJUSTMENT_CASE_TYPE.approvalsRequired!(tx, submitted),
      excluded: await ADJUSTMENT_CASE_TYPE.excludedApprovers!(tx, submitted),
    }))
    expect(hooks.approvals).toBe(2)
    expect(hooks.excluded.sort()).toEqual([w.analyst.id, w.finance2.id].sort())
    expect((await decide(submitted.id, w.finance2)).json().error.code).toBe('SOD_SELF_APPROVAL') // declared related to the payee
    // D-B4-10: the first approval leaves it submitted; the origin is created by the final, second approval only.
    expect((await decide(submitted.id, w.finance)).json().data).toMatchObject({ state: 'submitted', first_approval: { approver: { id: w.finance.id } } })
    expect(await ownerRows('SELECT 1 FROM adjustment_origin WHERE case_id = $1', [submitted.id])).toHaveLength(0)
    const second = await decide(submitted.id, await user(w.tenantId, ['Finance approver']))
    expect(second.json().data).toMatchObject({ state: 'approved' })
    expect(await ownerRows('SELECT amount_minor::text AS amount FROM adjustment_origin WHERE case_id = $1', [submitted.id])).toEqual([{ amount: '-20000' }])
    const small = await proposed(w, a.positionId, w.periods[0]!.id, '100', await user(w.tenantId, ['Commission analyst']))
    // SEC-B4-7 (D-B5-21): the approved -200.00 of the same position and period counts towards the threshold.
    expect(small.effect_preview).toMatchObject({ approvals_required: 2, escalations: ['above_threshold'] })
    const proposer = await user(w.tenantId, ['Commission analyst', 'Finance approver'])
    const own = await proposed(w, a.positionId, w.periods[0]!.id, '100', proposer)
    expect((await decide(own.id, proposer)).json().error.code).toBe('SOD_SELF_APPROVAL')
  })

  test('SEC-B4-7 / D-B5-21: adjustments of one position and period add up towards the second-approver threshold', async () => {
    const { w, a } = await adjusting('escalate')
    expect((await proposed(w, a.positionId, w.periods[0]!.id, '6000')).effect_preview).toMatchObject({ approvals_required: 1, escalations: [] })
    // Another period of the same position, and a withdrawn case, do not count.
    expect((await proposed(w, a.positionId, w.periods[4]!.id, '6000')).effect_preview).toMatchObject({ approvals_required: 1 })
    const withdrawn = await proposed(w, a.positionId, w.periods[0]!.id, '-100')
    expect(withdrawn.effect_preview).toMatchObject({ approvals_required: 1 })
    await call(app, { method: 'POST', url: `/v1/cases/${withdrawn.id}/withdraw`, as: w.analyst, body: { reason: 'Duplicate' } })
    const split = await proposed(w, a.positionId, w.periods[0]!.id, '-4500')
    expect(split.effect_preview).toMatchObject({ approvals_required: 2, escalations: ['above_threshold'] })
    expect(split.approvals_required).toBe(2)
  })

  test('SEC-B4-7 / D-B5-21: two submits of one position at the same time are serialised, so the second counts the first', async () => {
    const { w, a } = await adjusting('escalate')
    const prepared = async () => {
      const opened = await open(w, a.positionId, w.periods[0]!.id, '6000')
      const id = opened.json().data.id as string
      await call(app, { method: 'POST', url: `/v1/cases/${id}/evidence`, as: w.analyst, idempotencyKey: true, body: { document_id: await evidenceDocument(w.analyst) } })
      return id
    }
    const ids = [await prepared(), await prepared()]
    const holder = await getOwnerPool().connect()
    try {
      // Holding the position's adjustment lock lines both submits up behind it, then releases them together.
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('adjustment:' || $1 || ':' || $2, 0))`, [w.tenantId, a.positionId])
      const submits = Promise.all(ids.map((id) => call(app, { method: 'POST', url: `/v1/cases/${id}/submit`, as: w.analyst, body: {} })))
      await lockWaiters(2)
      await holder.query('COMMIT')
      const required = (await submits).map((submitted) => submitted.json().data.approvals_required as number)
      expect(required.sort()).toEqual([1, 2])
    } finally {
      holder.release()
    }
  })

  test('AC-49.1 / BR-ADJ-03: a related assignee who edits, or a related user who submits, is checked like the opener', async () => {
    const blocked = await adjusting('block')
    await declareRelated(blocked.w, blocked.w.analyst, blocked.a.participantId, 'self')
    const opener = await user(blocked.w.tenantId, ['Commission analyst'])
    const opened = await open(blocked.w, blocked.a.positionId, blocked.w.periods[0]!.id, '500', opener)
    expect(opened.statusCode, opened.body).toBe(201)
    const caseId = opened.json().data.id as string
    const assigned = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/assign`, as: blocked.w.finance, body: { user_id: blocked.w.analyst.id } })
    expect(assigned.statusCode, assigned.body).toBe(200)
    const edited = await call(app, {
      method: 'PATCH', url: `/v1/cases/${caseId}`, as: blocked.w.analyst,
      body: { payload: { period_id: blocked.w.periods[0]!.id, amount_minor: '900', note: 'Missed bonus' } },
    })
    expect(edited.json().error).toMatchObject({ code: 'ADJUSTMENT_BLOCKED', details: { reason: 'related_party' } })

    const { w, a } = await adjusting('escalate')
    await declareRelated(w, w.analyst, a.participantId)
    const unrelated = await user(w.tenantId, ['Commission analyst'])
    const draft = await open(w, a.positionId, w.periods[0]!.id, '100', unrelated)
    const draftId = draft.json().data.id as string
    await call(app, { method: 'POST', url: `/v1/cases/${draftId}/evidence`, as: unrelated, idempotencyKey: true, body: { document_id: await evidenceDocument(unrelated) } })
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${draftId}/submit`, as: w.analyst, body: {} })
    expect(submitted.statusCode, submitted.body).toBe(200)
    expect(submitted.json().data).toMatchObject({ approvals_required: 2, effect_preview: { escalations: ['related_party'] } })
  })

  test('AC-49.2 / T-B4-28 / AC-CAS2-2: the approved origin is paid once by its period\'s run, consumed at commit, not repeated, and no restatement diff', async () => {
    const { w, a } = await adjusting('escalate')
    const adjustment = await proposed(w, a.positionId, w.periods[0]!.id, '1234')
    expect((await decide(adjustment.id, w.finance)).statusCode).toBe(200)
    const [origin] = await ownerRows<{ id: string }>('SELECT id FROM adjustment_origin WHERE case_id = $1 AND run_id IS NULL', [adjustment.id])
    expect(await auditActions(w.tenantId)).toContain('ADJUSTMENT.ORIGIN_CREATED')

    const first = await calculate(app, w, w.periods[0]!.id)
    const rerun = await calculate(app, w, w.periods[0]!.id)
    const manual = await ownerRows('SELECT run_id, origin_id, amount_minor::text AS amount FROM result_line WHERE origin_type = $1 AND run_id = ANY ($2::uuid[])', ['manual', [first, rerun]])
    expect(manual).toHaveLength(2)
    expect(manual).toEqual(expect.arrayContaining([{ run_id: first, origin_id: origin!.id, amount: '1234' }, { run_id: rerun, origin_id: origin!.id, amount: '1234' }]))
    await commit(app, w, rerun)
    expect(await ownerRows('SELECT consumed_run_id FROM adjustment_origin WHERE id = $1', [origin!.id])).toEqual([{ consumed_run_id: rerun }])
    const next = await calculate(app, w, w.periods[1]!.id)
    expect((await linesOf(next)).filter((l) => l.origin === 'manual')).toEqual([])

    const restatement = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.compliance, idempotencyKey: true,
      body: { type: 'restatement', subject_type: 'period', subject_id: w.periods[0]!.id, reason_code: 'INPUT_CORRECTION', payload: { note: 'Check' } },
    })
    const restatementId = restatement.json().data.id as string
    await call(app, { method: 'POST', url: `/v1/cases/${restatementId}/evidence`, as: w.compliance, idempotencyKey: true, body: { document_id: await evidenceDocument(w.compliance) } })
    const sandbox = await call(app, { method: 'POST', url: `/v1/cases/${restatementId}/submit`, as: w.compliance, body: {} })
    expect(sandbox.json().data.effect_preview).toMatchObject({ diff_total_minor: '0', empty: true })
  })

  test('AC-CAS2-1: approval after calculation supersedes the run (adjustments_changed); a decision once the period is committed is 409 PERIOD_NOT_OPEN', async () => {
    const { w, a } = await adjusting('escalate')
    const stale = await calculate(app, w, w.periods[0]!.id)
    const adjustment = await proposed(w, a.positionId, w.periods[0]!.id, '700')
    const late = await proposed(w, a.positionId, w.periods[0]!.id, '300')
    expect((await decide(adjustment.id, w.finance)).statusCode).toBe(200)
    await call(app, { method: 'GET', url: `/v1/runs/${stale}/review`, as: w.analyst })
    expect((await commitAs(stale, w.finance)).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'adjustments_changed', case_ids: [adjustment.id] } })

    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    expect((await decide(late.id, w.finance)).json().error).toMatchObject({ code: 'PERIOD_NOT_OPEN', details: { state: 'committed' } })
    expect(await ownerRows('SELECT state FROM case_file WHERE id = $1', [late.id])).toEqual([{ state: 'submitted' }])
  })

  test('an approval while a run holds the period row answers 409 PERIOD_NOT_OPEN busy at once, not a deadlock (40P01)', async () => {
    const { w, a } = await adjusting('escalate')
    const adjustment = await proposed(w, a.positionId, w.periods[0]!.id, '700')
    const holder = await getOwnerPool().connect()
    try {
      await holder.query('BEGIN')
      // What requestRun, finishRun and failRun hold before they take the audit lock the decision already holds.
      expect((await holder.query('SELECT id FROM period WHERE id = $1 FOR NO KEY UPDATE', [w.periods[0]!.id])).rowCount).toBe(1)
      expect((await decide(adjustment.id, w.finance)).json().error).toMatchObject({ code: 'PERIOD_NOT_OPEN', details: { state: 'busy' } })
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
    expect(await ownerRows('SELECT state FROM case_file WHERE id = $1', [adjustment.id])).toEqual([{ state: 'submitted' }])
    expect((await decide(adjustment.id, w.finance)).statusCode).toBe(200)
  })

  test('AC-CAS2-3: an approval racing a commit (two connections) never leaves a committed period with an unconsumed manual origin', async () => {
    const { w, a } = await adjusting('escalate')
    const runId = await calculate(app, w, w.periods[0]!.id)
    await call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as: w.analyst })
    const adjustment = await proposed(w, a.positionId, w.periods[0]!.id, '700')
    const holder = await getOwnerPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('periods:' || $1 || ':' || $2, 0))`, [w.tenantId, w.marketId])
      const racing = Promise.all([commitAs(runId, w.finance), decide(adjustment.id, w.finance2)])
      await new Promise((resolve) => setTimeout(resolve, 300))
      await holder.query('COMMIT')
      const [committed, decided] = await racing
      const outcome = [committed.json().error?.details?.reason ?? committed.statusCode, decided.json().error?.code ?? decided.statusCode]
      expect([['adjustments_changed', 200], [200, 'PERIOD_NOT_OPEN']]).toContainEqual(outcome)
    } finally {
      holder.release()
    }
    expect(await ownerRows(
      `SELECT o.id FROM adjustment_origin o JOIN period p ON p.id = o.original_period_id
       WHERE o.case_id = $1 AND o.consumed_run_id IS NULL AND p.state = 'committed'`, [adjustment.id])).toEqual([])
  })

  test('AC-CAS2-3: an approval in flight when the commit arrives commits first; the commit then answers 409 adjustments_changed', async () => {
    const { w, a } = await adjusting('escalate')
    const runId = await calculate(app, w, w.periods[0]!.id)
    await call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as: w.analyst })
    const adjustment = await proposed(w, a.positionId, w.periods[0]!.id, '700')
    const holder = await getOwnerPool().connect()
    try {
      // The holder's uncommitted origin of the same case: the approval stops at its own insert (unique case_id), after it
      // took the periods lock shared, and stays in flight while the commit arrives and waits for that lock.
      await holder.query('BEGIN')
      await holder.query('SET LOCAL session_replication_role = replica')
      await holder.query(
        `INSERT INTO adjustment_origin (tenant_id, origin_type, case_id, payee_position_id, rule_key, source_kind, amount_minor, original_period_id)
         VALUES ($1, 'manual', $2, $3, 'manual_adjustment', 'other', 700, $4)`, [w.tenantId, adjustment.id, a.positionId, w.periods[0]!.id])
      const decided = decide(adjustment.id, w.finance2)
      await lockWaiters(1)
      const committed = commitAs(runId, w.finance)
      await lockWaiters(2)
      await holder.query('ROLLBACK')
      expect((await decided).statusCode).toBe(200)
      expect((await committed).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'adjustments_changed', case_ids: [adjustment.id] } })
    } finally {
      await holder.query('ROLLBACK') // no-op once rolled back above
      holder.release()
    }
    expect(await ownerRows('SELECT state FROM period WHERE id = $1', [w.periods[0]!.id])).toEqual([{ state: 'calculated' }])
  })
})
