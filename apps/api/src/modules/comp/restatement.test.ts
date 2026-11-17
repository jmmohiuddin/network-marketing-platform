import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { compCaseTypes, compModule } from './index.js'
import {
  activePlan, calculate, commit, createWorld, evidenceDocument, inside, lateItem, linesOf, member, order, orderEvent, ts10Plan, user,
  type Member, type Policy, type World,
} from './test-support.js'

// T-B3-26: restatement case lifecycle (FR-COMP-009, D-B3-14).

let app: FastifyInstance
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, createCasModule({ types: compCaseTypes })] })
})

afterAll(async () => {
  await app.close()
})

interface Ts10 { w: World; a: Member; c: Member; o2: string; firstRun: string }

async function committedTs10(rank: Policy): Promise<Ts10> {
  const w = await createWorld()
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan({ rank }), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  const o2 = await order(w, a, inside(w.periods[0]!, 2), 50_000)
  const firstRun = await calculate(app, w, w.periods[0]!.id)
  await commit(app, w, firstRun)
  return { w, a, c, o2, firstRun }
}

const openCase = (w: World, periodId: string, as: TestUser = w.compliance) => call(app, {
  method: 'POST', url: '/v1/cases', as, idempotencyKey: true,
  body: { type: 'restatement', subject_type: 'period', subject_id: periodId, reason_code: 'INPUT_CORRECTION', payload: { note: 'Refund missed at commit' } },
})

/** Open, attach evidence, submit: the submitted case. */
async function submitted(w: World, periodId: string): Promise<{ id: string; effect_preview: Record<string, unknown> }> {
  const opened = await openCase(w, periodId)
  expect(opened.statusCode, opened.body).toBe(201)
  const caseId = opened.json().data.id
  await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.compliance, idempotencyKey: true, body: { document_id: await evidenceDocument(w.compliance) } })
  const response = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.compliance, body: {} })
  expect(response.statusCode, response.body).toBe(200)
  return response.json().data
}

const decide = (caseId: string, as: TestUser, decision: 'approve' | 'reject' = 'approve') =>
  call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, idempotencyKey: true, body: { decision, reason: 'Checked against the refund evidence' } })

const lines = async (restatementId: string, as: TestUser) =>
  (await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}/lines`, as })).json().data as Record<string, string>[]

describe('restatement case (FR-COMP-009)', () => {
  test('TS-10 restatement / TS-51 / AC-09.1: diff A -65.00, C -13.00; approval -> origins; next run pays them; applied; P unchanged and replays', async () => {
    const { w, a, c, o2, firstRun } = await committedTs10('restatement')
    const [{ lines_hash: hash }] = await ownerRows<{ lines_hash: string }>('SELECT lines_hash FROM run WHERE id = $1', [firstRun]) as [{ lines_hash: string }]
    const late = await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!)) }, w.periods[0]!.id, 'restatement')
    // D-B3-14: a pending item could still turn into an adjust clawback (its handling changes while pending), counting
    // the refund a second time beside the frozen diff: submit is refused until it is decided.
    const caseId = (await openCase(w, w.periods[0]!.id)).json().data.id
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.compliance, idempotencyKey: true, body: { document_id: await evidenceDocument(w.compliance) } })
    const blocked = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.compliance, body: {} })
    expect(blocked.json().error).toMatchObject({ code: 'LATE_ITEMS_PENDING', details: { late_ids: [late] } })
    await ownerRows(`UPDATE late_transaction SET state = 'decided', decided_by = $2, decided_at = now() WHERE id = $1`, [late, w.compliance.id])
    await expect(ownerRows(`UPDATE late_transaction SET handling = 'adjust' WHERE id = $1`, [late])).rejects.toMatchObject({ code: '23514' })

    const submittedCase = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.compliance, body: {} })
    expect(submittedCase.statusCode, submittedCase.body).toBe(200)
    const restatementCase = submittedCase.json().data as { id: string; effect_preview: Record<string, unknown> }
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['SIMULATION.REQUESTED', 'SIMULATION.COMPLETED']))

    expect(restatementCase.effect_preview).toMatchObject({ period: { id: w.periods[0]!.id }, diff_total_minor: '-7800', payees: 2, empty: false })
    expect(restatementCase.effect_preview.by_rule).toEqual([{ rule_key: 'match', diff_minor: '-1300' }, { rule_key: 'rank_bonus', diff_minor: '-6500' }])
    const restatementId = restatementCase.effect_preview.restatement_id as string
    expect(await lines(restatementId, w.compliance)).toEqual(expect.arrayContaining([
      { payee_position_id: a.positionId, payee_participant_id: a.participantId, rule_key: 'rank_bonus', committed_minor: '8000', applied_adjustments_minor: '0', restated_minor: '1500', diff_minor: '-6500' },
      { payee_position_id: c.positionId, payee_participant_id: c.participantId, rule_key: 'match', committed_minor: '1600', applied_adjustments_minor: '0', restated_minor: '300', diff_minor: '-1300' },
    ]))
    expect((await decide(restatementCase.id, w.compliance)).statusCode).toBe(403)
    expect((await decide(restatementCase.id, w.finance)).statusCode).toBe(200)
    expect(await ownerRows(`SELECT amount_minor::text AS amount FROM adjustment_origin WHERE restatement_id = $1 ORDER BY amount_minor`, [restatementId]))
      .toEqual([{ amount: '-6500' }, { amount: '-1300' }])

    const next = await calculate(app, w, w.periods[1]!.id)
    expect((await linesOf(next)).filter((l) => l.origin === 'restatement').map((l) => l.amount).sort()).toEqual(['-1300', '-6500'])
    expect(await ownerRows('SELECT 1 FROM adjustment_origin WHERE late_transaction_id = $1', [late])).toHaveLength(0)
    const exceptions = (await call(app, { method: 'GET', url: `/v1/runs/${next}/review`, as: w.analyst })).json().data.exceptions
    expect(exceptions).toContainEqual(expect.objectContaining({ id: `restatement_state:${restatementId}`, blocking: false }))
    // The approved restatement counted the item: no lasting origin_skipped exception for it.
    expect(exceptions.map((e: { id: string }) => e.id)).not.toContain(`origin_skipped:${late}`)
    await commit(app, w, next)
    const detail = await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}`, as: w.finance })
    expect(detail.json().data).toMatchObject({ id: restatementId, case_id: restatementCase.id, case_state: 'approved', state: 'applied', applied_in_run_id: next, diff_total_minor: '-7800' })
    expect((await ownerRows<{ lines_hash: string }>('SELECT lines_hash FROM run WHERE id = $1', [firstRun]))[0]!.lines_hash).toBe(hash)
    const replay = await call(app, { method: 'POST', url: `/v1/runs/${firstRun}/replay`, as: w.analyst })
    expect(replay.json().data).toMatchObject({ status: 'match', lines_hash: hash })
  })

  test('AC-RST-2 / AC-RST-3: a pending adjust refund blocks submit; after its clawback (A -50.00) the restatement adds only A -15.00, C -13.00', async () => {
    const { w, a, c, o2 } = await committedTs10('order_line')
    const late = await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const opened = await openCase(w, w.periods[0]!.id)
    const caseId = opened.json().data.id
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.compliance, idempotencyKey: true, body: { document_id: await evidenceDocument(w.compliance) } })
    const blocked = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.compliance, body: {} })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toMatchObject({ code: 'LATE_ITEMS_PENDING', details: { late_ids: [late] } })

    await commit(app, w, await calculate(app, w, w.periods[1]!.id))
    const submittedAgain = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.compliance, body: {} })
    expect(submittedAgain.statusCode, submittedAgain.body).toBe(200)
    const preview = submittedAgain.json().data.effect_preview
    expect(preview.diff_total_minor).toBe('-2800')
    expect(await lines(preview.restatement_id, w.finance)).toEqual(expect.arrayContaining([
      expect.objectContaining({ payee_position_id: a.positionId, committed_minor: '8000', applied_adjustments_minor: '-5000', restated_minor: '1500', diff_minor: '-1500' }),
      expect.objectContaining({ payee_position_id: c.positionId, committed_minor: '1600', applied_adjustments_minor: '0', restated_minor: '300', diff_minor: '-1300' }),
    ]))
  })

  test('AC-RST-1: empty diff is applied at approval with no origins; an open restatement and an uncommitted period are refused', async () => {
    const { w } = await committedTs10('order_line')
    const first = await submitted(w, w.periods[0]!.id)
    expect(first.effect_preview).toMatchObject({ diff_total_minor: '0', empty: true, payees: 0 })
    const again = await openCase(w, w.periods[0]!.id)
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('RESTATEMENT_OPEN')
    expect((await decide(first.id, w.finance)).statusCode).toBe(200)
    const restatementId = first.effect_preview.restatement_id as string
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}`, as: w.compliance })).json().data.state).toBe('applied')
    expect(await ownerRows('SELECT 1 FROM adjustment_origin WHERE restatement_id = $1', [restatementId])).toHaveLength(0)
    const open = await openCase(w, w.periods[1]!.id)
    expect(open.statusCode).toBe(409)
    expect(open.json().error.code).toBe('PERIOD_NOT_COMMITTED')
  })

  test('AC-RST-4: a withdrawn case reads withdrawn; a new case of the period is then decided normally (rejected here)', async () => {
    const { w } = await committedTs10('order_line')
    const first = await submitted(w, w.periods[0]!.id)
    const withdrawn = await call(app, { method: 'POST', url: `/v1/cases/${first.id}/withdraw`, as: w.compliance, body: { reason: 'Filed against the wrong period' } })
    expect(withdrawn.statusCode, withdrawn.body).toBe(200)
    const restatementId = first.effect_preview.restatement_id as string
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}`, as: w.compliance })).json().data.state).toBe('withdrawn')
    const second = await submitted(w, w.periods[0]!.id)
    expect((await decide(second.id, w.finance, 'reject')).statusCode).toBe(200)
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${second.effect_preview.restatement_id as string}`, as: w.compliance })).json().data.state).toBe('rejected')
  })

  test('restatement reads: permission, other tenant, validation', async () => {
    const { w } = await committedTs10('order_line')
    const restatementId = (await submitted(w, w.periods[0]!.id)).effect_preview.restatement_id as string
    const outsider = await user(w.tenantId, ['Payout officer'])
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}`, as: outsider })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}/lines`, as: outsider })).statusCode).toBe(403)
    const other = await createWorld()
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}`, as: other.compliance })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}/lines`, as: other.compliance })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/restatements/nope', as: w.compliance })).statusCode).toBe(400)
    expect((await openCase(other, w.periods[0]!.id, other.compliance)).statusCode).toBe(422)
    expect((await call(app, { method: 'GET', url: `/v1/restatements/${restatementId}/lines?limit=1`, as: w.compliance })).json().meta.next_cursor).not.toBeNull()
  })
})
