// D-B4-11 related-party declarations (PLAN B4 section 2.5): declare, list, withdraw; user.manage for all markets.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'

let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let staff: TestUser
let scopedAdmin: TestUser
let analyst: TestUser
let globexAdmin: TestUser
let payee: string
let globexPayee: string

closePoolsAfterAll()

async function participant(tenantId: string, marketId: string, ref: string): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, '2026-01-01', '00000000-0000-0000-0000-000000000000', 'system') RETURNING id`,
    [tenantId, ref, marketId],
  )
  return row!.id
}

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  staff = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [gb] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  payee = await participant(acme.id, gb, 'REL-1')
  globexPayee = await participant(globex.id, await createMarket(globex.id, 'GB'), 'REL-2')
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const url = (userId: string) => `/v1/users/${userId}/related-participants`
const declare = (as: TestUser, userId: string, body: unknown, idempotencyKey: true | string = true) => call(app, { method: 'POST', url: url(userId), as, body, idempotencyKey })
const list = (as: TestUser, userId: string) => call(app, { method: 'GET', url: url(userId), as })
const withdraw = (as: TestUser, userId: string, id: string, reason = 'Declared by mistake') =>
  call(app, { method: 'POST', url: `${url(userId)}/${id}/withdraw`, as, body: { reason } })
const related = async (participantId: string): Promise<string[]> =>
  (await ownerRows<{ id: string }>('SELECT staff_related_users($1) AS id', [participantId])).map((r) => r.id)

describe('D-B4-11 related-party declarations', () => {
  test('declare, list and withdraw, audited; staff_related_users follows; a withdrawn declaration can be made again', async () => {
    const key = `declare-${staff.id}`
    const declared = await declare(admin, staff.id, { participant_id: payee, relation: 'relative' }, key)
    expect(declared.statusCode).toBe(201)
    const id = declared.json().data.id as string
    expect(declared.json().data).toEqual({
      id, participant: { id: payee, external_ref: 'REL-1', display_name: 'REL-1' }, relation: 'relative', declared_by: admin.id,
      declared_at: expect.any(String), withdrawn_at: null,
    })
    expect((await declare(admin, staff.id, { participant_id: payee, relation: 'relative' }, key)).json().data.id).toBe(id)
    expect((await declare(admin, staff.id, { participant_id: payee, relation: 'self' })).json().error.code).toBe('ALREADY_DECLARED')
    expect(await related(payee)).toEqual([staff.id])
    expect((await list(admin, staff.id)).json().data).toMatchObject([{ id, relation: 'relative', withdrawn_at: null }])

    const withdrawn = await withdraw(admin, staff.id, id)
    expect(withdrawn.statusCode).toBe(200)
    expect(withdrawn.json().data.withdrawn_at).toEqual(expect.any(String))
    expect((await withdraw(admin, staff.id, id)).json().error.code).toBe('ALREADY_WITHDRAWN')
    const [audit] = await ownerRows<{ before_ref: string; after_ref: string }>(
      "SELECT before_ref, after_ref FROM audit.audit_event WHERE action = 'IAM.RELATED_PARTY_WITHDRAWN' AND object_id = $1", [id])
    const withdrawnWhat = { user_id: staff.id, participant_id: payee, relation: 'relative' }
    expect(JSON.parse(audit!.before_ref)).toEqual({ ...withdrawnWhat, withdrawn_at: null })
    expect(JSON.parse(audit!.after_ref).after).toEqual({ ...withdrawnWhat, withdrawn_at: expect.any(String) })
    expect(await related(payee)).toEqual([])
    expect((await declare(admin, staff.id, { participant_id: payee, relation: 'self' })).statusCode).toBe(201)
    expect(await related(payee)).toEqual([staff.id])
    expect((await auditActions(acme.id)).filter((a) => a.startsWith('IAM.RELATED_PARTY'))).toEqual([
      'IAM.RELATED_PARTY_DECLARED', 'IAM.RELATED_PARTY_WITHDRAWN', 'IAM.RELATED_PARTY_DECLARED',
    ])
  })

  test('refusals: unknown user 404, unknown or foreign participant 422, bad relation 400, unknown declaration 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000001'
    expect((await declare(admin, unknown, { participant_id: payee, relation: 'self' })).statusCode).toBe(404)
    expect((await list(admin, unknown)).statusCode).toBe(404)
    expect((await declare(admin, analyst.id, { participant_id: unknown, relation: 'self' })).json().error.code).toBe('PARTICIPANT_NOT_FOUND')
    expect((await declare(admin, analyst.id, { participant_id: globexPayee, relation: 'self' })).json().error.code).toBe('PARTICIPANT_NOT_FOUND')
    expect((await declare(admin, analyst.id, { participant_id: payee, relation: 'friend' })).statusCode).toBe(400)
    expect((await withdraw(admin, analyst.id, unknown)).statusCode).toBe(404)
  })

  test('missing permission 403, a market-scoped admin 403 SCOPE_NOT_HELD, cross-tenant 404', async () => {
    const declared = await declare(admin, analyst.id, { participant_id: payee, relation: 'self' })
    const id = declared.json().data.id as string
    for (const response of [await list(analyst, analyst.id), await declare(analyst, analyst.id, { participant_id: payee, relation: 'relative' }), await withdraw(analyst, analyst.id, id)]) {
      expect(response.statusCode).toBe(403)
    }
    for (const response of [await list(scopedAdmin, analyst.id), await declare(scopedAdmin, analyst.id, { participant_id: payee, relation: 'relative' }), await withdraw(scopedAdmin, analyst.id, id)]) {
      expect(response.json().error.code).toBe('SCOPE_NOT_HELD')
    }
    expect((await list(globexAdmin, analyst.id)).statusCode).toBe(404)
    expect((await declare(globexAdmin, analyst.id, { participant_id: globexPayee, relation: 'self' })).statusCode).toBe(404)
    expect((await withdraw(globexAdmin, analyst.id, id)).statusCode).toBe(404)
    expect((await list(admin, analyst.id)).json().data[0].withdrawn_at).toBeNull()
  })

  test('BR-ADJ-02/03: an admin cannot withdraw a declaration about themselves (422 SOD_SELF_APPROVAL; the database refuses too)', async () => {
    const self = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
    const id = (await declare(admin, self.id, { participant_id: payee, relation: 'self' })).json().data.id as string
    expect((await withdraw(self, self.id, id)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(await related(payee)).toContain(self.id)
    await expect(ownerRows(
      "UPDATE user_related_participant SET withdrawn_at = now(), withdrawn_by = user_id, withdraw_reason = 'own' WHERE id = $1", [id],
    )).rejects.toMatchObject({ code: '42501' })
    expect((await withdraw(admin, self.id, id)).statusCode).toBe(200)
  })
})
