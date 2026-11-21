import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { parModule } from './index.js'
import { activeType, DISTRIBUTOR, enrolled, enrolment } from './test-support.js'

// T-V1A-40 (FR-PAR-004, D-V1A-06, AC-PAR4-1): account type and holders; names only through the audited unmask.

let app: FastifyInstance
let acme: TestTenant
let my: string
let admin: TestUser
let compliance: TestUser
let dpo: TestUser
let support: TestUser
let supportMy: TestUser
let analyst: TestUser
let globexSupport: TestUser
let member: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  await createMarket(acme.id, 'GB')
  my = await createMarket(acme.id, 'MY')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  dpo = await createSignedInUser({ tenantId: acme.id, roles: ['DPO'], stepUp: true })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], stepUp: true })
  supportMy = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [my] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexSupport = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })
  app = await buildTestApp({ modules: [parModule] })
  await activeType(app, admin, compliance, 'DIST', DISTRIBUTOR)
  member = (await enrolled(app, support, enrolment('DIST'))).participant.id
})

afterAll(async () => {
  await app.close()
})

const put = (as: TestUser, body: unknown, id = member) => call(app, { method: 'PUT', url: `/v1/participants/${id}/account`, as, body })
const error = (response: Awaited<ReturnType<typeof put>>) => [response.statusCode, response.json().error.code, response.json().error.details]

describe('PUT /v1/participants/:id/account (T-V1A-40)', () => {
  test('joint with holders: counts in the view and the audit, names only in the unmask response', async () => {
    const holders = [{ name: 'Alex Joint', role: 'joint_holder' }, { name: 'Sam Signer', role: 'authorised_signatory' }]

    const response = await put(support, { account_type: 'joint', holders })

    expect([response.statusCode, response.json().data]).toEqual([200, { account_type: 'joint', account_holders_count: 2 }])
    const record = await call(app, { method: 'GET', url: `/v1/participants/${member}`, as: support })
    expect(record.json().data).toMatchObject({ account_type: 'joint', account_holders_count: 2 })
    expect(record.body).not.toContain('Alex Joint')
    const audits = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'PARTICIPANT.ACCOUNT_CHANGED'`, [acme.id])
    expect(audits.map((row) => JSON.parse(row.after_ref).after)).toEqual([{ account_type: 'joint', holders_count: 2 }])
    expect(JSON.stringify(audits)).not.toContain('Alex')

    const unmasked = await call(app, { method: 'POST', url: `/v1/participants/${member}/unmask`, as: dpo, body: { fields: ['account_holders'] } })
    expect(unmasked.json().data).toEqual({ contact: {}, account_holders: holders })
  })

  test('validation: joint needs a joint holder, entity a signatory, individual none, at most four', async () => {
    const signer = { name: 'S', role: 'authorised_signatory' }
    expect(error(await put(support, { account_type: 'joint', holders: [signer] }))).toEqual([422, 'VALIDATION_FAILED', { field: 'holders' }])
    expect(error(await put(support, { account_type: 'entity' }))).toEqual([422, 'VALIDATION_FAILED', { field: 'holders' }])
    expect(error(await put(support, { account_type: 'individual', holders: [signer] }))).toEqual([422, 'VALIDATION_FAILED', { field: 'holders' }])
    expect((await put(support, { account_type: 'entity', holders: Array(5).fill(signer) })).statusCode).toBe(400)
    expect((await put(support, { account_type: 'business' })).statusCode).toBe(400)
    expect((await put(support, { account_type: 'entity', holders: [signer] })).json().data).toEqual({ account_type: 'entity', account_holders_count: 1 })
    expect((await put(support, { account_type: 'individual' })).json().data).toEqual({ account_type: 'individual', account_holders_count: 0 })
  })

  test('403 without participant.manage, 404 out of market scope and across tenants, portal sessions refused', async () => {
    const portal = await createPortalUser({ tenantId: acme.id, participantId: member })
    expect(error(await put(analyst, { account_type: 'individual' }))[0]).toBe(403)
    expect(error(await put(supportMy, { account_type: 'individual' }))[0]).toBe(404)
    expect(error(await put(globexSupport, { account_type: 'individual' }))[0]).toBe(404)
    expect(error(await put(portal, { account_type: 'individual' }))[0]).toBe(403)
    expect(error(await put(support, { account_type: 'individual' }, '00000000-0000-4000-8000-000000000000'))[0]).toBe(404)
  })

  test('an erased participant\'s account cannot change (its holders were cleared)', async () => {
    const erased = (await enrolled(app, support, enrolment('DIST'))).participant.id
    await ownerRows('UPDATE participant SET pseudonymised_at = now(), display_name = NULL, contact = NULL, identity_doc_id = NULL WHERE id = $1', [erased])

    expect(error(await put(support, { account_type: 'individual' }, erased))).toEqual([409, 'SUBJECT_ERASED', null])
  })
})
