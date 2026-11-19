// T-B4-08, D-B4-10: two-approval decisions and excluded approvers in CAS, with a variant of the fixture case type whose
// hooks the test steers (approvalsRequired by amount against a threshold, excludedApprovers from a list).
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { ApiError } from '../../lib/errors.js'
import { audModule } from '../aud/index.js'
import { createCasModule } from './index.js'
import { evidenceDocument, FIXTURE_CASE_TYPE, openFixtureCase } from './test-support.js'
import type { CaseTypeDefinition } from './types.js'

let threshold = 1000n
let related: string[] = []
const HOOK_REFUSES = '777' // the hook refuses like the adjustment's does once its period is committed
const TWO_STEP: CaseTypeDefinition = {
  ...(FIXTURE_CASE_TYPE as CaseTypeDefinition),
  async approvalsRequired(_tx, c) {
    const amount = (c.payload as { amount_minor: string }).amount_minor
    if (amount === HOOK_REFUSES) throw new ApiError(409, 'PERIOD_NOT_OPEN', 'The period is committed.')
    return BigInt((c.payload as { amount_minor: string }).amount_minor) > threshold ? 2 : 1
  },
  async excludedApprovers() {
    return related
  },
}

let app: FastifyInstance
let gb: string
let preparer: TestUser
let first: TestUser
let second: TestUser
let third: TestUser
let foreign: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  preparer = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  first = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  second = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  third = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  foreign = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'], stepUp: true })
  app = await buildTestApp({ modules: [createCasModule({ types: [TWO_STEP] }), audModule] })
})

afterAll(async () => {
  await app.close()
})

const post = (as: TestUser, url: string, body: unknown, idempotencyKey: true | string = true) => call(app, { method: 'POST', url, as, body, idempotencyKey })
const get = (as: TestUser, id: string) => call(app, { method: 'GET', url: `/v1/cases/${id}`, as })
const decide = (as: TestUser, id: string, decision: 'approve' | 'reject' = 'approve', key: true | string = true) =>
  post(as, `/v1/cases/${id}/decision`, { decision, reason: 'Checked against the statement' }, key)

async function submitted(amount: string): Promise<string> {
  const opened = await openFixtureCase(app, preparer, gb, { amount_minor: amount })
  const id = opened.json().data.id as string
  expect((await post(preparer, `/v1/cases/${id}/evidence`, { document_id: await evidenceDocument(preparer) })).statusCode).toBe(201)
  expect((await call(app, { method: 'POST', url: `/v1/cases/${id}/submit`, as: preparer, body: {} })).statusCode).toBe(200)
  return id
}

const auditActions = async (caseId: string): Promise<string[]> =>
  (await ownerRows<{ action: string }>('SELECT action FROM audit.audit_event WHERE object_id = $1 ORDER BY seq', [caseId])).map((r) => r.action)
const eligibleIds = async (id: string): Promise<string[]> => (await get(first, id)).json().data.eligible_approvers.map((u: { user_id: string }) => u.user_id)

describe('T-B4-08: a case needing two approvals', () => {
  test('approvals_required is the hook answer while open, pinned at submit; first approve keeps it submitted; a second person approves', async () => {
    const opened = await openFixtureCase(app, preparer, gb, { amount_minor: '5000' })
    expect(opened.json().data).toMatchObject({ state: 'open', approvals_required: 2, first_approval: null })
    const id = opened.json().data.id as string
    await post(preparer, `/v1/cases/${id}/evidence`, { document_id: await evidenceDocument(preparer) })
    const submit = await call(app, { method: 'POST', url: `/v1/cases/${id}/submit`, as: preparer, body: {} })
    expect(submit.json().data).toMatchObject({ state: 'submitted', approvals_required: 2 })
    threshold = 1_000_000n // a policy change after submit does not change what the submitted case needs
    try {
      const key = `first-${id}`
      const firstApproval = await decide(first, id, 'approve', key)
      expect(firstApproval.statusCode).toBe(200)
      expect(firstApproval.json().data).toMatchObject({ state: 'submitted', approvals_required: 2, approval_id: null, first_approval: { approver: { id: first.id }, decided_at: expect.any(String) } })
      expect((await decide(first, id, 'approve', key)).json().data.first_approval.approver.id).toBe(first.id) // replay: stored answer
      const detail = (await get(first, id)).json().data
      expect(detail.events.map((e: { kind: string }) => e.kind)).toEqual(['opened', 'evidence_added', 'submitted', 'first_approved'])
      expect(detail.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(first.id)
      expect(await auditActions(id)).toContain('CASE.FIRST_APPROVED')

      const again = await decide(first, id)
      expect(again.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
      expect((await decide(preparer, id)).json().error.code).toBe('SOD_SELF_APPROVAL')

      const final = await decide(second, id)
      expect(final.statusCode).toBe(200)
      expect(final.json().data).toMatchObject({ state: 'approved', approvals_required: 2, first_approval: { approver: { id: first.id } } })
      expect(final.json().data.approval_id).not.toBeNull()
      expect((await auditActions(id)).filter((a) => a === 'FIXTURE.CASE_DECIDED')).toHaveLength(1)
      expect((await decide(third, id)).json().error.code).toBe('CASE_STATE_CONFLICT')
    } finally {
      threshold = 1000n
    }
  })

  test('an open case whose approvalsRequired hook refuses stays listable, readable, assignable and editable; submit refuses', async () => {
    const opened = await openFixtureCase(app, preparer, gb, { amount_minor: HOOK_REFUSES })
    expect(opened.statusCode).toBe(201)
    expect(opened.json().data.approvals_required).toBeNull()
    const id = opened.json().data.id as string
    const list = await call(app, { method: 'GET', url: '/v1/cases?state=open', as: first })
    expect(list.statusCode).toBe(200)
    expect(list.json().data.find((row: { id: string }) => row.id === id)).toMatchObject({ state: 'open', approvals_required: null })
    const read = await get(first, id)
    expect(read.statusCode).toBe(200)
    expect(read.json().data.approvals_required).toBeNull()
    expect((await post(first, `/v1/cases/${id}/assign`, { user_id: first.id })).statusCode).toBe(200)
    await post(preparer, `/v1/cases/${id}/evidence`, { document_id: await evidenceDocument(preparer) })
    const submit = await call(app, { method: 'POST', url: `/v1/cases/${id}/submit`, as: preparer, body: {} })
    expect(submit.json().error.code).toBe('PERIOD_NOT_OPEN')
    const edited = await call(app, { method: 'PATCH', url: `/v1/cases/${id}`, as: preparer, body: { payload: { amount_minor: '10' } } })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().data.approvals_required).toBe(1)
  })

  test('a case needing one approval is decided by the first approve', async () => {
    const id = await submitted('10')
    expect((await get(first, id)).json().data).toMatchObject({ approvals_required: 1, first_approval: null })
    expect((await decide(first, id)).json().data).toMatchObject({ state: 'approved', first_approval: null })
  })

  test('reject decides at either step', async () => {
    const atFirst = await submitted('5000')
    expect((await decide(first, atFirst, 'reject')).json().data).toMatchObject({ state: 'rejected', first_approval: null })
    const atSecond = await submitted('5000')
    await decide(first, atSecond)
    expect((await decide(first, atSecond, 'reject')).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await decide(second, atSecond, 'reject')).json().data).toMatchObject({ state: 'rejected', first_approval: { approver: { id: first.id } } })
  })

  test('excludedApprovers bar a user at either step and leave the eligible list', async () => {
    const id = await submitted('5000')
    related = [third.id]
    try {
      expect(await eligibleIds(id)).not.toContain(third.id)
      expect((await decide(third, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
      await decide(first, id)
      expect((await decide(third, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
      expect((await decide(second, id)).json().data.state).toBe('approved')
    } finally {
      related = []
    }
  })

  test('excluded approvers are pinned at submit: an exclusion lifted after submit does not free its user', async () => {
    related = [third.id]
    let id: string
    try {
      id = await submitted('5000')
    } finally {
      related = []
    }
    expect(await eligibleIds(id)).not.toContain(third.id)
    expect((await get(first, id)).json().data.events.find((e: { kind: string }) => e.kind === 'submitted').data).toBeNull()
    expect(await ownerRows("SELECT data FROM case_event WHERE case_id = $1 AND kind = 'submitted'", [id])).toEqual([{ data: { excluded_approvers: [third.id] } }])
    expect((await decide(third, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
    await decide(first, id)
    expect((await decide(third, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await decide(second, id)).json().data.state).toBe('approved')
  })

  test('decision: missing permission and cross-tenant denial', async () => {
    const id = await submitted('5000')
    expect((await decide(foreign, id)).statusCode).toBe(404)
    const analyst = await createSignedInUser({ tenantId: preparer.tenantId!, roles: ['Commission analyst'], stepUp: true })
    expect((await decide(analyst, id)).statusCode).toBe(403)
  })
})
