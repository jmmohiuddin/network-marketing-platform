import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { parModule } from './index.js'
import { DISTRIBUTOR } from './test-support.js'

// T-B2-01, AC-PAR1-1 (D-B2-09): participant types proposed by a Tenant admin, approved by a Compliance officer.
let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let adminCompliance: TestUser
let compliance: TestUser
let complianceNoStepUp: TestUser
let support: TestUser
let globexCompliance: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  // Holds settings.manage and participant_type.approve: only separation of duties stops it approving its own proposal.
  adminCompliance = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Compliance officer'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  complianceNoStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  globexCompliance = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'], stepUp: true })
  app = await buildTestApp({ modules: [parModule] })
})

afterAll(async () => {
  await app.close()
})

const propose = (as: TestUser, code: string, extra: Record<string, unknown> = {}) =>
  call(app, { method: 'POST', url: '/v1/participant-types', as, idempotencyKey: true, body: { code, name: `${code} type`, ...DISTRIBUTOR, reason: 'new plan', ...extra } })
const decide = (as: TestUser, id: string, decision: 'approve' | 'reject' = 'approve') =>
  call(app, { method: 'POST', url: `/v1/participant-types/${id}/decision`, as, idempotencyKey: true, body: { decision, reason: 'checked' } })

describe('POST /v1/participant-types and decision (T-B2-01)', () => {
  test('proposed pending with eligible approvers; the proposer is refused SOD-01 (audited); a Compliance officer approves', async () => {
    const created = await propose(adminCompliance, 'DIST')
    const id = created.json().data.id as string
    const self = await decide(adminCompliance, id)
    const noStepUp = await decide(complianceNoStepUp, id)
    const approved = await decide(compliance, id)
    const again = await decide(compliance, id)

    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({ code: 'DIST', state: 'pending', requested_by: { id: adminCompliance.id }, can_hold_positions: true })
    expect(created.json().data.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(adminCompliance.id)
    expect(self.statusCode).toBe(422)
    expect(self.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01', no_eligible_approver: false } })
    expect(noStepUp.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(approved.json().data).toMatchObject({ state: 'active', decided_by: { id: compliance.id }, eligible_approvers: null })
    expect(again.json().error.code).toBe('TYPE_NOT_PENDING')
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['PARTICIPANT_TYPE.PROPOSED', 'APPROVAL.REFUSED', 'PARTICIPANT_TYPE.APPROVED']))
  })

  test('a code in use is 409 TYPE_CODE_TAKEN; rejected and withdrawn codes are free again', async () => {
    const taken = await propose(admin, 'DIST')
    const rejected = (await propose(admin, 'REJ')).json().data.id as string
    await decide(compliance, rejected, 'reject')
    const withdrawn = (await propose(admin, 'WD')).json().data.id as string
    const notMine = await call(app, { method: 'POST', url: `/v1/participant-types/${withdrawn}/withdraw`, as: adminCompliance, body: { reason: 'x' } })
    const mine = await call(app, { method: 'POST', url: `/v1/participant-types/${withdrawn}/withdraw`, as: admin, body: { reason: 'not needed' } })

    expect(taken.json().error.code).toBe('TYPE_CODE_TAKEN')
    expect(notMine.statusCode).toBe(404)
    expect(mine.json().data).toMatchObject({ state: 'withdrawn', decision_reason: 'not needed', decided_by: null })
    expect((await propose(admin, 'REJ')).statusCode).toBe(201)
    expect((await propose(admin, 'WD')).statusCode).toBe(201)
    expect(await ownerRows('SELECT state FROM participant_type WHERE id = $1', [rejected])).toEqual([{ state: 'rejected' }])
  })

  test('permissions, validation and tenant isolation', async () => {
    const pending = (await propose(admin, 'ISO')).json().data.id as string

    expect((await propose(support, 'NOPE')).statusCode).toBe(403)
    expect((await propose(compliance, 'NOPE')).statusCode).toBe(403)
    expect((await decide(support, pending)).statusCode).toBe(403)
    expect((await propose(admin, 'lower')).json().error.code).toBe('VALIDATION_FAILED')
    expect((await propose(admin, 'X', { extra: true })).statusCode).toBe(400)
    expect((await decide(globexCompliance, pending)).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/participant-types', as: globexCompliance })).json().data).toEqual([])
    const list = await call(app, { method: 'GET', url: '/v1/participant-types?state=pending', as: support })
    expect(list.statusCode).toBe(200)
    expect(list.json().data.map((t: { code: string }) => t.code)).toContain('ISO')
    expect(list.json().data.every((t: { state: string }) => t.state === 'pending')).toBe(true)
  })
})
