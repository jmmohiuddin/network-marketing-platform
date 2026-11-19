import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { audModule } from '../aud/index.js'
import { evidenceDocument, fixtureCasModule, FIXTURE_SUBJECT, openFixtureCase } from './test-support.js'

// T-B1-23..26, AC-CAS1-1..5, TS-42 (case part): the case framework with the labelled fixture type (D-B1-13).
let app: FastifyInstance
let acme: TestTenant
let gb: string
let my: string
let globexMarket: string
let admin: TestUser
let admin2: TestUser
let admin3: TestUser
let decider: TestUser
let deciderWithoutStepUp: TestUser
let analyst: TestUser
let analystMy: TestUser
let support: TestUser
let globexAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  my = await createMarket(acme.id, 'MY')
  globexMarket = await createMarket(globex.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  admin2 = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  admin3 = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  decider = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  deciderWithoutStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  analystMy = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [my] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [fixtureCasModule(), audModule] })
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const post = (as: TestUser, url: string, body: unknown, idempotencyKey?: true | string) =>
  call(app, { method: 'POST', url, as, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })

async function openCase(as: TestUser = admin, marketId = gb, payload?: { amount_minor: string; fail_on_decision?: boolean }) {
  const response = await openFixtureCase(app, as, marketId, payload)
  expect(response.statusCode).toBe(201)
  return response.json().data.id as string
}

async function attach(as: TestUser, caseId: string): Promise<string> {
  const documentId = await evidenceDocument(as)
  const response = await post(as, `/v1/cases/${caseId}/evidence`, { document_id: documentId, note: 'Bank letter' }, true)
  expect(response.statusCode).toBe(201)
  return documentId
}

async function submittedCase(options: { payload?: { amount_minor: string; fail_on_decision?: boolean } } = {}) {
  const id = await openCase(admin, gb, options.payload)
  await attach(admin, id)
  expect((await post(admin, `/v1/cases/${id}/submit`, {})).statusCode).toBe(200)
  return id
}

const decide = (as: TestUser, id: string, decision: 'approve' | 'reject' = 'approve', key: true | string = true) =>
  post(as, `/v1/cases/${id}/decision`, { decision, reason: 'Checked against the bank letter' }, key)

describe('POST /v1/cases (AC-CAS1-1, AC-CAS1-2)', () => {
  test('opens a case of a registered type about an existing subject, with its event and audit; a replay opens nothing', async () => {
    const key = randomUUID()
    const body = { type: 'grievance', subject_type: FIXTURE_SUBJECT, subject_id: gb, reason_code: 'fixture_reason_a', payload: { amount_minor: '-250' }, note: 'Customer call' }
    const first = await call(app, { method: 'POST', url: '/v1/cases', as: admin, body, idempotencyKey: key })
    const replay = await call(app, { method: 'POST', url: '/v1/cases', as: admin, body, idempotencyKey: key })
    const opened = first.json().data

    expect(first.statusCode).toBe(201)
    expect(opened).toMatchObject({ type: 'grievance', state: 'open', market_id: gb, opened_by: admin.id, payload: { amount_minor: '-250' } })
    expect(replay.statusCode).toBe(201)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json().data.id).toBe(opened.id)
    expect(await ownerRows('SELECT kind, data FROM case_event WHERE case_id = $1', [opened.id])).toEqual([{ kind: 'opened', data: { note: 'Customer call' } }])
    expect((await ownerRows('SELECT 1 FROM case_file WHERE subject_id = $1 AND payload = $2', [gb, { amount_minor: '-250' }])).length).toBe(1)
    expect(await auditActions(acme.id)).toContain('CASE.OPENED')
  })

  test('a type that is not registered is not enabled', async () => {
    const response = await post(admin, '/v1/cases', { type: 'dispute', subject_type: FIXTURE_SUBJECT, subject_id: gb, reason_code: 'x', payload: {} }, true)

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('CASE_TYPE_NOT_ENABLED')
  })

  test('a caller who may open no case type gets 403 before learning which types are enabled', async () => {
    for (const type of ['dispute', 'grievance']) {
      const response = await post(support, '/v1/cases', { type, subject_type: FIXTURE_SUBJECT, subject_id: gb, reason_code: 'x', payload: {} }, true)
      expect(response.statusCode).toBe(403)
    }
  })

  test('reason codes, subjects and payloads are checked against the type', async () => {
    const base = { type: 'grievance', subject_type: FIXTURE_SUBJECT, subject_id: gb, reason_code: 'fixture_reason_a', payload: { amount_minor: '1' } }
    const reason = await post(admin, '/v1/cases', { ...base, reason_code: 'made_up' }, true)
    const unknown = await post(admin, '/v1/cases', { ...base, subject_id: randomUUID() }, true)
    const otherType = await post(admin, '/v1/cases', { ...base, subject_type: 'participant' }, true)
    const otherTenant = await post(admin, '/v1/cases', { ...base, subject_id: globexMarket }, true)
    const payload = await post(admin, '/v1/cases', { ...base, payload: { amount_minor: 1.5 } }, true)

    expect(reason.statusCode).toBe(422)
    expect(reason.json().error).toMatchObject({ code: 'REASON_CODE_INVALID', details: { reason_codes: ['fixture_reason_a', 'fixture_reason_b'] } })
    for (const response of [unknown, otherType, otherTenant]) {
      expect(response.statusCode).toBe(422)
      expect(response.json().error.code).toBe('SUBJECT_NOT_FOUND')
    }
    expect(payload.statusCode).toBe(422)
    expect(payload.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [expect.objectContaining({ path: 'amount_minor' })] } })
  })

  test('the create permission is the type\'s, over the subject\'s market', async () => {
    const consultantMy = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'], marketIds: [my] })

    expect((await openFixtureCase(app, analyst, gb)).statusCode).toBe(403)
    expect((await openFixtureCase(app, support, gb)).statusCode).toBe(403)
    expect((await openFixtureCase(app, consultantMy, gb)).json().error.code).toBe('SUBJECT_NOT_FOUND')
    expect((await openFixtureCase(app, consultantMy, my)).statusCode).toBe(201)
  })
})

describe('evidence and submission (AC-CAS1-3)', () => {
  test('submit needs evidence; then stores the effect preview and the due date, and evidence closes', async () => {
    const id = await openCase()
    const early = await post(admin, `/v1/cases/${id}/submit`, {})
    const documentId = await attach(admin, id)
    const submitted = await post(admin, `/v1/cases/${id}/submit`, {})
    const late = await post(admin, `/v1/cases/${id}/evidence`, { document_id: await evidenceDocument(admin) }, true)

    expect(early.statusCode).toBe(422)
    expect(early.json().error.code).toBe('EVIDENCE_REQUIRED')
    expect(submitted.statusCode).toBe(200)
    expect(submitted.json().data).toMatchObject({ state: 'submitted', submitted_by: admin.id, effect_preview: { amount_minor: '1500' } })
    const due = new Date(submitted.json().data.due_at).getTime()
    expect(due - Date.now()).toBeGreaterThan(47 * 3600_000)
    expect(late.statusCode).toBe(409)
    expect(late.json().error.code).toBe('CASE_STATE_CONFLICT')
    expect((await post(admin, `/v1/cases/${id}/submit`, {})).json().error.code).toBe('CASE_STATE_CONFLICT')

    const detail = (await get(analyst, `/v1/cases/${id}`)).json().data
    expect(detail.evidence).toEqual([expect.objectContaining({ document_id: documentId, note: 'Bank letter', mime: 'application/pdf', added_by: admin.id })])
    expect(detail.events.map((event: { kind: string }) => event.kind)).toEqual(['opened', 'evidence_added', 'submitted'])
    const approverIds = detail.eligible_approvers.map((approver: { user_id: string }) => approver.user_id)
    expect(approverIds).toEqual(expect.arrayContaining([decider.id, admin2.id]))
    expect(approverIds).not.toContain(admin.id)
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['CASE.EVIDENCE_ADDED', 'CASE.SUBMITTED']))
  })

  test('evidence is a document the caller uploaded, not yet referenced, and not attached twice (D-B1-04)', async () => {
    const id = await openCase()
    const own = await attach(admin, id)
    const othersDocument = await evidenceDocument(admin2)
    const elsewhere = await openCase()
    const twice = await post(admin, `/v1/cases/${id}/evidence`, { document_id: own }, true)
    const reused = await post(admin, `/v1/cases/${elsewhere}/evidence`, { document_id: own }, true)
    const foreign = await post(admin, `/v1/cases/${id}/evidence`, { document_id: othersDocument }, true)
    const missing = await post(admin, `/v1/cases/${id}/evidence`, { document_id: randomUUID() }, true)

    expect(twice.statusCode).toBe(409)
    expect(twice.json().error.code).toBe('EVIDENCE_DUPLICATE')
    for (const response of [reused, foreign, missing]) {
      expect(response.statusCode).toBe(422)
      expect(response.json().error.code).toBe('DOCUMENT_NOT_FOUND')
    }
    expect((await call(app, { method: 'GET', url: `/v1/documents/${othersDocument}`, as: admin })).statusCode).toBe(404)
  })

  test('evidence and submission need the type\'s create permission', async () => {
    const id = await openCase()

    expect((await post(analyst, `/v1/cases/${id}/submit`, {})).statusCode).toBe(403)
    expect((await post(analyst, `/v1/cases/${id}/evidence`, { document_id: randomUUID() }, true)).statusCode).toBe(403)
    expect((await post(support, `/v1/cases/${id}/submit`, {})).statusCode).toBe(404)
  })
})

describe('decision (AC-CAS1-4, AC-07.1, AC-07.2, AC-IAM4-1)', () => {
  test('the opener, the submitter and every evidence adder are refused SOD-01; the refusal is audited and survives', async () => {
    const id = await openCase(admin)
    await attach(admin2, id)
    expect((await post(admin3, `/v1/cases/${id}/submit`, {})).statusCode).toBe(200)

    for (const contributor of [admin, admin2, admin3]) {
      const refused = await decide(contributor, id)
      expect(refused.statusCode).toBe(422)
      const error = refused.json().error
      expect(error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01', no_eligible_approver: false } })
      const eligible = error.details.eligible_approvers.map((approver: { user_id: string }) => approver.user_id)
      expect(eligible).toContain(decider.id)
      expect(eligible).not.toContain(admin.id)
      expect(eligible).not.toContain(admin2.id)
      expect(eligible).not.toContain(admin3.id)
    }
    expect(await ownerRows('SELECT state FROM case_file WHERE id = $1', [id])).toEqual([{ state: 'submitted' }])
    expect(await ownerRows("SELECT 1 FROM approval WHERE object_id = $1", [id])).toEqual([])
    const refusals = await ownerRows<{ after_ref: string }>(
      "SELECT after_ref FROM audit.audit_event WHERE action = 'APPROVAL.REFUSED' AND object_id = $1", [id])
    expect(refusals).toHaveLength(3)
    expect(JSON.parse(refusals[0]!.after_ref).after).toEqual({ object_type: 'case', object_id: id, reason_code: 'SOD-01' })
  })

  test('an independent decider with step-up approves: approval row, hook, event, audit and outbox in one transaction', async () => {
    const id = await submittedCase()
    const approved = await decide(decider, id)

    expect(approved.statusCode).toBe(200)
    expect(approved.json().data).toMatchObject({ state: 'approved' })
    const [approval] = await ownerRows<Record<string, unknown>>(
      'SELECT preparer_id, approver_id, decision, reason, factor_verified_at FROM approval WHERE id = $1', [approved.json().data.approval_id])
    expect(approval).toMatchObject({ preparer_id: admin.id, approver_id: decider.id, decision: 'approved', reason: 'Checked against the bank letter' })
    expect(approval!.factor_verified_at).not.toBeNull()
    const outbox = await ownerRows('SELECT payload FROM outbox_event WHERE topic = $1 AND key = $2', ['case.decided', id])
    expect(outbox).toEqual([{ payload: { case_id: id, type: 'grievance', decision: 'approved' } }])
    const actions = await ownerRows<{ action: string }>('SELECT action FROM audit.audit_event WHERE object_id = $1 ORDER BY seq', [id])
    expect(actions.map((row) => row.action).slice(-2)).toEqual(['CASE.APPROVED', 'FIXTURE.CASE_DECIDED'])
    const again = await decide(decider, id, 'reject')
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('CASE_STATE_CONFLICT')
  })

  test('rejecting records a rejected approval', async () => {
    const id = await submittedCase()
    const rejected = await decide(decider, id, 'reject')

    expect(rejected.statusCode).toBe(200)
    expect(rejected.json().data.state).toBe('rejected')
    expect(await ownerRows('SELECT payload FROM outbox_event WHERE key = $1', [id])).toEqual([
      { payload: { case_id: id, type: 'grievance', decision: 'rejected' } },
    ])
  })

  test('without a fresh second factor the decision waits; after step-up the same key decides, and a replay changes nothing', async () => {
    const id = await submittedCase()
    const key = randomUUID()
    const waiting = await decide(deciderWithoutStepUp, id, 'approve', key)
    await ownerRows('UPDATE session SET step_up_at = now() WHERE id = $1', [deciderWithoutStepUp.sessionId])
    const decided = await decide(deciderWithoutStepUp, id, 'approve', key)
    const replay = await decide(deciderWithoutStepUp, id, 'approve', key)

    expect(waiting.statusCode).toBe(403)
    expect(waiting.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(decided.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(await ownerRows('SELECT 1 FROM approval WHERE object_id = $1', [id])).toHaveLength(1)
  })

  test('a failing onDecision hook rolls the whole decision back', async () => {
    const id = await submittedCase({ payload: { amount_minor: '10', fail_on_decision: true } })
    const failed = await decide(decider, id)

    expect(failed.statusCode).toBe(500)
    expect(await ownerRows('SELECT state FROM case_file WHERE id = $1', [id])).toEqual([{ state: 'submitted' }])
    expect(await ownerRows('SELECT 1 FROM approval WHERE object_id = $1', [id])).toEqual([])
  })

  test('the decide permission is the type\'s; a non-reader gets 404', async () => {
    const id = await submittedCase()

    expect((await decide(analyst, id)).statusCode).toBe(403)
    expect((await decide(support, id)).statusCode).toBe(404)
    expect((await decide(analystMy, id)).statusCode).toBe(404)
  })
})

describe('assignment and withdrawal', () => {
  test('a decider assigns to someone who can prepare or decide the case', async () => {
    const id = await openCase()
    const ineligible = await post(decider, `/v1/cases/${id}/assign`, { user_id: analyst.id })
    const assigned = await post(decider, `/v1/cases/${id}/assign`, { user_id: decider.id })
    const cleared = await post(decider, `/v1/cases/${id}/assign`, { user_id: null })

    expect(ineligible.statusCode).toBe(422)
    expect(ineligible.json().error.code).toBe('ASSIGNEE_NOT_ELIGIBLE')
    expect(assigned.json().data.assigned_to).toBe(decider.id)
    expect(cleared.json().data.assigned_to).toBeNull()
    expect((await post(analyst, `/v1/cases/${id}/assign`, { user_id: null })).statusCode).toBe(403)
    expect(await auditActions(acme.id)).toContain('CASE.ASSIGNED')
  })

  test('only the opener withdraws an open or submitted case, once', async () => {
    const id = await submittedCase()
    const stranger = await post(admin2, `/v1/cases/${id}/withdraw`, { reason: 'Duplicate' })
    const withdrawn = await post(admin, `/v1/cases/${id}/withdraw`, { reason: 'Duplicate' })
    const again = await post(admin, `/v1/cases/${id}/withdraw`, { reason: 'Duplicate' })

    expect(stranger.statusCode).toBe(403)
    expect(withdrawn.statusCode).toBe(200)
    expect(withdrawn.json().data).toMatchObject({ state: 'withdrawn' })
    expect(withdrawn.json().data.decided_at).not.toBeNull()
    expect(again.json().error.code).toBe('CASE_STATE_CONFLICT')
    expect((await decide(decider, id)).json().error.code).toBe('CASE_STATE_CONFLICT')
  })

  test('an opener without the read permission withdraws; a stranger who cannot read the case gets 404', async () => {
    const consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
    const id = await openCase(consultant)

    expect((await post(support, `/v1/cases/${id}/withdraw`, { reason: 'Mine' })).statusCode).toBe(404)
    const withdrawn = await post(consultant, `/v1/cases/${id}/withdraw`, { reason: 'Opened by mistake' })
    expect(withdrawn.statusCode).toBe(200)
    expect(withdrawn.json().data.state).toBe('withdrawn')
  })

  test('an opener who no longer holds the create permission over the market cannot withdraw', async () => {
    const consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
    const id = await openCase(consultant)
    await ownerRows("UPDATE role_assignment SET market_ids = $2 WHERE user_id = $1", [consultant.id, [my]])

    expect((await post(consultant, `/v1/cases/${id}/withdraw`, { reason: 'Opened by mistake' })).statusCode).toBe(404)
  })

  test('the case history keeps the reasons of a withdrawal and a decision (AC-CAS1-5)', async () => {
    const withdrawnId = await submittedCase()
    await post(admin, `/v1/cases/${withdrawnId}/withdraw`, { reason: 'Duplicate of another case' })
    const decidedId = await submittedCase()
    const approvalId = (await decide(decider, decidedId)).json().data.approval_id

    const withdrawnEvents = (await get(analyst, `/v1/cases/${withdrawnId}`)).json().data.events
    const decidedEvents = (await get(analyst, `/v1/cases/${decidedId}`)).json().data.events
    expect(withdrawnEvents.at(-1)).toMatchObject({ kind: 'withdrawn', data: { reason: 'Duplicate of another case' } })
    expect(decidedEvents.at(-1)).toMatchObject({ kind: 'approved', data: { approval_id: approvalId, reason: 'Checked against the bank letter' } })
  })
})

describe('reads, scope and isolation (AC-CAS1-5, TS-21)', () => {
  test('the list shows readable types within each reader\'s market scope, filtered and paged', async () => {
    const myCase = await openCase(admin, my)
    const overdue = await submittedCase()
    await ownerRows("UPDATE case_file SET due_at = now() - interval '1 hour' WHERE id = $1", [overdue])

    const all = (await get(analyst, '/v1/cases?limit=200')).json().data.map((row: { id: string }) => row.id)
    const scoped = (await get(analystMy, '/v1/cases?limit=200')).json().data.map((row: { id: string }) => row.id)
    const late = (await get(analyst, '/v1/cases?overdue=true')).json().data.map((row: { id: string }) => row.id)
    const first = await get(analyst, `/v1/cases?state=open&subject_id=${my}&limit=1`)

    expect(all).toEqual(expect.arrayContaining([myCase, overdue]))
    expect(scoped).toContain(myCase)
    expect(scoped).not.toContain(overdue)
    expect(late).toEqual([overdue])
    expect(first.json().data.map((row: { id: string }) => row.id)).toEqual([myCase])
    const next = first.json().meta.next_cursor as string
    expect(next).not.toBeNull()
    const second = (await get(analyst, `/v1/cases?state=open&subject_id=${my}&cursor=${next}`)).json().data
    expect(second.map((row: { id: string }) => row.id)).not.toContain(myCase)
    expect((await get(analyst, '/v1/cases?type=dispute')).json().data).toEqual([])
  })

  test('without a readable case type the list is refused and a case is not found', async () => {
    const id = await openCase()

    expect((await get(support, '/v1/cases')).statusCode).toBe(403)
    expect((await get(support, `/v1/cases/${id}`)).statusCode).toBe(404)
    expect((await get(analystMy, `/v1/cases/${id}`)).statusCode).toBe(404)
    expect((await get(analyst, `/v1/cases/${id}`)).json().data.eligible_approvers).toBeNull()
  })

  test('another tenant sees none of the cases and reaches none of them', async () => {
    const id = await submittedCase()
    const globexList = (await get(globexAdmin, '/v1/cases?limit=200')).json().data.map((row: { id: string }) => row.id)

    expect(globexList).not.toContain(id)
    expect((await get(globexAdmin, `/v1/cases/${id}`)).statusCode).toBe(404)
    expect((await post(globexAdmin, `/v1/cases/${id}/evidence`, { document_id: randomUUID() }, true)).statusCode).toBe(404)
    expect((await post(globexAdmin, `/v1/cases/${id}/assign`, { user_id: null })).statusCode).toBe(404)
    expect((await post(globexAdmin, `/v1/cases/${id}/submit`, {})).statusCode).toBe(404)
    expect((await decide(globexAdmin, id)).statusCode).toBe(404)
    expect((await post(globexAdmin, `/v1/cases/${id}/withdraw`, { reason: 'x' })).statusCode).toBe(404)
  })

  test('case evidence documents are readable by readers of the case, within their market scope (D-B1-04)', async () => {
    const id = await openCase()
    const documentId = await attach(admin, id)

    expect((await get(analyst, `/v1/documents/${documentId}`)).statusCode).toBe(200)
    for (const reader of [analystMy, support, globexAdmin]) {
      expect((await get(reader, `/v1/documents/${documentId}`)).statusCode).toBe(404)
    }
  })

  test('case events are insert-only', async () => {
    const id = await openCase()

    await expect(ownerRows("UPDATE case_event SET kind = 'updated' WHERE case_id = $1", [id])).rejects.toThrow()
    await expect(ownerRows('DELETE FROM case_event WHERE case_id = $1', [id])).rejects.toThrow()
  })
})
