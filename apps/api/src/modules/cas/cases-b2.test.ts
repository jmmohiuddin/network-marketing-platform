import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule, openSystemCase, type CaseTypeDefinition } from './index.js'
import { evidenceDocument, FIXTURE_CASE_TYPE, FIXTURE_REASONS, FIXTURE_SUBJECT, openFixtureCase } from './test-support.js'

// PLAN B2 2.4 (D-B2-04): PATCH /v1/cases/:id, GET /v1/cases/counts, validateCreate, system-opened cases.
// TEST FIXTURE ONLY: the 'duplicate' slot about a market, so the system may open it (case_file_insert_guard).
const SYSTEM_TYPE: CaseTypeDefinition = {
  ...(FIXTURE_CASE_TYPE as CaseTypeDefinition), type: 'duplicate', evidenceRequired: false, payload: z.strictObject({ note: z.string() }),
  validateCreate: undefined, effectPreview: undefined, dueAt: undefined, onDecision: undefined,
}

let app: FastifyInstance
let acme: TestTenant
let gb: string
let my: string
let admin: TestUser
let admin2: TestUser
let decider: TestUser
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
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Compliance officer'], stepUp: true })
  admin2 = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  decider = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  analystMy = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [my] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  app = await buildTestApp({ modules: [createCasModule({ types: [FIXTURE_CASE_TYPE as CaseTypeDefinition, SYSTEM_TYPE] })] })
})

afterAll(async () => {
  await app.close()
})

const patch = (as: TestUser, id: string, body: unknown) => call(app, { method: 'PATCH', url: `/v1/cases/${id}`, as, body })
const post = (as: TestUser, url: string, body: unknown, idempotencyKey?: true) => call(app, { method: 'POST', url, as, body, ...(idempotencyKey ? { idempotencyKey } : {}) })

describe('PATCH /v1/cases/:id', () => {
  test('the preparer changes reason code and payload of an open case; event, audit and the type\'s checks', async () => {
    const id = (await openFixtureCase(app, admin, gb)).json().data.id as string
    const changed = await patch(admin, id, { reason_code: FIXTURE_REASONS[1], payload: { amount_minor: '75' } })
    const refusedByHook = await patch(admin, id, { payload: { amount_minor: '-999' } })
    const badPayload = await patch(admin, id, { payload: { amount_minor: 'x' } })
    const badReason = await patch(admin, id, { reason_code: 'nope' })
    const empty = await patch(admin, id, {})

    expect(changed.statusCode).toBe(200)
    expect(changed.json().data).toMatchObject({ reason_code: FIXTURE_REASONS[1], payload: { amount_minor: '75' } })
    expect(refusedByHook.json().error.code).toBe('FIXTURE_REFUSED')
    expect(badPayload.json().error.code).toBe('VALIDATION_FAILED')
    expect(badPayload.statusCode).toBe(422)
    expect(badReason.json().error.code).toBe('REASON_CODE_INVALID')
    expect(empty.statusCode).toBe(400)
    expect(await ownerRows(`SELECT kind, actor_id FROM case_event WHERE case_id = $1 AND kind = 'updated'`, [id])).toEqual([{ kind: 'updated', actor_id: admin.id }])
    expect(await auditActions(acme.id)).toContain('CASE.UPDATED')
    expect((await ownerRows<{ payload: unknown }>('SELECT payload FROM case_file WHERE id = $1', [id]))[0]!.payload).toEqual({ amount_minor: '75' })
  })

  test('only open cases; readers without the create permission 403; others 404', async () => {
    const id = (await openFixtureCase(app, admin, gb)).json().data.id as string

    expect((await patch(analyst, id, { payload: { amount_minor: '1' } })).statusCode).toBe(403)
    expect((await patch(support, id, { payload: { amount_minor: '1' } })).statusCode).toBe(404)
    expect((await patch(globexAdmin, id, { payload: { amount_minor: '1' } })).statusCode).toBe(404)
    await post(admin, `/v1/cases/${id}/evidence`, { document_id: await evidenceDocument(admin) }, true)
    await post(admin, `/v1/cases/${id}/submit`, {})
    expect((await patch(admin, id, { payload: { amount_minor: '1' } })).json().error.code).toBe('CASE_STATE_CONFLICT')
  })

  test('validateCreate also runs at create: nothing is stored', async () => {
    const before = (await ownerRows('SELECT 1 FROM case_file WHERE tenant_id = $1', [acme.id])).length
    const refused = await openFixtureCase(app, admin, gb, { amount_minor: '-999' })

    expect(refused.json().error.code).toBe('FIXTURE_REFUSED')
    expect((await ownerRows('SELECT 1 FROM case_file WHERE tenant_id = $1', [acme.id])).length).toBe(before)
  })
})

describe('GET /v1/cases/counts', () => {
  test('per readable type within the market scope; no readable type 403', async () => {
    await openFixtureCase(app, admin, my)
    const all = await call(app, { method: 'GET', url: '/v1/cases/counts', as: analyst })
    const scoped = await call(app, { method: 'GET', url: '/v1/cases/counts?type=adjustment', as: analystMy })
    const open = (await ownerRows<{ n: number }>(`SELECT count(*)::int AS n FROM case_file WHERE tenant_id = $1 AND type = 'adjustment' AND state = 'open'`, [acme.id]))[0]!.n

    expect(all.json().data).toEqual([
      { type: 'adjustment', open, submitted: expect.any(Number), overdue: 0, decided_30d: 0 },
      { type: 'duplicate', open: 0, submitted: 0, overdue: 0, decided_30d: 0 },
    ])
    expect(scoped.json().data).toEqual([{ type: 'adjustment', open: 1, submitted: 0, overdue: 0, decided_30d: 0 }])
    expect((await call(app, { method: 'GET', url: '/v1/cases/counts', as: support })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/cases/counts?type=transfer', as: analyst })).statusCode).toBe(403)
    const globex = (await call(app, { method: 'GET', url: '/v1/cases/counts', as: globexAdmin })).json().data
    expect(globex.every((row: { open: number; submitted: number }) => row.open === 0 && row.submitted === 0)).toBe(true)
  })
})

describe('system-opened cases (D-B2-04)', () => {
  test('no opener, actorless opened event; not withdrawable; the submitter is the preparer', async () => {
    const opened = await withTenant({ tenantId: acme.id, userId: admin2.id }, (tx) => openSystemCase(tx, {
      type: 'duplicate', subjectType: FIXTURE_SUBJECT, subjectId: gb, reasonCode: FIXTURE_REASONS[0], payload: { note: 'match' }, marketId: gb,
    }))
    const detail = await call(app, { method: 'GET', url: `/v1/cases/${opened.id}`, as: admin })
    const withdraw = await post(admin2, `/v1/cases/${opened.id}/withdraw`, { reason: 'x' })
    await post(admin, `/v1/cases/${opened.id}/submit`, {})
    const submitted = await call(app, { method: 'GET', url: `/v1/cases/${opened.id}`, as: decider })
    const self = await post(admin, `/v1/cases/${opened.id}/decision`, { decision: 'approve', reason: 'ok' }, true)
    const approved = await post(decider, `/v1/cases/${opened.id}/decision`, { decision: 'approve', reason: 'ok' }, true)

    expect(detail.json().data).toMatchObject({ opened_by: null, opened_by_kind: 'system', events: [{ kind: 'opened', actor_id: null }] })
    expect(withdraw.statusCode).toBe(403)
    expect(submitted.json().data.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(admin.id)
    expect(self.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL' })
    expect(approved.json().data.state).toBe('approved')
    const [audit] = await ownerRows<{ after_ref: string }>(`SELECT after_ref FROM audit.audit_event WHERE object_id = $1 AND action = 'CASE.OPENED'`, [opened.id])
    expect(JSON.parse(audit!.after_ref).after).toMatchObject({ opened_by_kind: 'system' })
  })
})

// After the counts: the system case below stays open.
describe('PATCH /v1/cases/:id preparers', () => {
  test('a user-opened case is changed only by its opener or assignee; a system-opened one by any preparer', async () => {
    const id = (await openFixtureCase(app, admin, gb)).json().data.id as string
    const system = await withTenant({ tenantId: acme.id, userId: admin.id }, (tx) => openSystemCase(tx, {
      type: 'duplicate', subjectType: FIXTURE_SUBJECT, subjectId: gb, reasonCode: FIXTURE_REASONS[0], payload: { note: 'match' }, marketId: gb,
    }))

    const bySomeoneElse = await patch(admin2, id, { payload: { amount_minor: '5' } })
    await post(admin, `/v1/cases/${id}/assign`, { user_id: admin2.id })
    const byAssignee = await patch(admin2, id, { payload: { amount_minor: '6' } })
    const systemCase = await patch(admin2, system.id, { payload: { note: 'reviewed' } })

    expect(bySomeoneElse.json().error.code).toBe('PERMISSION_DENIED')
    expect(byAssignee.statusCode).toBe(200)
    expect(systemCase.statusCode).toBe(200)
  })
})
