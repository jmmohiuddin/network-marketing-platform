import { randomUUID } from 'node:crypto'
import { withTenant, type Tx } from '@nmp/db'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, mailsTo, ownerRows, resetApiDb, testConfig, type TestUser,
} from '../../../test/helpers/index.js'
import { runInTenant } from '../../lib/db.js'
import { createCasModule } from '../cas/index.js'
import { disputeDetail, listDisputes, openDispute, overdueDisputesJob } from './disputes.js'
import { compCaseTypes, compModule } from './index.js'
import { rankStatus } from './rank.js'
import { lineExplanation, listStatements, statementCsv, statementDetail } from './statements.js'
import {
  activePlan, calculate, commit, createWorld, evidenceDocument, inside, member, order, ownerUnchecked, SYSTEM, ts10Plan, user, type Member, type World,
} from './test-support.js'

// PLAN B5 section 2.2 in a portal transaction (app.participant_id set, as inPortal runs them): T-B5-11 statements,
// T-B5-13 explanation route, T-B5-14 rank status, T-B5-30 dispute lifecycle (TS-59 dispute part), T-B5-31 overdue job
// (TS-68 dispute part), T-B5-32 adjustment link, TS-53 API schema part. Other participants' and tenants' objects are 404.

interface Portal { readonly tenantId: string; readonly id: string; readonly participantId: string }

let app: FastifyInstance
let w: World
let a: Member // participant A's first position
let a2: Member // A's second position (same participant)
let c: Member
let d: Member // a participant without lines
let pa: Portal
let pd: Portal
let stranger: Portal // another tenant
let runId: string
let openRunId: string
const log = fastify({ logger: false }).log
closePoolsAfterAll()

/** A portal account of the participant (owner fixture, as IAM's invitation acceptance leaves it). */
async function portalUser(tenantId: string, participantId: string): Promise<Portal> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state, participant_id) VALUES ($1, 'portal', $2, $3, 'active', $4) RETURNING id`,
    [tenantId, randomUUID(), `portal-${randomUUID().slice(0, 8)}@example.test`, participantId])
  return { tenantId, id: row!.id, participantId }
}

/** A portal transaction of `p` (inPortal: participant set, actor the portal user). */
const asPortal = <T>(p: Portal, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runInTenant({ tenantId: p.tenantId, userId: p.id, participantId: p.participantId }, { actorType: 'user', requestId: null, supportSessionId: null }, fn)

/** FIXTURE: a later settings version (non-money key) in force from now. */
const setSetting = (key: string, value: unknown) => ownerRows(
  `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
   SELECT $1, v.version + 1, now(), v.settings || jsonb_build_object($2::text, $3::jsonb), 'fixture', $4
   FROM tenant_setting_version v WHERE v.tenant_id = $1 ORDER BY v.version DESC LIMIT 1`,
  [w.tenantId, key, JSON.stringify(value), w.analyst.id])

const lineOf = async (positionId: string, run = runId) =>
  (await ownerRows<{ id: string }>(`SELECT id FROM result_line WHERE run_id = $1 AND payee_position_id = $2 AND rule_key = 'rank_bonus'`, [run, positionId]))[0]!.id

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const FORBIDDEN_FIELDS = /projection|potential|estimate|target/i
const keysOf = (value: unknown): string[] => (typeof value !== 'object' || value === null ? []
  : [...(Array.isArray(value) ? [] : Object.keys(value)), ...Object.values(value).flatMap(keysOf)])

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, createCasModule({ types: compCaseTypes })] })
  w = await createWorld({ settings: { 'adjustments.policy': { second_approver_above_minor: '100000', new_account_days: 30, related_account_action: 'escalate' } } })
  c = await member(w, 'DE-C')
  a = await member(w, 'DE-A', c)
  // A's second position, sponsored by C as well.
  const [second] = await ownerRows<{ id: string }>(
    `WITH p AS (INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
                VALUES ($1, 'DE-A2', $2, 'active', '2020-01-01', $4, 'system') RETURNING id),
          o AS (INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
                SELECT $1, p.id, $3, '2020-01-01', $4, 'system' FROM p)
     INSERT INTO relationship (tenant_id, kind, parent_position_id, child_position_id, valid_from, event_type, created_by, created_by_type)
     SELECT $1, 'sponsor', $5, p.id, '2020-01-01', 'enrolment', $4, 'system' FROM p RETURNING child_position_id AS id`,
    [w.tenantId, w.marketId, a.participantId, SYSTEM, c.positionId])
  a2 = { participantId: a.participantId, positionId: second!.id }
  d = await member(w, 'DE-D')
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 10_000)
  await order(w, a2, inside(w.periods[0]!), 20_000)
  // The authored rule row of rank_bonus (the fixture plan carries only the compiled document): its rendered text names it.
  await ownerUnchecked(
    `INSERT INTO plan_rule (tenant_id, plan_version_id, rule_key, kind, pass, params, reversal_policy, created_by, updated_by)
     SELECT tenant_id, id, 'rank_bonus', 'pay.percent_of_measure', '5', $2::jsonb, 'order_line', $3, $3 FROM plan_version WHERE tenant_id = $1`,
    [w.tenantId, JSON.stringify({ sourceKind: 'downline_volume', eligibleIf: null, measure: 'gv', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.05' }, { rank: 'R2', rate: '0.10' }] } }), w.analyst.id])
  runId = await calculate(app, w, w.periods[0]!.id)
  await commit(app, w, runId)
  await order(w, a, inside(w.periods[1]!), 30_000)
  openRunId = await calculate(app, w, w.periods[1]!.id) // calculated, never committed
  pa = await portalUser(w.tenantId, a.participantId)
  pd = await portalUser(w.tenantId, d.participantId)
  const other = await createWorld()
  stranger = await portalUser(other.tenantId, (await member(other, 'DE-X')).participantId)
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('T-B5-11 statements (FR-DIST-001, D-B5-07)', () => {
  test('AC-DIST1-1: only committed runs are listed; the commit announced the statement (statement.ready)', async () => {
    const list = await asPortal(pa, (tx) => listStatements(tx, pa.participantId, undefined, undefined, 12))
    expect(list).toEqual([{
      run_id: runId, period: { id: w.periods[0]!.id, starts_at: w.periods[0]!.starts_at, ends_at: w.periods[0]!.ends_at, state: 'committed' },
      market: { code: 'DE', currency: 'EUR', minor_unit: 2, time_zone: 'Europe/Berlin' }, committed_at: expect.any(Date), net_minor: '1500', payout_state: 'none',
    }])
    expect(await asPortal(pa, (tx) => listStatements(tx, pa.participantId, randomUUID(), undefined, 12))).toEqual([])
    expect(await asPortal(pd, (tx) => listStatements(tx, pd.participantId, undefined, undefined, 12))).toEqual([])
    expect(await ownerRows(`SELECT template, params ->> 'run_id' AS run_id, params ->> 'net_minor' AS net FROM notification WHERE recipient_participant_id = $1`, [a.participantId]))
      .toEqual([{ template: 'statement.ready', run_id: runId, net: '1500' }])
  })

  test('TS-22 / AC-04.1 / AC-04.2: lines per position with totals, summary, paid-as, payout status with blockers as codes only', async () => {
    await ownerRows(`INSERT INTO payout_hold (tenant_id, participant_id, market_id, reason, placed_by) VALUES ($1, $2, $3, 'Fraud review requested by Jane', $4)`,
      [w.tenantId, a.participantId, w.marketId, w.finance.id])
    const statement = await asPortal(pa, (tx) => statementDetail(tx, pa.participantId, runId, log))
    expect(statement.positions.map((p) => [p.position_ref, p.total_minor, p.bonuses.map((b) => [b.rule_key, b.total_minor])]))
      .toEqual([['DE-A', '500', [['rank_bonus', '500']]], ['DE-A2', '1000', [['rank_bonus', '1000']]]])
    expect(statement.positions[0]!.paid_as).toEqual([{ ladder: 'main', rank: 'R1' }])
    expect(statement.positions[0]!.bonuses[0]!.rule_name).toBe('Rank bonus') // BUG-119: the rule key in words
    expect(statement).toMatchObject({
      person_total_minor: '1500', disclosure_url: null,
      summary: { gross_minor: '1500', adjustment_minor: '0', clawback_minor: '0', withheld_minor: '0', net_minor: '1500' },
      payout: { instructions: [], blockers: [{ reason: 'no_bank_details' }, { reason: 'hold' }] },
    })
    const body = JSON.stringify(statement)
    expect(body).not.toContain('Fraud review')
    expect(body).not.toContain('placed_at')
    expect(keysOf(statement).filter((key) => FORBIDDEN_FIELDS.test(key))).toEqual([]) // TS-53 API part
  })

  test('404 for an uncommitted run, a run without own lines, another tenant and an unknown id; the self-scope policy hides other payees', async () => {
    for (const [p, id] of [[pa, openRunId], [pd, runId], [stranger, runId], [pa, randomUUID()]] as const) {
      await expect(asPortal(p, (tx) => statementDetail(tx, p.participantId, id, log))).rejects.toMatchObject({ statusCode: 404 })
    }
    // Even naming A as participant, D's portal transaction sees none of A's lines (RESTRICTIVE portal_self).
    await expect(asPortal(pd, (tx) => statementDetail(tx, a.participantId, runId, log))).rejects.toMatchObject({ statusCode: 404 })
  })

  test('AC-DIST1-3: the CSV carries the JSON figures as decimals and is audited; BUG-112: named by the Berlin start day', async () => {
    const file = await asPortal(pa, (tx) => statementCsv(tx, pa.participantId, runId, log))
    const berlinDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(w.periods[0]!.starts_at)
    expect(berlinDay).toMatch(/-01$/)
    expect(file.name).toBe(`statement-${berlinDay}.csv`)
    const rows = file.csv.trim().split('\r\n').map((row) => row.split(','))
    expect(rows[0]).toEqual(['record', 'position_ref', 'rule_key', 'line_id', 'origin_kind', 'original_period_id', 'amount', 'currency'])
    expect(rows.filter((r) => r[0] !== 'line').map((r) => [r[0], r[1], r[6]])).toEqual([
      ['record', 'position_ref', 'amount'], ['position_total', 'DE-A', '5.00'], ['position_total', 'DE-A2', '10.00'], ['person_total', '', '15.00'],
      ['gross', '', '15.00'], ['adjustment', '', '0.00'], ['clawback', '', '0.00'], ['withheld', '', '0.00'], ['net', '', '15.00'],
    ])
    expect(await auditActions(w.tenantId)).toContain('STATEMENT.DOWNLOADED')
  })

  test('portal routes refuse staff sessions (403 REALM_FORBIDDEN) and anonymous callers (401)', async () => {
    for (const url of ['/v1/me/statements', `/v1/me/statements/${runId}`, `/v1/me/statements/${runId}/download`, `/v1/me/statement-lines/${randomUUID()}/explanation`,
      '/v1/me/rank', '/v1/me/disputes', `/v1/me/disputes/${randomUUID()}`]) {
      expect((await call(app, { method: 'GET', url, as: w.analyst })).json().error.code).toBe('REALM_FORBIDDEN')
      expect((await call(app, { method: 'GET', url })).statusCode).toBe(401)
    }
    expect((await call(app, { method: 'POST', url: '/v1/me/disputes', as: w.analyst, idempotencyKey: true, body: { line_id: randomUUID(), message: 'x' } })).statusCode).toBe(403)
  })
})

describe('T-B5-13 line explanation (FR-DIST-002, D-B5-08)', () => {
  test('AC-12.1: rule, base, rate, rank, period and rounding; every uuid is the line, run, period or an own position', async () => {
    const lineId = await lineOf(a.positionId)
    const body = await asPortal(pa, (tx) => lineExplanation(tx, pa.participantId, lineId, log))
    expect(body).toMatchObject({
      line_id: lineId, run_id: runId, template: 'percent_of_measure', rule: { key: 'rank_bonus', kind: 'pay.percent_of_measure' },
      amount_minor: '500', currency: 'EUR', rank_used: [{ ladder: 'main', rank: 'R1' }], reconciles: true,
      parts: [{ label: 'your own volume', count: 1, base: '100.00', base_unit: 'volume', rate: '0.05', contribution: '5.00' }],
    })
    const allowed = new Set([lineId, runId, w.periods[0]!.id, a.positionId, a2.positionId])
    expect((JSON.stringify(body).match(UUID) ?? []).filter((id) => !allowed.has(id))).toEqual([])
  })

  test('404 for another participant\'s line, a line of an uncommitted run and another tenant', async () => {
    const lineId = await lineOf(a.positionId)
    await expect(asPortal(pd, (tx) => lineExplanation(tx, pd.participantId, lineId, log))).rejects.toMatchObject({ statusCode: 404 })
    await expect(asPortal(stranger, (tx) => lineExplanation(tx, stranger.participantId, lineId, log))).rejects.toMatchObject({ statusCode: 404 })
    const uncommitted = await lineOf(a.positionId, openRunId)
    await expect(asPortal(pa, (tx) => lineExplanation(tx, pa.participantId, uncommitted, log))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('T-B5-14 rank status (FR-DIST-003, D-B5-09)', () => {
  test('AC-DIST3-1/2/3: committed values, one not-final row from the calculated open-period run, requirements, scheduled plan change', async () => {
    const status = await asPortal(pa, (tx) => rankStatus(tx, pa.participantId, a.positionId, undefined, 12))
    expect(status.data.position).toEqual({ id: a.positionId, position_ref: 'DE-A' })
    expect(status.data.periods.map((p) => [p.period.id, p.final, p.run_id])).toEqual([[w.periods[1]!.id, false, null], [w.periods[0]!.id, true, runId]])
    expect(status.data.periods[1]).toMatchObject({ paid_as: [{ ladder: 'main', rank: 'R1' }], titles: [{ ladder: 'main', rank: 'R1' }], measures: expect.arrayContaining([{ measure: 'pv', value: '10000' }]) })
    expect(status.data.requirements).toEqual([{
      ladder: 'main', rank: 'R1', status: 'held',
      items: [{ kind: 'measure', text: 'pv at least 0.01', measure: 'pv', required: '1', measured: '10000', met: true }],
    }])
    expect(status.data.transition_notice).toBeNull()
    expect(keysOf(status).filter((key) => FORBIDDEN_FIELDS.test(key))).toEqual([]) // TS-53 API part
    const [plan] = await ownerRows<{ plan_id: string }>('SELECT plan_id FROM plan_version WHERE id = (SELECT plan_version_id FROM run WHERE id = $1)', [runId])
    await activePlan(w, ts10Plan(), w.periods[5]!.starts_at, { planId: plan!.plan_id, version: 2, state: 'scheduled' })
    const later = await asPortal(pa, (tx) => rankStatus(tx, pa.participantId, a.positionId, undefined, 12))
    expect(later.data.transition_notice).toEqual({ effective_from: w.periods[5]!.starts_at })
  })

  test('another participant\'s or another tenant\'s position is 404', async () => {
    await expect(asPortal(pd, (tx) => rankStatus(tx, pd.participantId, a.positionId, undefined, 12))).rejects.toMatchObject({ statusCode: 404 })
    await expect(asPortal(stranger, (tx) => rankStatus(tx, stranger.participantId, a.positionId, undefined, 12))).rejects.toMatchObject({ statusCode: 404 })
    expect((await asPortal(pd, (tx) => rankStatus(tx, pd.participantId, undefined, undefined, 12))).data.position.position_ref).toBe('DE-D')
  })
})

describe('T-B5-30 dispute lifecycle (FR-CAS-003, D-B5-15, TS-59 dispute part)', () => {
  let disputeId: string

  test('AC-50.1: opened and submitted in the portal transaction with the line\'s trace, due after the market\'s response days', async () => {
    await setSetting('disputes.policy', { response_days: { [w.marketId]: 10 } })
    const lineId = await lineOf(a.positionId)
    const opened = await asPortal(pa, (tx) => openDispute(tx, pa.participantId, lineId, 'The rate should be 10 %.'))
    expect(opened).toMatchObject({ state: 'opened', due_at: expect.any(Date) })
    disputeId = opened.case_id
    const [stored] = await ownerRows<{ state: string; trace_equal: boolean; opened_by: string; market_id: string; days: number; reason_code: string }>(
      `SELECT c.state, c.payload -> 'trace' = l.trace AS trace_equal, c.opened_by, c.market_id, c.reason_code,
              round(extract(epoch FROM c.due_at - c.submitted_at) / 86400)::int AS days
       FROM case_file c JOIN result_line l ON l.id = c.subject_id WHERE c.id = $1`, [disputeId])
    expect(stored).toEqual({ state: 'submitted', trace_equal: true, opened_by: pa.id, market_id: w.marketId, days: 10, reason_code: 'DISTRIBUTOR_DISPUTE' })
    const detail = await call(app, { method: 'GET', url: `/v1/cases/${disputeId}`, as: w.analyst })
    expect(detail.statusCode, detail.body).toBe(200)
    expect(detail.json().data).toMatchObject({ type: 'dispute', payload: { line_id: lineId, message: 'The rate should be 10 %.' }, effect_preview: { line: { id: lineId, amount_minor: '500', rule_name: 'Rank bonus' }, position: { position_ref: 'DE-A' } } })
    expect(await asPortal(pa, (tx) => disputeDetail(tx, pa.participantId, disputeId))).toMatchObject({
      case_id: disputeId, line_id: lineId, run_id: runId, amount_minor: '500', state: 'opened', overdue: false, explanation: null,
    })
  })

  test('AC-CAS3-1: a second dispute of the line is 409 DISPUTE_OPEN; others\' lines and objects are 404', async () => {
    const lineId = await lineOf(a.positionId)
    await expect(asPortal(pa, (tx) => openDispute(tx, pa.participantId, lineId, 'Again'))).rejects.toMatchObject({ statusCode: 409, code: 'DISPUTE_OPEN', details: { case_id: disputeId } })
    await expect(asPortal(pd, (tx) => openDispute(tx, pd.participantId, lineId, 'Not mine'))).rejects.toMatchObject({ statusCode: 404 })
    const uncommitted = await lineOf(a.positionId, openRunId)
    await expect(asPortal(pa, (tx) => openDispute(tx, pa.participantId, uncommitted, 'Uncommitted'))).rejects.toMatchObject({ statusCode: 404 })
    await expect(asPortal(pd, (tx) => disputeDetail(tx, pd.participantId, disputeId))).rejects.toMatchObject({ statusCode: 404 })
    await expect(asPortal(stranger, (tx) => disputeDetail(tx, stranger.participantId, disputeId))).rejects.toMatchObject({ statusCode: 404 })
    expect(await asPortal(pd, (tx) => listDisputes(tx, pd.participantId, {}, 50))).toEqual([])
  })

  test('AC-50.1: staff never open a dispute (POST /v1/cases refused, DB guard 42501 outside a portal transaction or with another trace)', async () => {
    const lineId = await lineOf(a2.positionId)
    const refused = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.analyst, idempotencyKey: true,
      body: { type: 'dispute', subject_type: 'result_line', subject_id: lineId, reason_code: 'DISTRIBUTOR_DISPUTE', payload: {} },
    })
    expect(refused.json().error.code).toBe('REASON_CODE_INVALID')
    const insert = (tx: Tx, trace: string) => tx.query(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by, opened_by_kind)
       VALUES (app_tenant_id(), 'dispute', 'result_line', $1, 'DISTRIBUTOR_DISPUTE', 'open',
               jsonb_build_object('line_id', $6::text, 'run_id', $2::text, 'participant_id', $3::text, 'message', 'x', 'trace', $4::jsonb), $5, app_user_id(), 'user')`,
      [lineId, runId, a.participantId, trace, w.marketId, lineId])
    await expect(withTenant({ tenantId: w.tenantId, userId: w.analyst.id }, (tx) => insert(tx, '{}'))).rejects.toMatchObject({ code: '42501' })
    await expect(asPortal(pa, (tx) => insert(tx, '{"rule": "forged"}'))).rejects.toMatchObject({ code: '42501' })
  })

  test('AC-CAS3-3: under review when assigned; a related analyst may not decide; upheld with the reason as explanation and a notification', async () => {
    expect((await call(app, { method: 'POST', url: `/v1/cases/${disputeId}/assign`, as: w.analyst, body: { user_id: w.analyst.id } })).statusCode).toBe(200)
    expect((await asPortal(pa, (tx) => disputeDetail(tx, pa.participantId, disputeId))).state).toBe('under_review')
    const related = await user(w.tenantId, ['Commission analyst'])
    await ownerRows(`INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'relative', $2)`,
      [w.tenantId, related.id, a.participantId])
    const decide = (as: TestUser, decision: 'approve' | 'reject', reason: string, id = disputeId) =>
      call(app, { method: 'POST', url: `/v1/cases/${id}/decision`, as, idempotencyKey: true, body: { decision, reason } })
    expect((await decide(related, 'approve', 'Looks right')).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await decide(w.analyst, 'approve', 'The level 1 rate was applied wrongly.')).json().data).toMatchObject({ state: 'approved' })
    expect(await asPortal(pa, (tx) => disputeDetail(tx, pa.participantId, disputeId))).toMatchObject({ state: 'upheld', explanation: 'The level 1 rate was applied wrongly.' })
    expect(await ownerRows(`SELECT params ->> 'outcome' AS outcome FROM notification WHERE recipient_participant_id = $1 AND template = 'dispute.updated'`, [a.participantId]))
      .toEqual([{ outcome: 'upheld' }])
    // After the decision a new dispute of the same line is allowed; rejected = not upheld.
    const lineId = await lineOf(a.positionId)
    const again = await asPortal(pa, (tx) => openDispute(tx, pa.participantId, lineId, 'One more question'))
    expect((await decide(w.analyst, 'reject', 'Correct as paid.', again.case_id)).statusCode).toBe(200)
    expect((await asPortal(pa, (tx) => listDisputes(tx, pa.participantId, {}, 50))).map((x) => x.state)).toEqual(['not_upheld', 'upheld'])
  })

  test('T-B5-32 / AC-CAS3-4: an adjustment may settle an upheld dispute of its position with reason DISPUTE_UPHELD only, and only once', async () => {
    const [rejected] = await ownerRows<{ id: string }>(`SELECT id FROM case_file WHERE type = 'dispute' AND state = 'rejected' AND tenant_id = $1`, [w.tenantId])
    const open = (positionId: string, disputeCaseId: string, reason = 'DISPUTE_UPHELD', period = w.periods[4]!) => call(app, {
      method: 'POST', url: '/v1/cases', as: w.analyst, idempotencyKey: true,
      body: { type: 'adjustment', subject_type: 'position', subject_id: positionId, reason_code: reason, payload: { period_id: period.id, amount_minor: '500', note: 'Dispute upheld', dispute_case_id: disputeCaseId } },
    })
    expect((await open(a.positionId, rejected!.id)).json().error.code).toBe('VALIDATION_FAILED')
    expect((await open(a2.positionId, disputeId)).json().error.code).toBe('VALIDATION_FAILED')
    const submit = async (reason: string) => {
      const opened = await open(a.positionId, disputeId, reason)
      expect(opened.statusCode, opened.body).toBe(201)
      const id = opened.json().data.id as string
      await call(app, { method: 'POST', url: `/v1/cases/${id}/evidence`, as: w.analyst, idempotencyKey: true, body: { document_id: await evidenceDocument(w.analyst) } })
      return { id, submitted: await call(app, { method: 'POST', url: `/v1/cases/${id}/submit`, as: w.analyst, body: {} }) }
    }
    const mismatched = await submit('COMMISSION_ERROR')
    expect(mismatched.submitted.json().error.code).toBe('VALIDATION_FAILED')
    await call(app, { method: 'POST', url: `/v1/cases/${mismatched.id}/withdraw`, as: w.analyst, body: { reason: 'Wrong reason' } })
    expect((await submit('DISPUTE_UPHELD')).submitted.json().data).toMatchObject({ state: 'submitted', effect_preview: { dispute_case_id: disputeId } })
    // A second adjustment of the same dispute, in this or another open period, would pay it twice.
    for (const period of [w.periods[4]!, w.periods[3]!]) {
      expect((await open(a.positionId, disputeId, 'DISPUTE_UPHELD', period)).json().error)
        .toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'payload.dispute_case_id', message: 'another adjustment already settles this dispute' }] } })
    }
  })

  test('AC-CAS3-2: with window_days 30 a run committed 31 days ago is closed (422 DISPUTE_WINDOW_CLOSED)', async () => {
    await setSetting('disputes.policy', { window_days: 30, response_days: { [w.marketId]: 10 } })
    await ownerUnchecked(`UPDATE run SET committed_at = now() - interval '31 days' WHERE id = $1`, [runId])
    const refused = asPortal(pa, async (tx) => openDispute(tx, pa.participantId, await lineOf(a2.positionId), 'Late'))
    await expect(refused).rejects.toMatchObject({ statusCode: 422, code: 'DISPUTE_WINDOW_CLOSED', details: { closed_at: expect.any(Date) } })
    await ownerUnchecked(`UPDATE run SET committed_at = now() - interval '29 days' WHERE id = $1`, [runId])
    expect(await asPortal(pa, async (tx) => openDispute(tx, pa.participantId, await lineOf(a2.positionId), 'In time'))).toMatchObject({ state: 'opened' })
  })
})

describe('T-B5-31 overdue job (comp.disputes.overdue, TS-68 dispute part)', () => {
  test('a submitted dispute past due_at is escalated once, audited and mailed to each approver; it lists as overdue', async () => {
    const [open] = await ownerRows<{ id: string }>(`SELECT id FROM case_file WHERE type = 'dispute' AND state = 'submitted' AND tenant_id = $1`, [w.tenantId])
    await ownerUnchecked(`UPDATE case_file SET due_at = now() - interval '1 day' WHERE id = $1`, [open!.id])
    const run = () => overdueDisputesJob.run({ jobId: randomUUID(), log, config: testConfig() })
    const before = (await mailsTo(w.analyst.email)).length
    await run()
    await run()
    expect(await ownerRows(`SELECT actor_id, data ->> 'notified' AS notified FROM case_event WHERE case_id = $1 AND kind = 'escalated'`, [open!.id]))
      .toEqual([{ actor_id: null, notified: expect.any(String) }])
    expect((await auditActions(w.tenantId)).filter((action) => action === 'CASE.ESCALATED')).toHaveLength(1)
    expect((await mailsTo(w.analyst.email)).length - before).toBe(1)
    const listed = await call(app, { method: 'GET', url: '/v1/cases?type=dispute&overdue=true', as: w.analyst })
    expect(listed.json().data.map((x: { id: string }) => x.id)).toEqual([open!.id])
    expect((await asPortal(pa, (tx) => disputeDetail(tx, pa.participantId, open!.id))).overdue).toBe(true)
  })

  test('a mail failing after the escalation committed is logged; the next run neither escalates nor mails again', async () => {
    const opened = await asPortal(pa, async (tx) => openDispute(tx, pa.participantId, await lineOf(a.positionId), 'Still waiting'))
    await ownerUnchecked(`UPDATE case_file SET due_at = now() - interval '1 day' WHERE id = $1`, [opened.case_id])
    const before = (await mailsTo(w.analyst.email)).length
    await overdueDisputesJob.run({ jobId: randomUUID(), log, config: { ...testConfig(), mailDir: '/dev/null/unwritable' } })
    await overdueDisputesJob.run({ jobId: randomUUID(), log, config: testConfig() })
    expect(await ownerRows(`SELECT 1 FROM case_event WHERE case_id = $1 AND kind = 'escalated'`, [opened.case_id])).toHaveLength(1)
    expect((await mailsTo(w.analyst.email)).length).toBe(before)
  })
})

describe('AC-DIST1-2 / AC-DIST3-4 transferred position', () => {
  test('a line stays under its position on the original payee\'s statement; the buyer sees no period before the transfer', async () => {
    await ownerRows(`UPDATE position_ownership SET valid_to = now() WHERE position_id = $1 AND valid_to IS NULL`, [a2.positionId])
    await ownerRows(
      `INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type) VALUES ($1, $2, $3, now(), $4, 'system')`,
      [w.tenantId, a2.positionId, d.participantId, SYSTEM])
    const statement = await asPortal(pa, (tx) => statementDetail(tx, pa.participantId, runId, log))
    expect(statement.positions.map((p) => p.position_ref)).toEqual(['DE-A', 'DE-A2'])
    const bought = await asPortal(pd, (tx) => rankStatus(tx, pd.participantId, a2.positionId, undefined, 12))
    expect(bought.data.periods.filter((p) => p.final)).toEqual([])
    await expect(asPortal(pd, (tx) => statementDetail(tx, pd.participantId, runId, log))).rejects.toMatchObject({ statusCode: 404 })
  })
})

