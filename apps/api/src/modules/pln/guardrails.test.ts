// Guardrails on plan rules: TS-27 (blocked save, stored decision), TS-26 (warning, acknowledgement, submit gate),
// T-B3-30 decision storage (AC-CPL7-1/2/3), TS-66 + T-B3-31 overrides (AC-CPL8-1) and the SC-11 decision reads.
import { createHash, randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { cplModule } from '../cpl/index.js'
import { plnModule } from './index.js'
import { CAPPED, customRoleUser, newPlan, personal, putRule, revisionOf, world, type NewPlan, type World } from './test-support.js'

let app: FastifyInstance
let w: World
let other: World

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [plnModule, cplModule], env: { LOG_LEVEL: 'error' } })
  w = await world()
  other = await world()
}, 120_000)

afterAll(async () => {
  await app.close()
})

const ENROLLED = { kind: 'count.enrolled', params: { measure: 'pv', atLeastMinor: '0' } }
const SIGNUP = { kind: 'pay.percent_of_measure', reversal_policy: 'restatement', params: { sourceKind: 'enrolment_order', eligibleIf: null, measure: 'enrolled', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.1' }] } } }
const LADDER = { kind: 'ladder', params: { ranks: [{ key: 'R1', requires: [{ kind: 'measure', measure: 'pv', atLeastMinor: '10000', window: { type: 'period' }, maxPerLegShare: null }], maintenance: null }] } }

const decisions = (versionPlanId: string) => ownerRows<{ id: string; kind: string; outcome: string; rule_id: string; detail: { rule_keys: string[]; opaque: boolean } }>(
  'SELECT d.id, d.kind, d.outcome, d.rule_id, d.detail FROM guardrail_decision d JOIN plan_version v ON v.id = d.plan_version_id WHERE v.plan_id = $1 ORDER BY d.decided_at, d.id', [versionPlanId])
const post = (as: TestUser, url: string, body: unknown = {}) => call(app, { method: 'POST', url, as, body, idempotencyKey: true })
const ack = (as: TestUser, planId: string, id: string) => post(as, `/v1/plans/${planId}/versions/1/guardrail-decisions/${id}/acknowledge`)
const override = (as: TestUser, id: string, body: Record<string, unknown> = {}) => post(as, `/v1/guardrail-decisions/${id}/override`, { justification: 'Starter kits count as product volume under the 2026 plan memo.', ...body })

async function evidence(userId: string): Promise<string> {
  const id = randomUUID()
  await ownerRows(
    `INSERT INTO document (id, tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by, file_name)
     VALUES ($1, $2, 'evidence', $3, $4, 'application/pdf', 1024, $5, 1, $5, 'memo.pdf')`,
    [id, w.tenantId, `documents/${id}`, createHash('sha256').update(id).digest(), userId],
  )
  return id
}

describe('TS-27 / AC-26.1: a blocked, non-overridable match refuses the save and its decision commits', () => {
  test('422 GUARDRAIL_BLOCKED with the rule, nothing saved, one evaluation row even when saved twice', async () => {
    const plan = await newPlan(app, w)
    await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal() })
    await putRule(app, w.planadmin, plan.planId, 'enrolled', ENROLLED)
    const refused = await putRule(app, w.planadmin, plan.planId, 'signup', SIGNUP)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'GUARDRAIL_BLOCKED', details: { rule_id: `${w.pack}-enrolment@2026-01-01`, title: 'FIXTURE enrolment-only pay', basis_status: 'screening', explanation: expect.stringContaining('signup'), decision_id: expect.any(String) } })
    expect((await ownerRows('SELECT 1 FROM plan_rule r JOIN plan_version v ON v.id = r.plan_version_id WHERE v.plan_id = $1 AND r.rule_key = $2', [plan.planId, 'signup']))).toEqual([])
    expect((await decisions(plan.planId)).filter((d) => d.outcome === 'blocked')).toMatchObject([{ kind: 'evaluation', detail: { rule_keys: ['enrolled', 'pv', 'signup'], opaque: false } }])
    expect((await putRule(app, w.planadmin, plan.planId, 'signup', SIGNUP)).json().error.code).toBe('GUARDRAIL_BLOCKED')
    expect((await decisions(plan.planId)).filter((d) => d.outcome === 'blocked')).toHaveLength(1)
    const blockedId = refused.json().error.details.decision_id
    expect((await ack(w.planadmin, plan.planId, blockedId)).json().error.code).toBe('NOT_WARNED')
    expect((await override(w.compliance, blockedId)).json().error.code).toBe('NOT_OVERRIDABLE')
  })
})

describe('TS-26 / AC-26.2, AC-CPL7-1/2/3: warnings, acknowledgements and current evaluations', () => {
  let plan: NewPlan
  let warned: string
  beforeAll(async () => {
    plan = await newPlan(app, w)
    const saved = await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().data.guardrails.new_decisions).toMatchObject([{ outcome: 'warned', rule_id: `${w.pack}-starter@2026-01-01`, overridable: true }])
    warned = saved.json().data.guardrails.new_decisions[0].id
    const revision = await revisionOf(app, w.planadmin, plan.planId)
    await call(app, { method: 'PATCH', url: `/v1/plans/${plan.planId}/versions/1`, as: w.planadmin, body: { crediting_event: 'paid' }, headers: { 'if-match': `"${revision}"` } })
  }, 60_000)

  test('AC-CPL7-2: identical content adds no row; decision rows cannot be changed', async () => {
    const before = (await decisions(plan.planId)).length
    expect((await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })).json().data.guardrails.new_decisions).toEqual([])
    expect((await post(w.planadmin, `/v1/plans/${plan.planId}/versions/1/guardrails/evaluate`)).json().data.new_decisions).toEqual([])
    expect(await decisions(plan.planId)).toHaveLength(before)
    const update = await withTenant({ tenantId: w.tenantId, userId: w.planadmin.id }, (tx) => tx.query("UPDATE guardrail_decision SET outcome = 'reported' WHERE id = $1", [warned])).then(() => null, (e: { code?: string }) => e.code)
    const remove = await withTenant({ tenantId: w.tenantId, userId: w.planadmin.id }, (tx) => tx.query('DELETE FROM guardrail_decision WHERE id = $1', [warned])).then(() => null, (e: { code?: string }) => e.code)
    expect([update, remove]).toEqual(['42501', '42501'])
  })

  test('submit is refused while the warning is open; the acknowledgement clears it (TS-26)', async () => {
    const refused = await post(w.planadmin, `/v1/plans/${plan.planId}/versions/1/submit`)
    expect(refused.json().error).toMatchObject({ code: 'GUARDRAIL_OUTSTANDING', details: { decisions: [{ decision_id: warned, reason: 'acknowledgement_required' }] } })
    expect((await ack(w.compliance, plan.planId, warned)).statusCode).toBe(403)
    expect((await ack(other.planadmin, plan.planId, warned)).statusCode).toBe(404)
    const acknowledged = await ack(w.planadmin, plan.planId, warned)
    expect(acknowledged.statusCode).toBe(201)
    expect(acknowledged.json().data).toMatchObject({ kind: 'acknowledgement', refers_to_decision_id: warned, outcome: 'warned' })
    expect((await ack(w.planadmin, plan.planId, warned)).json().error.code).toBe('ALREADY_ACKNOWLEDGED')
  })

  test('AC-CPL7-3: an unrelated rule keeps the resolution; editing pv needs a new acknowledgement; AC-CPL7-1 opaque', async () => {
    const capped = await putRule(app, w.planadmin, plan.planId, 'capped', CAPPED)
    expect(capped.json().data.guardrails.new_decisions).toEqual([])
    expect((await ownerRows('SELECT * FROM guardrail_outstanding((SELECT id FROM plan_version WHERE plan_id = $1))', [plan.planId]))).toEqual([])
    const edited = await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', ['sample']) })
    expect(edited.json().data.guardrails.new_decisions).toMatchObject([{ outcome: 'warned' }])
    expect(edited.json().data.guardrails.new_decisions[0].id).not.toBe(warned)
    const opaque = await putRule(app, w.planadmin, plan.planId, 'capped_pay', { kind: 'pay.percent_of_measure', reversal_policy: 'restatement', params: { ...SIGNUP.params, measure: 'capped' } })
    expect(opaque.json().data.guardrails.new_decisions).toMatchObject([{ outcome: 'warned', detail: { opaque: true, rule_keys: ['capped', 'capped_pay', 'pv'] } }])
  })

  test('a guardrail rule whose outcome changed keeps the stored evaluation of the same content (no 500)', async () => {
    const plan = await newPlan(app, other)
    await putRule(app, other.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })
    const ruleId = `${other.pack}-starter@2026-01-01`
    await ownerRows("UPDATE guardrail_rule SET outcome = 'reported' WHERE id = $1", [ruleId])
    try {
      const again = await post(other.planadmin, `/v1/plans/${plan.planId}/versions/1/guardrails/evaluate`)
      expect([again.statusCode, again.json().data.new_decisions]).toEqual([200, []])
    } finally {
      await ownerRows("UPDATE guardrail_rule SET outcome = 'warned' WHERE id = $1", [ruleId])
    }
  })

  test('evaluate: missing permission and cross-tenant denial', async () => {
    expect((await post(w.compliance, `/v1/plans/${plan.planId}/versions/1/guardrails/evaluate`)).statusCode).toBe(403)
    expect((await post(other.planadmin, `/v1/plans/${plan.planId}/versions/1/guardrails/evaluate`)).statusCode).toBe(404)
  })
})

describe('TS-66 / T-B3-31 overrides and the SC-11 decision log', () => {
  test('override with justification, approval and evidence; refusals of AC-CPL8-1', async () => {
    const editor = await customRoleUser(w.tenantId, ['plan.read', 'plan.edit', 'override.approve', 'guardrail.read'])
    const plan = await newPlan(app, w)
    const saved = await putRule(app, editor, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })
    const id = saved.json().data.guardrails.new_decisions[0].id
    expect((await override(editor, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await override(w.compliance, id, { justification: 'too short' })).json().error.code).toBe('VALIDATION_FAILED')
    const noStepUp = await createSignedInUser({ tenantId: w.tenantId, roles: ['Compliance officer'] })
    expect((await override(noStepUp, id)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await override(w.planadmin, id)).statusCode).toBe(403)
    expect((await override(other.compliance, id)).statusCode).toBe(404)
    const foreignDoc = await evidence(w.finance.id)
    expect((await override(w.compliance, id, { evidence_document_id: foreignDoc })).json().error.code).toBe('EVIDENCE_NOT_USABLE')
    const memo = await evidence(w.compliance.id)
    const done = await override(w.compliance, id, { evidence_document_id: memo })
    expect(done.statusCode).toBe(201)
    expect(done.json().data).toMatchObject({ kind: 'override', refers_to_decision_id: id, decided_by: { id: w.compliance.id } })
    expect((await override(w.compliance, id)).json().error.code).toBe('ALREADY_OVERRIDDEN')

    const log = await call(app, { method: 'GET', url: `/v1/guardrail-decisions?kind=override&plan_version_id=${done.json().data.plan_version_id}`, as: w.compliance })
    expect(log.json().data).toMatchObject([{ id: done.json().data.id, kind: 'override' }])
    const all = await call(app, { method: 'GET', url: `/v1/guardrail-decisions?plan_version_id=${done.json().data.plan_version_id}`, as: w.compliance })
    expect(all.json().meta.counts).toEqual({ blocked: 0, warned: 1, reported: 0, overridden: 1 })
    const evaluation = all.json().data.find((d: { id: string }) => d.id === id)
    expect(evaluation.override).toMatchObject({ approved_by: { id: w.compliance.id }, evidence_document_id: memo, justification: expect.stringContaining('Starter kits') })
    const detail = await call(app, { method: 'GET', url: `/v1/guardrail-decisions/${id}`, as: w.compliance })
    expect(detail.json().data.decisions.map((d: { kind: string }) => d.kind)).toEqual(['override'])
  })

  test('the author of a matched rule cannot override it when someone else triggered the evaluation (API and trigger)', async () => {
    const editor = await customRoleUser(w.tenantId, ['plan.read', 'plan.edit', 'override.approve', 'guardrail.read'])
    const plan = await newPlan(app, w)
    const ruleId = `${w.pack}-starter@2026-01-01`
    // The pack rule comes into force only after the editor wrote the measure it matches.
    await ownerRows("UPDATE guardrail_rule SET effective_to = '2026-01-02' WHERE id = $1", [ruleId])
    try {
      expect((await putRule(app, editor, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })).json().data.guardrails.new_decisions).toEqual([])
    } finally {
      await ownerRows('UPDATE guardrail_rule SET effective_to = NULL WHERE id = $1', [ruleId])
    }
    const id = (await post(w.planadmin, `/v1/plans/${plan.planId}/versions/1/guardrails/evaluate`)).json().data.new_decisions[0].id
    expect((await override(editor, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
    const [approval] = await ownerRows<{ id: string }>(
      `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason, factor_verified_at, decided_at)
       VALUES ($1, 'guardrail_decision', $2, $3, $4, 'approved', 'fixture', now(), now()) RETURNING id`, [w.tenantId, id, w.planadmin.id, editor.id])
    const forged = ownerRows(
      `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail, refers_to_decision_id, justification, approval_id, decided_by)
       SELECT tenant_id, rule_id, plan_version_id, 'override', outcome, content_sha256, detail, id, 'fixture justification text', $2, $3
       FROM guardrail_decision WHERE id = $1`, [id, approval!.id, editor.id])
    await expect(forged).rejects.toMatchObject({ message: expect.stringContaining('author of a rule') })
    expect((await override(w.compliance, id)).statusCode).toBe(201)
  })

  test('reads: missing permission, cross-tenant denial, market scope, filters and pagination', async () => {
    expect((await call(app, { method: 'GET', url: '/v1/guardrail-decisions', as: w.finance })).statusCode).toBe(403)
    const mine = (await call(app, { method: 'GET', url: '/v1/guardrail-decisions?limit=1', as: w.compliance })).json()
    expect(mine.data).toHaveLength(1)
    expect(mine.meta.next_cursor).not.toBeNull()
    const id = mine.data[0].id
    expect((await call(app, { method: 'GET', url: `/v1/guardrail-decisions/${id}`, as: other.compliance })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/guardrail-decisions', as: other.compliance })).json().data.map((d: { id: string }) => d.id)).not.toContain(id)
    const deOnly = await createSignedInUser({ tenantId: w.tenantId, roles: ['Compliance officer'], marketIds: [w.marketA] })
    expect((await call(app, { method: 'GET', url: `/v1/guardrail-decisions/${id}`, as: deOnly })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/guardrail-decisions?outcome=never', as: w.compliance })).statusCode).toBe(400)
    const blocked = (await call(app, { method: 'GET', url: `/v1/guardrail-decisions?outcome=blocked&market_pack=${w.pack}&overridable=false`, as: w.compliance })).json().data
    expect(blocked.every((d: { outcome: string; rule: { overridable: boolean } }) => d.outcome === 'blocked' && !d.rule.overridable)).toBe(true)
  })

  test('SC-11 pages lose no row when decisions share a microsecond timestamp (one transaction, one now())', async () => {
    const plan = await newPlan(app, w)
    const first = (await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })).json().data.guardrails.new_decisions[0].id
    await ownerRows(
      `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail, decided_by, decided_at)
       SELECT tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail || jsonb_build_object('explanation', 'copy ' || n), decided_by, '2026-03-01 10:00:00.123456+00'
       FROM guardrail_decision, generate_series(1, 3) AS n WHERE id = $1`,
      [first],
    )
    const versionId = (await ownerRows<{ plan_version_id: string }>('SELECT plan_version_id FROM guardrail_decision WHERE id = $1', [first]))[0]!.plan_version_id
    const seen: string[] = []
    let cursor: string | null = ''
    while (cursor !== null) {
      const page: { data: { id: string }[]; meta: { next_cursor: string | null } } = (await call(app, { method: 'GET', url: `/v1/guardrail-decisions?limit=1&plan_version_id=${versionId}${cursor ? `&cursor=${cursor}` : ''}`, as: w.compliance })).json()
      seen.push(...page.data.map((d) => d.id))
      cursor = page.meta.next_cursor
    }
    expect(new Set(seen).size).toBe(4)
    expect(seen).toHaveLength(4)
  })
})

describe('the version page shows decisions and gates', () => {
  test('guardrails and gates in GET version', async () => {
    const plan = await newPlan(app, w)
    await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal('pv', []) })
    await putRule(app, w.planadmin, plan.planId, 'main', LADDER)
    const view = (await call(app, { method: 'GET', url: `/v1/plans/${plan.planId}/versions/1`, as: w.planadmin })).json().data
    expect(view.guardrails.decisions).toMatchObject([{ outcome: 'warned', acknowledgement: null, override: null }])
    expect(view.guardrails.outstanding).toHaveLength(1)
    expect(view.gates).toEqual({ validation: true, crediting_event: false, goldens: true, coverage: true, guardrails: false, simulation: false, transitions: true })
  })
})
