// Version lifecycle: T-B3-02 schedule gates (incl. Europe/Berlin DST boundary), T-B3-03 activation cron, TS-42 plan part
// (AC-PLN1-3), TS-46 simulation gate (AC-10.2), T-B3-09 coverage gate (AC-PLN3-2), AC-PLN1-4, AC-27.2 TRANSITION_MISSING.
import { randomUUID } from 'node:crypto'
import { compilePlan, stringifyEngineJson } from '@nmp/engine'
import type { Tx } from '@nmp/db'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, testConfig, type TestUser } from '../../../test/helpers/index.js'
import { cplModule } from '../cpl/index.js'
import { plnModule } from './index.js'
import type { PlanRow, VersionRow } from './access.js'
import { activateVersionsJob } from './lifecycle.js'
import { missingTransitions } from './views.js'
import { approvedSetting, CAPPED, completedSimulation, customRoleUser, GOLDEN_EXPECTED, GOLDEN_INPUT, ingestedOrder, newPlan, personal, putRule, revisionOf, setSettings, UNILEVEL, world, type NewPlan, type World } from './test-support.js'

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

// Period starts of the Berlin calendars (local midnight): CET +01:00 in winter, CEST +02:00 in summer.
const MARCH = '2026-03-01T00:00:00+01:00'
const APRIL = '2026-04-01T00:00:00+02:00'
const OCTOBER = '2026-10-01T00:00:00+02:00'
const DECEMBER = '2026-12-01T00:00:00+01:00'
const NEXT_JANUARY = '2027-01-01T00:00:00+01:00'

const url = (planId: string, v: number, tail = '') => `/v1/plans/${planId}/versions/${v}${tail}`
const post = (as: TestUser, path: string, body?: unknown) => call(app, { method: 'POST', url: path, as, body: body ?? {}, idempotencyKey: true })

async function versionId(planId: string, v = 1): Promise<string> {
  const [row] = await ownerRows<{ id: string }>('SELECT id FROM plan_version WHERE plan_id = $1 AND version = $2', [planId, v])
  return row!.id
}

/** pv + unilevel (+ extra rules), crediting event set; a completed simulation of the final content when `simulate`. */
async function author(plan: NewPlan, options: { as?: TestUser; v?: number; crediting?: 'paid' | 'fulfilled'; extra?: Record<string, Record<string, unknown>>; simulate?: boolean } = {}): Promise<void> {
  const as = options.as ?? w.planadmin
  const v = options.v ?? 1
  await putRule(app, as, plan.planId, 'pv', { kind: 'volume.personal', params: personal() }, v)
  await putRule(app, as, plan.planId, 'unilevel', UNILEVEL, v)
  for (const [key, body] of Object.entries(options.extra ?? {})) await putRule(app, as, plan.planId, key, body, v)
  const revision = await revisionOf(app, as, plan.planId, v)
  await call(app, { method: 'PATCH', url: url(plan.planId, v), as, body: { crediting_event: options.crediting ?? 'paid' }, headers: { 'if-match': `"${revision}"` } })
  if (options.simulate !== false) await completedSimulation(await versionId(plan.planId, v), plan.calendarA)
}

const submit = (planId: string, v = 1, as = w.planadmin) => post(as, url(planId, v, '/submit'))
const decide = (planId: string, v = 1, as = w.compliance, decision = 'approve') => post(as, url(planId, v, '/decision'), { decision, reason: 'Reviewed against the plan document' })
const schedule = (planId: string, effective: string, v = 1, as = w.finance) => post(as, url(planId, v, '/schedule'), { effective_from: effective, justification: 'Board decision 2026-11' })

async function approved(plan: NewPlan, options: Parameters<typeof author>[1] = {}): Promise<void> {
  await author(plan, options)
  expect((await submit(plan.planId, options.v ?? 1)).statusCode).toBe(200)
  expect((await decide(plan.planId, options.v ?? 1)).statusCode).toBe(200)
}

describe('submit gates (AC-PLN2-1, T-B3-09 / AC-PLN3-2)', () => {
  test('PLAN_INVALID, CREDITING_EVENT_NOT_SET, EXTENSION_NOT_COVERED, then in review', async () => {
    const plan = await newPlan(app, w)
    await putRule(app, w.planadmin, plan.planId, 'unilevel', UNILEVEL)
    expect((await submit(plan.planId)).json().error).toMatchObject({ code: 'PLAN_INVALID', details: { errors: [{ rule_key: 'unilevel', code: 'UNKNOWN_REFERENCE' }] } })
    await putRule(app, w.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal() })
    expect((await submit(plan.planId)).json().error.code).toBe('CREDITING_EVENT_NOT_SET')
    await author(plan, { extra: { capped: CAPPED }, simulate: false })
    expect((await submit(plan.planId)).json().error).toMatchObject({ code: 'EXTENSION_NOT_COVERED', details: { rule_keys: ['capped'] } })
    const golden = await post(w.planadmin, url(plan.planId, 1, '/golden-datasets'), { name: 'covers capped', calendar_id: plan.calendarA, covers: ['capped'], input: GOLDEN_INPUT, expected: GOLDEN_EXPECTED })
    expect(golden.statusCode).toBe(201)
    const submitted = await submit(plan.planId)
    expect(submitted.statusCode).toBe(200)
    expect(submitted.json().data).toMatchObject({ state: 'in_review', submitted_by: w.planadmin.id })
    expect((await submit(plan.planId)).json().error.code).toBe('VERSION_NOT_DRAFT')
    // Guardrail evaluation and acknowledgement are authoring: refused once the version is in review.
    expect((await post(w.planadmin, url(plan.planId, 1, '/guardrails/evaluate'))).json().error.code).toBe('VERSION_NOT_DRAFT')
    expect((await post(w.planadmin, url(plan.planId, 1, `/guardrail-decisions/${randomUUID()}/acknowledge`))).json().error.code).toBe('VERSION_NOT_DRAFT')
  })

  test('the audit keeps the configured values of rule saves, deletions and field edits', async () => {
    const plan = await newPlan(app, w)
    await author(plan, { extra: { qv: { kind: 'volume.personal', params: personal('qv') } }, simulate: false })
    await putRule(app, w.planadmin, plan.planId, 'qv', { kind: 'volume.personal', params: personal('qv', ['sample']) })
    const revision = await revisionOf(app, w.planadmin, plan.planId)
    await call(app, { method: 'DELETE', url: url(plan.planId, 1, '/rules/qv'), as: w.planadmin, headers: { 'if-match': `"${revision}"` } })
    const events = await ownerRows<{ action: string; before: Record<string, unknown> | null; after: { after: Record<string, unknown> } | null }>(
      `SELECT action, before_ref::jsonb AS before, after_ref::jsonb AS after FROM audit.audit_event
       WHERE tenant_id = $1 AND (object_id = $2 OR (object_type = 'plan_rule' AND coalesce(after_ref::jsonb -> 'after', before_ref::jsonb) ->> 'rule_key' = 'qv'
         AND coalesce(after_ref::jsonb -> 'after', before_ref::jsonb) ->> 'plan_version_id' = $2::text)) ORDER BY seq`,
      [w.tenantId, await versionId(plan.planId)])
    const saves = events.filter((e) => e.action === 'PLAN_RULE.SAVED')
    expect(saves.map((e) => [e.before?.params ?? null, e.after!.after.params])).toEqual([[null, personal('qv')], [personal('qv'), personal('qv', ['sample'])]])
    expect(events.find((e) => e.action === 'PLAN_RULE.DELETED')!.before).toMatchObject({ rule_key: 'qv', params: personal('qv', ['sample']) })
    expect(events.find((e) => e.action === 'PLAN_VERSION.UPDATED')).toMatchObject({ before: { crediting_event: null }, after: { after: { fields: ['crediting_event'], values: { crediting_event: 'paid' } } } })
  })

  test('missing permission and cross-tenant denial', async () => {
    const plan = await newPlan(app, w)
    expect((await submit(plan.planId, 1, w.compliance)).statusCode).toBe(403)
    expect((await submit(plan.planId, 1, other.planadmin)).statusCode).toBe(404)
  })
})

describe('TS-42 plan part / AC-PLN1-3: second-person approval and activation', () => {
  test('a user who only deleted a rule of the version is a contributor and may not approve it', async () => {
    const deleter = await customRoleUser(w.tenantId, ['plan.read', 'plan.edit', 'plan.approve'])
    const plan = await newPlan(app, w)
    await author(plan, { extra: { qv: { kind: 'volume.personal', params: personal('qv') } } })
    const revision = await revisionOf(app, deleter, plan.planId)
    expect((await call(app, { method: 'DELETE', url: url(plan.planId, 1, '/rules/qv'), as: deleter, headers: { 'if-match': `"${revision}"` } })).statusCode).toBe(204)
    expect((await submit(plan.planId)).statusCode).toBe(200)
    expect((await decide(plan.planId, 1, deleter)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await decide(plan.planId, 1)).json().data.state).toBe('approved')
  })

  test('rule author, submitter and compliance approver are refused with eligible approvers over every plan market', async () => {
    const author1 = await customRoleUser(w.tenantId, ['plan.read', 'plan.edit', 'plan.approve', 'plan.activate'])
    const deOnly = await createSignedInUser({ tenantId: w.tenantId, roles: ['Compliance officer'], marketIds: [w.marketA], stepUp: true })
    const plan = await newPlan(app, w)
    await author(plan, { as: author1 })
    expect((await submit(plan.planId)).statusCode).toBe(200)
    expect((await decide(plan.planId, 1, w.planadmin)).statusCode).toBe(403)
    const refused = await decide(plan.planId, 1, author1)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('SOD_SELF_APPROVAL')
    const eligible = refused.json().error.details.eligible_approvers.map((u: { user_id: string }) => u.user_id)
    expect(eligible).toContain(w.compliance.id)
    expect(eligible).not.toContain(deOnly.id)
    expect(eligible).not.toContain(author1.id)
    expect(await auditActions(w.tenantId)).toContain('APPROVAL.REFUSED')

    const noStepUp = await createSignedInUser({ tenantId: w.tenantId, roles: ['Compliance officer'] })
    expect((await decide(plan.planId, 1, noStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    const approver = await customRoleUser(w.tenantId, ['plan.read', 'plan.approve', 'plan.activate'])
    expect((await decide(plan.planId, 1, approver)).json().data).toMatchObject({ state: 'approved', approved_by: approver.id })
    expect((await schedule(plan.planId, MARCH, 1, approver)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await schedule(plan.planId, MARCH, 1, author1)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await schedule(plan.planId, MARCH, 1, w.compliance)).statusCode).toBe(403)
    const active = await schedule(plan.planId, MARCH, 1, w.finance)
    expect(active.statusCode).toBe(200)
    expect(active.json().data).toMatchObject({ state: 'active', activated_by: w.finance.id, effective_from: '2026-02-28T23:00:00.000Z' })
    expect((await decide(plan.planId, 1)).json().error.code).toBe('VERSION_NOT_IN_REVIEW')
    expect((await schedule(plan.planId, MARCH)).json().error.code).toBe('VERSION_NOT_APPROVED')
    const outbox = await ownerRows<{ payload: { plan_version_id: string } }>("SELECT payload FROM outbox_event WHERE tenant_id = $1 AND topic = 'plan.version.activated'", [w.tenantId])
    expect(outbox.map((o) => o.payload.plan_version_id)).toContain(await versionId(plan.planId))
  })

  test('reject returns the version to draft', async () => {
    const plan = await newPlan(app, w)
    await author(plan)
    await submit(plan.planId)
    expect((await decide(plan.planId, 1, w.compliance, 'reject')).json().data.state).toBe('draft')
    expect((await post(w.compliance, url(plan.planId, 1, '/decision'), { decision: 'approve' })).statusCode).toBe(400)
    expect((await decide(plan.planId, 1, other.compliance)).statusCode).toBe(404)
  })
})

describe('T-B3-02 schedule gates (AC-PLN1-4, AC-10.2 / TS-46, AC-27.2)', () => {
  test('boundary of every calendar in Europe/Berlin across DST; validation', async () => {
    const plan = await newPlan(app, w)
    await approved(plan)
    expect((await schedule(plan.planId, '2026-10-01T00:00:00+01:00')).json().error).toMatchObject({ code: 'EFFECTIVE_NOT_AT_BOUNDARY', details: { calendar_id: expect.any(String) } })
    expect((await schedule(plan.planId, '2026-10-15T00:00:00+02:00')).json().error.code).toBe('EFFECTIVE_NOT_AT_BOUNDARY')
    expect((await post(w.finance, url(plan.planId, 1, '/schedule'), { effective_from: 'tomorrow', justification: 'x' })).statusCode).toBe(400)
    expect((await schedule(plan.planId, OCTOBER, 1, other.finance)).statusCode).toBe(404)
    expect((await schedule(plan.planId, OCTOBER)).json().data.state).toBe('active')
  })

  test('committed period, notice period, previous version', async () => {
    const plan = await newPlan(app, w)
    await approved(plan)
    await ownerRows("UPDATE period SET state = 'committed' WHERE calendar_id = $1 AND starts_at = $2::timestamptz", [plan.calendarB, APRIL])
    expect((await schedule(plan.planId, MARCH)).json().error.code).toBe('EFFECTIVE_IN_COMMITTED_PERIOD')
    const t = await world()
    const scoped = await newPlan(app, t)
    await putRule(app, t.planadmin, scoped.planId, 'pv', { kind: 'volume.personal', params: personal() })
    await putRule(app, t.planadmin, scoped.planId, 'unilevel', UNILEVEL)
    const rev = await revisionOf(app, t.planadmin, scoped.planId)
    await call(app, { method: 'PATCH', url: url(scoped.planId, 1), as: t.planadmin, body: { crediting_event: 'paid' }, headers: { 'if-match': `"${rev}"` } })
    await completedSimulation(await versionId(scoped.planId), scoped.calendarA)
    await submit(scoped.planId, 1, t.planadmin)
    await decide(scoped.planId, 1, t.compliance)
    await setSettings(t.tenantId, t.planadmin.id, { 'plan.activation_notice_days': 30 })
    expect((await schedule(scoped.planId, DECEMBER, 1, t.finance)).json().error).toMatchObject({ code: 'NOTICE_PERIOD_NOT_MET', details: { notice_days: 30 } })
    const later = await schedule(scoped.planId, NEXT_JANUARY, 1, t.finance)
    expect(later.json().data.state).toBe('scheduled')
  })

  test('TS-46: no simulation, or one of an earlier draft revision -> SIMULATION_REQUIRED', async () => {
    const plan = await newPlan(app, w)
    await author(plan, { simulate: false })
    await completedSimulation(await versionId(plan.planId), plan.calendarA)
    await putRule(app, w.planadmin, plan.planId, 'gv', { kind: 'volume.group', params: { of: 'pv', tree: 'sponsor', includeSelf: true } })
    await submit(plan.planId)
    await decide(plan.planId)
    expect((await schedule(plan.planId, MARCH)).json().error.code).toBe('SIMULATION_REQUIRED')
    await completedSimulation(await versionId(plan.planId), plan.calendarA)
    expect((await schedule(plan.planId, MARCH)).statusCode).toBe(200)
  })

  test('CREDITING_EVENT_CONFLICT: another plan of the market in force with another event; ingested orders since a past date', async () => {
    const t = await world()
    const first = await newPlan(app, t)
    const finish = async (plan: NewPlan, crediting: 'paid' | 'fulfilled') => {
      await putRule(app, t.planadmin, plan.planId, 'pv', { kind: 'volume.personal', params: personal() })
      const rev = await revisionOf(app, t.planadmin, plan.planId)
      await call(app, { method: 'PATCH', url: url(plan.planId, 1), as: t.planadmin, body: { crediting_event: crediting }, headers: { 'if-match': `"${rev}"` } })
      await completedSimulation(await versionId(plan.planId), plan.calendarA)
      expect((await submit(plan.planId, 1, t.planadmin)).statusCode).toBe(200)
      expect((await decide(plan.planId, 1, t.compliance)).statusCode).toBe(200)
    }
    await finish(first, 'fulfilled')
    expect((await schedule(first.planId, MARCH, 1, t.finance)).json().data.state).toBe('active')
    const second = await newPlan(app, t)
    await finish(second, 'paid')
    expect((await schedule(second.planId, APRIL, 1, t.finance)).json().error).toMatchObject({ code: 'CREDITING_EVENT_CONFLICT', details: { reason: 'other_plan' } })

    const u = await world()
    await setSettings(u.tenantId, u.planadmin.id, { 'orders.crediting_event': 'paid' })
    // An API order may name its source system 'migration:...'; only a migration's own inbound event exempts an order.
    await ingestedOrder(u.tenantId, u.marketA, u.planadmin.id, '2026-05-10T10:00:00Z', 'migration:legacy')
    const third = await newPlan(app, u)
    await putRule(app, u.planadmin, third.planId, 'pv', { kind: 'volume.personal', params: personal() })
    const rev = await revisionOf(app, u.planadmin, third.planId)
    await call(app, { method: 'PATCH', url: url(third.planId, 1), as: u.planadmin, body: { crediting_event: 'fulfilled' }, headers: { 'if-match': `"${rev}"` } })
    await completedSimulation(await versionId(third.planId), third.calendarA)
    await submit(third.planId, 1, u.planadmin)
    await decide(third.planId, 1, u.compliance)
    expect((await schedule(third.planId, MARCH, 1, u.finance)).json().error).toMatchObject({ code: 'CREDITING_EVENT_CONFLICT', details: { market_id: u.marketA, reason: 'ingested_orders' } })
    expect((await schedule(third.planId, NEXT_JANUARY, 1, u.finance)).json().data.state).toBe('scheduled')
  })

  test('AC-27.2: version 2 needs a transition for every state item of version 1; EFFECTIVE_NOT_AFTER_PREVIOUS', async () => {
    const plan = await newPlan(app, w)
    const ladder = { kind: 'ladder', params: { ranks: [{ key: 'R1', requires: [{ kind: 'measure', measure: 'pv', atLeastMinor: '10000', window: { type: 'period' }, maxPerLegShare: null }], maintenance: null }] } }
    await approved(plan, { extra: { main: ladder } })
    expect((await schedule(plan.planId, MARCH)).json().data.state).toBe('active')
    expect((await post(w.planadmin, `/v1/plans/${plan.planId}/versions`, {})).statusCode).toBe(201)
    await completedSimulation(await versionId(plan.planId, 2), plan.calendarA)
    await submit(plan.planId, 2)
    await decide(plan.planId, 2)
    expect((await schedule(plan.planId, MARCH, 2)).json().error.code).toBe('EFFECTIVE_NOT_AFTER_PREVIOUS')
    expect((await schedule(plan.planId, APRIL, 2)).json().error).toMatchObject({ code: 'TRANSITION_MISSING', details: { state_items: ['paid_as.main', 'title.main'] } })
  })
})

describe('TRANSITION_MISSING covers flags of every earlier version', () => {
  test('one_time flags of an older version are carried in state rows, so they need a transition too', async () => {
    const rule = (ruleKey: string, kind: string, params: unknown) => ({ ruleKey, kind, params, reversalPolicy: kind.startsWith('pay.') ? 'restatement' as const : null, calendarId: null, ordinal: 0 })
    const pv = rule('pv', 'volume.personal', personal())
    const compiled = (rules: Parameters<typeof compilePlan>[0]) => stringifyEngineJson(compilePlan(rules, [], { planVersionId: 'v', version: 1 }, ['c']))
    const older = compiled([pv, rule('welcome', 'pay.one_time', { sourceKind: 'other', eligibleIf: null, amountMinor: '100', onceKey: 'welcome' })])
    const latest = compiled([pv])
    const tx = { query: async () => ({ rows: [{ compiled: latest }, { compiled: older }] }) } as unknown as Tx
    const versionRow = { id: 'v3' } as VersionRow
    expect(await missingTransitions(tx, { id: 'p' } as PlanRow, versionRow, [])).toEqual(['one_time.welcome'])
    expect(await missingTransitions(tx, { id: 'p' } as PlanRow, versionRow, [{ state_item: 'one_time.*', rule: 'carry', map: [], reason: null }])).toEqual([])
  })
})

describe('T-B3-03 activation cron (pln.versions.activate)', () => {
  test('a due scheduled version becomes active and the previous one retires, with outbox and audit by the system', async () => {
    const plan = await newPlan(app, w)
    await approved(plan)
    expect((await schedule(plan.planId, MARCH)).json().data.state).toBe('active')
    await post(w.planadmin, `/v1/plans/${plan.planId}/versions`, {})
    await completedSimulation(await versionId(plan.planId, 2), plan.calendarA)
    await submit(plan.planId, 2)
    await decide(plan.planId, 2)
    expect((await schedule(plan.planId, NEXT_JANUARY, 2)).json().data.state).toBe('scheduled')
    await activateVersionsJob.run({ jobId: 'test', log: fastify({ logger: false }).log, config: testConfig() })
    expect((await ownerRows<{ state: string }>('SELECT state FROM plan_version WHERE plan_id = $1 ORDER BY version', [plan.planId])).map((r) => r.state)).toEqual(['active', 'scheduled'])
    // FIXTURE: time passes (the effective time of version 2 is reached).
    await ownerRows("UPDATE plan_version SET effective_from = $2::timestamptz WHERE plan_id = $1 AND version = 2", [plan.planId, APRIL])
    await activateVersionsJob.run({ jobId: 'test', log: fastify({ logger: false }).log, config: testConfig() })
    expect((await ownerRows<{ state: string }>('SELECT state FROM plan_version WHERE plan_id = $1 ORDER BY version', [plan.planId])).map((r) => r.state)).toEqual(['retired', 'active'])
    const events = await ownerRows<{ action: string; actor_id: string | null }>(
      "SELECT action, actor_id FROM audit.audit_event WHERE tenant_id = $1 AND object_id = $2 AND action = 'PLAN_VERSION.ACTIVATED'", [w.tenantId, await versionId(plan.planId, 2)])
    expect(events).toEqual([{ action: 'PLAN_VERSION.ACTIVATED', actor_id: null }])
    // FIXTURE: version 1 is due but its activation kept failing until version 2 (later effective time) took effect.
    await ownerRows("UPDATE plan_version SET state = 'scheduled', retired_at = NULL WHERE plan_id = $1 AND version = 1", [plan.planId])
    await activateVersionsJob.run({ jobId: 'test', log: fastify({ logger: false }).log, config: testConfig() })
    expect((await ownerRows<{ state: string }>('SELECT state FROM plan_version WHERE plan_id = $1 ORDER BY version', [plan.planId])).map((r) => r.state)).toEqual(['scheduled', 'active'])
  })
})

describe('D-B5-14 plan change notice', () => {
  test('scheduling notifies every owner of a position in a plan market once (plan.change_scheduled), in the schedule transaction', async () => {
    const plan = await newPlan(app, w)
    await approved(plan)
    // FIXTURE: a participant of market A with an active position and a contact email (as PAR and GEN write them).
    const [owner] = await ownerRows<{ id: string }>(
      `WITH x AS (INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, contact, created_by, created_by_type)
                  VALUES ($1, $2, 'individual', $3, 'Owner', '2020-01-01', jsonb_build_object('email', $2 || '@example.test'), $4, 'system') RETURNING id),
            p AS (INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
                  VALUES ($1, $2, $3, 'active', '2020-01-01', $4, 'system') RETURNING id)
       INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
       SELECT $1, p.id, x.id, '2020-01-01', $4, 'system' FROM p, x RETURNING participant_id AS id`,
      [w.tenantId, `OWN-${randomUUID().slice(0, 8)}`, w.marketA, '00000000-0000-0000-0000-000000000000'])
    expect((await schedule(plan.planId, NEXT_JANUARY)).json().data.state).toBe('scheduled')
    const notices = await ownerRows<{ channel: string; template: string; effective_from: string; version_id: string }>(
      `SELECT channel, template, params ->> 'effective_from' AS effective_from, params ->> 'plan_version_id' AS version_id
       FROM notification WHERE recipient_participant_id = $1 ORDER BY channel`, [owner!.id])
    expect(notices).toEqual([
      { channel: 'email', template: 'plan.change_scheduled', effective_from: '2026-12-31T23:00:00.000Z', version_id: await versionId(plan.planId) },
      { channel: 'in_app', template: 'plan.change_scheduled', effective_from: '2026-12-31T23:00:00.000Z', version_id: await versionId(plan.planId) },
    ])
  })
})

describe('B6 plan-change governance (D-B6-02, D-B6-03; T-B6-01..04, TS-46 filing part, TS-68)', () => {
  let g: World
  const SYSTEM = '00000000-0000-0000-0000-000000000000'
  beforeAll(async () => {
    g = await world()
  })

  /** FIXTURE: an evidence document uploaded by `by` (AUD writes these). */
  async function evidence(by: TestUser): Promise<string> {
    const [row] = await ownerRows<{ id: string }>(
      `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, file_name)
       VALUES ($1, 'evidence', 'documents/fixture', sha256(gen_random_uuid()::text::bytea), 'application/pdf', 1, $2, 1, 'filing.pdf') RETURNING id`,
      [by.tenantId, by.id])
    return row!.id
  }
  const gApproved = async (plan: NewPlan, on: World = g): Promise<void> => {
    await author(plan, { as: on.planadmin })
    expect((await submit(plan.planId, 1, on.planadmin)).statusCode).toBe(200)
    expect((await decide(plan.planId, 1, on.compliance)).statusCode).toBe(200)
  }
  const fileFor = async (planId: string, as: TestUser, body: Record<string, unknown>) =>
    post(as, url(planId, 1, '/filings'), body)
  const governance = async (planId: string, as: TestUser) => call(app, { method: 'GET', url: url(planId, 1, '/governance'), as })
  async function authorAs(plan: NewPlan, as: TestUser): Promise<void> {
    await putRule(app, as, plan.planId, 'pv', { kind: 'volume.personal', params: personal() })
    await putRule(app, as, plan.planId, 'unilevel', UNILEVEL)
    const revision = await revisionOf(app, as, plan.planId)
    await call(app, { method: 'PATCH', url: url(plan.planId, 1), as, body: { crediting_event: 'paid' }, headers: { 'if-match': `"${revision}"` } })
    await completedSimulation(await versionId(plan.planId), plan.calendarA)
  }

  test('T-B6-01 / AC-PLN7-4: filing records: validation, state, plan market, evidence, scope; a contributor may record; the latest row is the status', async () => {
    const contributor = await customRoleUser(g.tenantId, ['plan.read', 'plan.edit', 'plan.approve'])
    const plan = await newPlan(app, g)
    const draft = await fileFor(plan.planId, g.compliance, { market_id: g.marketA, status: 'not_required', note: 'Counsel: no filing', document_id: await evidence(g.compliance) })
    await authorAs(plan, contributor)
    expect((await submit(plan.planId, 1, contributor)).statusCode).toBe(200)
    const filed = { market_id: g.marketA, status: 'filed', reference: 'BaFin-2026-17', filed_on: '2026-11-02' }

    const refusals = [
      await fileFor(plan.planId, g.compliance, { ...filed }),
      await fileFor(plan.planId, g.compliance, { market_id: g.marketA, status: 'not_required', document_id: await evidence(g.compliance) }),
      await fileFor(plan.planId, g.compliance, { ...filed, market_id: other.marketA, document_id: await evidence(g.compliance) }),
      await fileFor(plan.planId, g.compliance, { ...filed, document_id: await evidence(g.finance) }),
    ]
    const byContributor = await fileFor(plan.planId, contributor, { ...filed, document_id: await evidence(contributor) })
    expect((await decide(plan.planId, 1, g.compliance)).statusCode).toBe(200)
    const acknowledged = await fileFor(plan.planId, g.compliance, { ...filed, status: 'acknowledged', filed_on: '2026-11-09', document_id: await evidence(g.compliance) })
    const view = await governance(plan.planId, g.executive)

    expect(draft.json().error).toMatchObject({ code: 'VERSION_STATE', details: { state: 'draft' } })
    expect(refusals.map((r) => [r.statusCode, r.json().error.code])).toEqual([
      [422, 'VALIDATION_FAILED'], [422, 'VALIDATION_FAILED'], [422, 'MARKET_NOT_IN_PLAN'], [422, 'DOCUMENT_NOT_REFERENCEABLE'],
    ])
    expect(refusals[0]!.json().error.details.issues).toEqual([{ path: 'document_id', message: 'required when status is filed' }])
    expect(byContributor.statusCode).toBe(201)
    expect(byContributor.json().data).toMatchObject({ market_id: g.marketA, status: 'filed', reference: 'BaFin-2026-17', filed_on: '2026-11-02', recorded_by: { id: contributor.id } })
    expect(acknowledged.statusCode).toBe(201)
    const filingA = view.json().data.filings.find((f: { market: { id: string } }) => f.market.id === g.marketA)
    expect(filingA).toMatchObject({ required: false, current: { status: 'acknowledged', filed_on: '2026-11-09' } })
    expect(filingA.history.map((f: { status: string }) => f.status)).toEqual(['acknowledged', 'filed'])
    expect(await auditActions(g.tenantId)).toEqual(expect.arrayContaining(['PLAN_FILING.RECORDED']))
    expect((await fileFor(plan.planId, g.planadmin, { ...filed, document_id: await evidence(g.planadmin) })).statusCode).toBe(403)
    expect((await fileFor(plan.planId, other.compliance, { ...filed, document_id: await evidence(other.compliance) })).statusCode).toBe(404)
    expect((await governance(plan.planId, other.executive)).statusCode).toBe(404)
  })

  test('T-B6-02 / AC-27.1 / AC-PLN7-3: the filing gate refuses until the required market has a filing; the schedule records the notice', async () => {
    const g = await world()
    await approvedSetting(g.tenantId, 'plan.filing_requirements', { market_ids: [g.marketA] }, g.planadmin, g.compliance)
    const plan = await newPlan(app, g)
    await gApproved(plan, g)
    // FIXTURE: one position owner in market A (PAR and GEN write these): one in-app notice.
    await ownerRows(
      `WITH x AS (INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type)
                  VALUES ($1, $2, 'individual', $3, 'Owner', '2020-01-01', $4, 'system') RETURNING id),
            p AS (INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
                  VALUES ($1, $2, $3, 'active', '2020-01-01', $4, 'system') RETURNING id)
       INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
       SELECT $1, p.id, x.id, '2020-01-01', $4, 'system' FROM p, x`,
      [g.tenantId, `OWN-${randomUUID().slice(0, 8)}`, g.marketA, SYSTEM])

    const refused = await post(g.finance, url(plan.planId, 1, '/schedule'), { effective_from: NEXT_JANUARY, justification: 'Board decision 2026-11' })
    const before = await governance(plan.planId, g.executive)
    expect((await fileFor(plan.planId, g.compliance, { market_id: g.marketA, status: 'filed', reference: 'R-1', filed_on: '2026-11-02', document_id: await evidence(g.compliance) })).statusCode).toBe(201)
    const scheduled = await post(g.finance, url(plan.planId, 1, '/schedule'), { effective_from: NEXT_JANUARY, justification: 'Board decision 2026-11' })
    const after = await governance(plan.planId, g.executive)
    const [notices] = await ownerRows<{ n: number }>(
      "SELECT count(*)::int AS n FROM notification WHERE tenant_id = $1 AND template = 'plan.change_scheduled' AND channel = 'in_app' AND params ->> 'plan_version_id' = $2",
      [g.tenantId, await versionId(plan.planId)])

    expect(refused.json().error).toMatchObject({ code: 'FILING_STATUS_MISSING', details: { market_ids: [g.marketA] } })
    expect(before.json().data.version).toMatchObject({ state: 'approved', notice_sent_at: null, notice_recipients: null })
    expect(before.json().data.items.find((i: { key: string }) => i.key === 'filing')).toMatchObject({ ok: false, details: { market_ids: [g.marketA] } })
    expect(scheduled.statusCode).toBe(200)
    expect(notices!.n).toBe(1)
    expect(after.json().data.version).toMatchObject({ state: 'scheduled', notice_recipients: 1, notice_sent_at: expect.any(String) })
    expect(after.json().data.notice).toMatchObject({ days: null, earliest_effective_from: null, recipients: 1 })
    expect(after.json().data.items.find((i: { key: string }) => i.key === 'filing')).toMatchObject({ ok: true, reason: null })
    const [audit] = await ownerRows<{ after: { after: Record<string, unknown> } }>(
      "SELECT after_ref::jsonb AS after FROM audit.audit_event WHERE object_id = $1 AND action = 'PLAN_VERSION.SCHEDULED'", [await versionId(plan.planId)])
    expect(audit!.after.after).toMatchObject({ notice_recipients: 1 })
  })

  test('BR-PLN-03 / AC-27.1: a filing holds for the content it was recorded for; after a rejection and an edit the gate needs a new one', async () => {
    const g = await world()
    await approvedSetting(g.tenantId, 'plan.filing_requirements', { market_ids: [g.marketA] }, g.planadmin, g.compliance)
    const plan = await newPlan(app, g)
    await author(plan, { as: g.planadmin })
    expect((await submit(plan.planId, 1, g.planadmin)).statusCode).toBe(200)
    const counsel = { market_id: g.marketA, status: 'not_required', note: 'Counsel: no filing for this content' }
    expect((await fileFor(plan.planId, g.compliance, { ...counsel, document_id: await evidence(g.compliance) })).statusCode).toBe(201)
    expect((await decide(plan.planId, 1, g.compliance, 'reject')).statusCode).toBe(200)
    await putRule(app, g.planadmin, plan.planId, 'unilevel', { ...UNILEVEL, params: { ...UNILEVEL.params, levels: ['0.12'] } })
    await completedSimulation(await versionId(plan.planId), plan.calendarA)
    expect((await submit(plan.planId, 1, g.planadmin)).statusCode).toBe(200)
    expect((await decide(plan.planId, 1, g.compliance)).statusCode).toBe(200)

    const refused = await schedule(plan.planId, NEXT_JANUARY, 1, g.finance)
    const stale = (await governance(plan.planId, g.executive)).json().data
    expect((await fileFor(plan.planId, g.compliance, { ...counsel, document_id: await evidence(g.compliance) })).statusCode).toBe(201)
    const scheduled = await schedule(plan.planId, NEXT_JANUARY, 1, g.finance)

    expect(refused.json().error).toMatchObject({ code: 'FILING_STATUS_MISSING', details: { market_ids: [g.marketA] } })
    const filingA = stale.filings.find((f: { market: { id: string } }) => f.market.id === g.marketA)
    expect(filingA).toMatchObject({ required: true, current: null, history: [{ status: 'not_required' }] })
    expect(stale.items.find((i: { key: string }) => i.key === 'filing')).toMatchObject({ ok: false })
    expect(scheduled.statusCode).toBe(200)
  })

  test('TS-68 regression with the filing gate unset: notice days refuse a short effective time; the governance view names the notice', async () => {
    const g = await world()
    await setSettings(g.tenantId, g.planadmin.id, { 'plan.activation_notice_days': 30 })
    const plan = await newPlan(app, g)
    await gApproved(plan, g)
    const soon = await post(g.finance, url(plan.planId, 1, '/schedule'), { effective_from: DECEMBER, justification: 'Board decision 2026-11' })
    const view = await governance(plan.planId, g.executive)
    expect(soon.json().error).toMatchObject({ code: 'NOTICE_PERIOD_NOT_MET', details: { notice_days: 30 } })
    expect(view.json().data.items.map((i: { key: string; ok: boolean }) => [i.key, i.ok])).toEqual([
      ['simulation', true], ['goldens', true], ['guardrails', true], ['transitions', true], ['filing', true], ['notice', true], ['approvals', false],
    ])
    expect(view.json().data.items.find((i: { key: string }) => i.key === 'notice').reason).toMatch(/^Schedule on or after \d{4}-\d{2}-\d{2} \(30 days' notice\)\.$/)
    expect(view.json().data.items.find((i: { key: string }) => i.key === 'filing').reason).toBe('No market requires a filing.')
    expect(view.json().data.notice).toMatchObject({ days: 30, earliest_effective_from: expect.any(String), sent_at: null })
    expect(view.json().data.approvals).toMatchObject({ compliance: { by: { id: g.compliance.id } }, activation: null })
  })

  test('T-B6-03 / AC-PLN8-2: first_run_id is null before a run under the version and the earliest run after', async () => {
    const plan = await newPlan(app, g)
    await gApproved(plan, g)
    const scheduled = await post(g.finance, url(plan.planId, 1, '/schedule'), { effective_from: MARCH, justification: 'Board decision 2026-11' })
    expect(scheduled.statusCode, scheduled.body).toBe(200)
    const empty = await governance(plan.planId, g.executive)
    // FIXTURE: COMP queues runs of March and April under the version (COMP writes runs).
    const runs = await ownerRows<{ id: string }>(
      `WITH s AS (INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
                  SELECT $1, coalesce(max(version), 0) + 1, now(), '{}', 'FIXTURE', $3 FROM tenant_setting_version WHERE tenant_id = $1 RETURNING id)
       INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, engine_version, prepared_by)
       SELECT $1, p.id, gen_random_uuid()::text, $2, s.id, 'fixture', $3
       FROM s, period p WHERE p.calendar_id = $4 AND p.starts_at IN ($5::timestamptz, $6::timestamptz)
       RETURNING id`,
      [g.tenantId, await versionId(plan.planId), g.planadmin.id, plan.calendarA, MARCH, APRIL])
    const [march] = await ownerRows<{ id: string }>('SELECT r.id FROM run r JOIN period p ON p.id = r.period_id WHERE r.id = ANY ($1::uuid[]) AND p.starts_at = $2::timestamptz',
      [runs.map((r) => r.id), MARCH])
    expect(empty.json().data.first_run_id).toBeNull()
    expect((await governance(plan.planId, g.executive)).json().data.first_run_id).toBe(march!.id)
    // FIXTURE: the March run fails (COMP); a failed run has no transition report, so the April run is named.
    await ownerRows(`UPDATE run SET state = 'failed', error = '{"code": "FIXTURE"}' WHERE id = $1`, [march!.id])
    expect((await governance(plan.planId, g.executive)).json().data.first_run_id).toBe(runs.find((r) => r.id !== march!.id)!.id)
  })
})
