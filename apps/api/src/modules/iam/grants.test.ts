import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, baseRoleId, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant,
  ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'

let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let approver: TestUser
let globexAdmin: TestUser
let analyst: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  approver = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const grant = (as: TestUser, userId: string, body: Record<string, unknown>) =>
  call(app, { method: 'POST', url: `/v1/users/${userId}/role-assignments`, as, body, idempotencyKey: true })
const decide = (as: TestUser, requestId: string, decision: 'approved' | 'rejected', reason?: string) =>
  call(app, { method: 'POST', url: `/v1/role-grant-requests/${requestId}/decision`, as, body: { decision, reason }, idempotencyKey: true })
const permissionsOf = async (as: TestUser) => (await call(app, { method: 'GET', url: '/v1/me', as })).json().data.permissions as string[]

describe('GET /v1/roles and POST /v1/roles', () => {
  test('lists the base roles and the tenant roles, with the catalogue in meta', async () => {
    const created = await call(app, { method: 'POST', url: '/v1/roles', as: admin, body: { name: 'Auditor', permissions: ['audit.read'] }, idempotencyKey: true })
    const own = (await call(app, { method: 'GET', url: '/v1/roles', as: admin })).json()
    const foreign = (await call(app, { method: 'GET', url: '/v1/roles', as: globexAdmin })).json()

    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({ name: 'Auditor', is_base: false, mfa_required: false, privileged: false })
    expect(own.data.filter((role: { is_base: boolean }) => role.is_base)).toHaveLength(11)
    expect(own.data.map((role: { name: string }) => role.name)).toContain('Auditor')
    expect(foreign.data.map((role: { name: string }) => role.name)).not.toContain('Auditor')
    expect(own.meta.permissions).toContain('plan.activate')
  })

  test('a role holds catalogue permissions only and cannot take a base role name or an existing name', async () => {
    const body = { name: 'Unmasker', permissions: ['participant.unmask'] }
    const created = await call(app, { method: 'POST', url: '/v1/roles', as: admin, body, idempotencyKey: true })
    const duplicate = await call(app, { method: 'POST', url: '/v1/roles', as: admin, body, idempotencyKey: true })
    const clash = await call(app, { method: 'POST', url: '/v1/roles', as: admin, body: { name: 'tenant admin', permissions: [] }, idempotencyKey: true })
    const unknown = await call(app, { method: 'POST', url: '/v1/roles', as: admin, body: { name: 'X', permissions: ['everything'] }, idempotencyKey: true })

    expect(created.json().data).toMatchObject({ mfa_required: true, privileged: false })
    expect(duplicate.json().error.code).toBe('ROLE_NAME_TAKEN')
    expect(clash.json().error.code).toBe('ROLE_NAME_TAKEN')
    expect(unknown.statusCode).toBe(400)
  })

  test('a custom role with privileged permissions requires MFA and counts as privileged', async () => {
    const response = await call(app, { method: 'POST', url: '/v1/roles', as: admin, body: { name: 'Mapper', permissions: ['mapping.approve'] }, idempotencyKey: true })

    expect(response.json().data).toMatchObject({ mfa_required: true, privileged: true })
  })

  test('both need user.manage', async () => {
    expect((await call(app, { method: 'GET', url: '/v1/roles', as: analyst })).statusCode).toBe(403)
    expect((await call(app, { method: 'POST', url: '/v1/roles', as: analyst, body: { name: 'Y', permissions: [] }, idempotencyKey: true })).statusCode).toBe(403)
  })
})

describe('POST /v1/users/:id/role-assignments', () => {
  test('an ordinary role is granted at once and is effective on the next request', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })

    const response = await grant(admin, user.id, { role_id: await baseRoleId('Executive read-only') })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.assignment).toMatchObject({ user_id: user.id, approval_id: null })
    expect(await permissionsOf(user)).toEqual(['compliance.read'])
    expect(await auditActions(acme.id)).toContain('ROLE.GRANTED')
  })

  test('market scope must name markets of the own tenant', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })
    const own = await createMarket(acme.id, 'GB')
    const foreign = await createMarket(globexAdmin.tenantId!, 'FR')
    const roleId = await baseRoleId('Commission analyst')

    const scoped = await grant(admin, user.id, { role_id: roleId, market_ids: [own] })
    const refused = await grant(admin, user.id, { role_id: roleId, market_ids: [foreign] })

    expect(scoped.json().data.assignment.market_ids).toEqual([own])
    expect(refused.json().error.code).toBe('MARKET_UNKNOWN')
  })

  test('SEC-26: a market-scoped admin grants alone only within their own markets', async () => {
    const gb = await createMarket(acme.id, 'GX')
    const fr = await createMarket(acme.id, 'FX')
    const scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [gb] })
    const user = await createSignedInUser({ tenantId: acme.id })
    const roleId = await baseRoleId('Implementation consultant')

    const allMarkets = await grant(scopedAdmin, user.id, { role_id: roleId })
    const otherMarket = await grant(scopedAdmin, user.id, { role_id: roleId, market_ids: [fr] })
    const ownMarket = await grant(scopedAdmin, user.id, { role_id: roleId, market_ids: [gb] })

    expect(allMarkets.statusCode).toBe(202) // would widen import.manage to every market
    expect(otherMarket.statusCode).toBe(202)
    expect(ownMarket.statusCode).toBe(201)
    expect((await call(app, { method: 'GET', url: '/v1/me', as: user })).json().data.roles).toMatchObject([{ market_ids: [gb] }])
  })

  test('a time-boxed admin grants alone only until their own grant ends, and never to themselves', async () => {
    const adminEnds = new Date(Date.now() + 86_400_000)
    const timeBoxed = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], validTo: adminEnds })
    const user = await createSignedInUser({ tenantId: acme.id })
    const roleId = await baseRoleId('Implementation consultant')
    const until = (offsetMs: number) => ({ role_id: roleId, valid_to: new Date(adminEnds.getTime() + offsetMs).toISOString() })

    const openEnded = await grant(timeBoxed, user.id, { role_id: roleId })
    const outlasting = await grant(timeBoxed, user.id, until(60_000))
    const atEnd = await grant(timeBoxed, user.id, until(0))
    const self = await grant(timeBoxed, timeBoxed.id, until(-60_000))
    const selfByOpenEndedAdmin = await grant(admin, admin.id, { role_id: roleId })

    expect([openEnded, outlasting, atEnd, self, selfByOpenEndedAdmin].map((response) => response.statusCode))
      .toEqual([202, 202, 201, 202, 202])
    expect(atEnd.json().data.assignment.valid_to).toBe(adminEnds.toISOString())
  })

  test('valid_to must be in the future (400, not a database error)', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })

    const ordinary = await grant(admin, user.id, { role_id: await baseRoleId('Executive read-only'), valid_to: '2020-01-01T00:00:00Z' })
    const privileged = await grant(admin, user.id, { role_id: await baseRoleId('Tenant admin'), valid_to: '2020-01-01T00:00:00Z' })

    expect(ordinary.json().error.code).toBe('VALIDATION_FAILED')
    expect(privileged.json().error.code).toBe('VALIDATION_FAILED')
  })

  test('BR-SEC-05: a role with permissions the granter lacks waits for a second admin', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })

    const requested = await grant(admin, user.id, { role_id: await baseRoleId('Payout officer') })
    const before = await permissionsOf(user)
    const approved = await decide(approver, requested.json().data.request.id, 'approved')

    expect(requested.statusCode).toBe(202)
    expect(before).toEqual([])
    expect(approved.statusCode).toBe(200)
    expect(await permissionsOf(user)).toEqual(['participant.unmask'])
  })

  test('another tenant: its users are 404 and its roles are unknown', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })
    const [globexRole] = await ownerRows<{ id: string }>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, 'Globex only', '{}', false, false) RETURNING id`,
      [globexAdmin.tenantId],
    )

    const foreignUser = await grant(globexAdmin, user.id, { role_id: await baseRoleId('Commission analyst') })
    const foreignRole = await grant(admin, user.id, { role_id: globexRole!.id })

    expect(foreignUser.statusCode).toBe(404)
    expect(foreignRole.json().error.code).toBe('ROLE_UNKNOWN')
  })

  test('needs user.manage', async () => {
    expect((await grant(analyst, analyst.id, { role_id: await baseRoleId('Commission analyst') })).statusCode).toBe(403)
  })
})

describe('AC-36.1: privileged grants need a second admin', () => {
  test('a Tenant admin grant waits for another admin, who approves with a fresh factor', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })

    const requested = await grant(admin, user.id, { role_id: await baseRoleId('Tenant admin') })
    const requestId: string = requested.json().data.request.id
    const before = await permissionsOf(user)
    const self = await decide(admin, requestId, 'approved')
    const approved = await decide(approver, requestId, 'approved', 'new team lead')
    const after = await permissionsOf(user)
    const [approval] = await ownerRows<{ preparer_id: string; approver_id: string; factor: boolean }>(
      'SELECT preparer_id, approver_id, factor_verified_at IS NOT NULL AS factor FROM approval WHERE object_id = $1',
      [requestId],
    )
    const alerts = await ownerRows('SELECT payload FROM outbox_event WHERE topic = $1 AND tenant_id = $2', ['iam.admin.granted', acme.id])

    expect(requested.statusCode).toBe(202)
    expect(requested.json().data.request.state).toBe('pending')
    expect(before).toEqual([])
    expect(self.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.assignment.approval_id).toBe(approved.json().data.request.approval_id)
    expect(after).toContain('user.manage')
    expect(approval).toEqual({ preparer_id: admin.id, approver_id: approver.id, factor: true })
    expect(alerts).toHaveLength(1)
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['ROLE_GRANT.REQUESTED', 'ROLE_GRANT.APPROVED']))
  })

  test('the decision needs a fresh second factor (STEP_UP_REQUIRED) and happens once', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })
    const requestId: string = (await grant(admin, user.id, { role_id: await baseRoleId('Compliance officer') })).json().data.request.id
    const stale = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
    await ownerRows(`UPDATE session SET step_up_at = now() - interval '11 minutes' WHERE id = $1`, [stale.sessionId])

    const refused = await decide(stale, requestId, 'approved')
    const rejected = await decide(approver, requestId, 'rejected', 'not needed')
    const again = await decide(approver, requestId, 'approved')

    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(rejected.json().data).toMatchObject({ request: { state: 'rejected' }, assignment: null })
    expect(again.json().error.code).toBe('REQUEST_ALREADY_DECIDED')
    expect(await permissionsOf(user)).toEqual([])
  })

  test('a request whose end date has passed cannot be approved (422 GRANT_EXPIRED) but can be rejected', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })
    const [stale] = await ownerRows<{ id: string }>(
      `INSERT INTO role_grant_request (tenant_id, user_id, role_id, valid_to, requested_by, state, created_at)
       VALUES ($1, $2, $3, now() - interval '1 hour', $4, 'pending', now() - interval '2 hours') RETURNING id`,
      [acme.id, user.id, await baseRoleId('Compliance officer'), admin.id],
    )

    const approved = await decide(approver, stale!.id, 'approved')
    const rejected = await decide(approver, stale!.id, 'rejected', 'expired')

    expect(approved.statusCode).toBe(422)
    expect(approved.json().error.code).toBe('GRANT_EXPIRED')
    expect(rejected.json().data.request.state).toBe('rejected')
    expect(await permissionsOf(user)).toEqual([])
  })

  test('the grantee cannot approve their own grant', async () => {
    const candidate = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
    const requestId: string = (await grant(admin, candidate.id, { role_id: await baseRoleId('Compliance officer') })).json().data.request.id

    expect((await decide(candidate, requestId, 'approved')).json().error.code).toBe('SOD_SELF_APPROVAL')
  })

  test('requests are listed per tenant; another tenant cannot decide them; analysts cannot list them', async () => {
    const user = await createSignedInUser({ tenantId: acme.id })
    const requestId: string = (await grant(admin, user.id, { role_id: await baseRoleId('Tenant admin') })).json().data.request.id

    const pending = await call(app, { method: 'GET', url: '/v1/role-grant-requests?state=pending', as: admin })
    const foreignList = await call(app, { method: 'GET', url: '/v1/role-grant-requests', as: globexAdmin })
    const foreignDecision = await decide(globexAdmin, requestId, 'approved')
    const denied = await call(app, { method: 'GET', url: '/v1/role-grant-requests', as: analyst })

    expect(pending.json().data.map((row: { id: string }) => row.id)).toContain(requestId)
    expect(foreignList.json().data).toEqual([])
    expect(foreignDecision.statusCode).toBe(404)
    expect(denied.statusCode).toBe(403)
  })

  test('deciding needs user.manage', async () => {
    const steppedUpAnalyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], stepUp: true })
    const user = await createSignedInUser({ tenantId: acme.id })
    const requestId: string = (await grant(admin, user.id, { role_id: await baseRoleId('Tenant admin') })).json().data.request.id

    expect((await decide(steppedUpAnalyst, requestId, 'approved')).statusCode).toBe(403)
  })
})

describe('POST /v1/role-assignments/:id/revoke', () => {
  test('ends the assignment now; the permission is gone on the next request', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, roles: ['Executive read-only'] })
    const assignmentId: string = (await call(app, { method: 'GET', url: '/v1/me', as: user })).json().data.roles[0].assignment_id

    const revoked = await call(app, { method: 'POST', url: `/v1/role-assignments/${assignmentId}/revoke`, as: admin })
    const again = await call(app, { method: 'POST', url: `/v1/role-assignments/${assignmentId}/revoke`, as: admin })

    expect(revoked.statusCode).toBe(200)
    expect(await permissionsOf(user)).toEqual([])
    expect(again.statusCode).toBe(404)
    expect(await auditActions(acme.id)).toContain('ROLE.REVOKED')
  })

  test('FR-IAM-003 under concurrency: of three admins, two revoking each other\'s admin grant at once leave two', async () => {
    const trio = await createTenant()
    const first = await createSignedInUser({ tenantId: trio.id, roles: ['Tenant admin'], stepUp: true })
    const second = await createSignedInUser({ tenantId: trio.id, roles: ['Tenant admin'], stepUp: true })
    await createSignedInUser({ tenantId: trio.id, roles: ['Tenant admin'] })
    const grantOf = async (as: TestUser) => (await call(app, { method: 'GET', url: '/v1/me', as })).json().data.roles[0].assignment_id as string
    const [firstGrant, secondGrant] = [await grantOf(first), await grantOf(second)]

    const responses = await Promise.all([
      call(app, { method: 'POST', url: `/v1/role-assignments/${secondGrant}/revoke`, as: first }),
      call(app, { method: 'POST', url: `/v1/role-assignments/${firstGrant}/revoke`, as: second }),
    ])
    const live = await ownerRows(
      `SELECT 1 FROM role_assignment WHERE tenant_id = $1 AND (valid_to IS NULL OR valid_to > now())`, [trio.id],
    )

    // The loser gets 422 SECOND_ADMIN_REQUIRED, or 403 when its own grant was already gone as its session resolved.
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1)
    expect(live).toHaveLength(2)
  })

  test('BUG-014: the second-last admin grant cannot be revoked, so privileged grants keep a possible approver', async () => {
    const pair = await createTenant()
    const first = await createSignedInUser({ tenantId: pair.id, roles: ['Tenant admin'], stepUp: true })
    const second = await createSignedInUser({ tenantId: pair.id, roles: ['Tenant admin'], stepUp: true })
    const reader = await createSignedInUser({ tenantId: pair.id, roles: ['Executive read-only'] })
    const grantOf = async (as: TestUser) => (await call(app, { method: 'GET', url: '/v1/me', as })).json().data.roles[0].assignment_id as string
    const revoke = async (as: TestUser, of: TestUser) => call(app, { method: 'POST', url: `/v1/role-assignments/${await grantOf(of)}/revoke`, as })

    const refused = await revoke(first, second)
    const readerRevoked = await revoke(first, reader)
    const requested = await grant(first, reader.id, { role_id: await baseRoleId('Tenant admin') })
    const approved = await decide(second, requested.json().data.request.id, 'approved')
    const afterThird = await revoke(first, second)

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('SECOND_ADMIN_REQUIRED')
    expect(readerRevoked.statusCode).toBe(200)
    expect(approved.statusCode).toBe(200)
    expect(afterThird.statusCode).toBe(200)
  })

  test('the last admin grant cannot be revoked; another tenant gets 404; analysts get 403', async () => {
    const solo = await createTenant()
    const soloAdmin = await createSignedInUser({ tenantId: solo.id, roles: ['Tenant admin'], stepUp: true })
    const assignmentId: string = (await call(app, { method: 'GET', url: '/v1/me', as: soloAdmin })).json().data.roles[0].assignment_id

    expect((await call(app, { method: 'POST', url: `/v1/role-assignments/${assignmentId}/revoke`, as: soloAdmin })).json().error.code).toBe('LAST_ADMIN')
    expect((await call(app, { method: 'POST', url: `/v1/role-assignments/${assignmentId}/revoke`, as: admin })).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/role-assignments/${assignmentId}/revoke`, as: analyst })).statusCode).toBe(403)
  })

  test('BUG-007: ending a privileged assignment needs a fresh second factor, ending another one does not', async () => {
    const unstepped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
    const officer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
    const reader = await createSignedInUser({ tenantId: acme.id, roles: ['Executive read-only'] })
    const grantOf = async (as: TestUser) => (await call(app, { method: 'GET', url: '/v1/me', as })).json().data.roles[0].assignment_id as string
    const revoke = (as: TestUser, assignmentId: string) => call(app, { method: 'POST', url: `/v1/role-assignments/${assignmentId}/revoke`, as })

    const privileged = await revoke(unstepped, await grantOf(officer))
    const plain = await revoke(unstepped, await grantOf(reader))
    const stepped = await revoke(admin, await grantOf(officer))

    expect(privileged.json().error.code).toBe('STEP_UP_REQUIRED')
    expect([plain.statusCode, stepped.statusCode]).toEqual([200, 200])
  })
})

describe('BUG-006, BUG-010: the second admin approves within their own admin markets and validity', () => {
  const requestFor = async (role: 'Tenant admin' | 'Finance approver' | 'Payout officer', marketIds: string[] | null) => {
    const user = await createSignedInUser({ tenantId: acme.id })
    return (await grant(admin, user.id, { role_id: await baseRoleId(role), market_ids: marketIds })).json().data.request.id as string
  }

  test('an approver scoped to one market approves grants over that market only; a time-boxed approver no open-ended admin', async () => {
    const de = await createMarket(acme.id, 'DE')
    const nl = await createMarket(acme.id, 'NL')
    const scoped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [de], stepUp: true })
    const boxed = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], validTo: new Date(Date.now() + 86_400_000), stepUp: true })

    const refused = [
      await decide(scoped, await requestFor('Tenant admin', [nl]), 'approved'),
      await decide(scoped, await requestFor('Tenant admin', [de, nl]), 'approved'),
      await decide(scoped, await requestFor('Payout officer', null), 'approved'),
      await decide(boxed, await requestFor('Tenant admin', null), 'approved'),
    ]
    const rejected = await decide(scoped, await requestFor('Tenant admin', null), 'rejected', 'out of my markets')
    const own = await decide(scoped, await requestFor('Tenant admin', [de]), 'approved')
    const nonPrivileged = await decide(scoped, await requestFor('Payout officer', [de]), 'approved')

    expect(refused.map((response) => response.json().error.code)).toEqual(Array(4).fill('SCOPE_NOT_HELD'))
    expect(rejected.json().data.request.state).toBe('rejected')
    expect(own.json().data.assignment.market_ids).toEqual([de])
    expect(nonPrivileged.json().data.assignment.market_ids).toEqual([de])
  })

  test('BUG-010: a Tenant admin approves Compliance officer and Finance approver grants without holding their permissions', async () => {
    const grantee = await createSignedInUser({ tenantId: acme.id })
    const requested = await grant(admin, grantee.id, { role_id: await baseRoleId('Compliance officer') })
    const officer = await decide(approver, requested.json().data.request.id, 'approved')
    const finance = await decide(approver, await requestFor('Finance approver', null), 'approved')

    expect(requested.statusCode).toBe(202)
    expect([officer.statusCode, finance.statusCode]).toEqual([200, 200])
    expect(officer.json().data.assignment.approval_id).toBe(officer.json().data.request.approval_id)
    expect(await permissionsOf(grantee)).toEqual(expect.arrayContaining(['snapshot.create', 'export', 'mapping.approve']))
  })
})

describe('roles are tenant-wide: creating one needs user.manage for all markets', () => {
  test('a Tenant admin limited to one market cannot add a role to the catalogue', async () => {
    const gb = await createMarket(acme.id, 'RG')
    const scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [gb] })
    const body = { name: 'Scoped Auditor', permissions: ['audit.read'] }

    const created = await call(app, { method: 'POST', url: '/v1/roles', as: scopedAdmin, body, idempotencyKey: true })

    expect(created.statusCode).toBe(403)
    expect(created.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'user.manage' } })
    expect(await ownerRows('SELECT 1 FROM role WHERE tenant_id = $1 AND name = $2', [acme.id, body.name])).toHaveLength(0)
  })
})
