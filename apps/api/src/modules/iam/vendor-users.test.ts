import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { authenticator } from 'otplib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, invitationToken, mailsTo, ownerRows, resetApiDb,
  sessionFrom, type TestUser,
} from '../../../test/helpers/index.js'
import { audModule } from '../aud/index.js'
import { opsModule } from '../ops/index.js'
import { prvModule } from '../prv/index.js'
import { tenModule } from '../ten/index.js'
import { iamModule } from './index.js'

const PASSWORD = 'correct horse battery staple'

let app: FastifyInstance
let operator: TestUser
let secondOperator: TestUser
let unconfirmed: TestUser
let tenantAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  operator = await createSignedInUser({ tenantId: null, stepUp: true })
  secondOperator = await createSignedInUser({ tenantId: null, stepUp: true })
  unconfirmed = await createSignedInUser({ tenantId: null })
  tenantAdmin = await createSignedInUser({ tenantId: (await createTenant()).id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, tenModule, prvModule, opsModule, audModule] })
})

afterAll(async () => {
  await app.close()
})

const newEmail = () => `ops-${randomUUID().slice(0, 8)}@vendor.test`
const invite = (body: Record<string, unknown>, as: TestUser = operator, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: '/v1/vendor-users', as, body, idempotencyKey })
// BUG-031: an invitation is mailed only once a second, independent vendor user approves it.
const approveInvitation = (userId: string, as: TestUser = secondOperator) =>
  call(app, { method: 'POST', url: `/v1/vendor-users/${userId}/approve`, as, idempotencyKey: true })
const vendorLog = async (objectId: string) =>
  (await ownerRows<{ action: string; actor_id: string }>('SELECT action, actor_id FROM audit.vendor_event WHERE object_id = $1 ORDER BY seq', [objectId]))

function tenantBody() {
  const suffix = randomUUID().slice(0, 8)
  return {
    legal_name: 'Initech Ltd', slug: `initech-${suffix}`, region: 'eu', isolation_tier: 'pooled', dpa_document_id: randomUUID(),
    markets: [{ code: 'GB', currency: 'GBP', minor_unit: 2, time_zone: 'Europe/London', languages: ['en'], market_pack: 'none' }],
    first_admin: { email: `admin-${suffix}@initech.test`, display_name: null },
  }
}

describe('BUG-011: vendor users invite vendor users, so two-person provisioning completes in the product', () => {
  test('an invited vendor user accepts, enrols MFA and approves the tenant its inviter created', async () => {
    const email = newEmail()

    const invited = await invite({ email, display_name: 'Second Operator' })
    await approveInvitation(invited.json().data.user.id)
    const [mail] = await mailsTo(email)
    const accepted = await call(app, { method: 'POST', url: '/v1/auth/invitations/accept', body: { token: invitationToken(mail!), password: PASSWORD } })
    const signedIn = await call(app, { method: 'POST', url: '/v1/auth/vendor-sessions', body: { email, password: PASSWORD } })
    const started = await call(app, { method: 'POST', url: '/v1/auth/mfa/totp', as: sessionFrom(signedIn) })
    const confirmed = await call(app, {
      method: 'POST', url: '/v1/auth/mfa/totp/confirm', as: sessionFrom(signedIn), body: { code: authenticator.generate(started.json().data.secret) },
    })
    const tenant = (await call(app, { method: 'POST', url: '/v1/tenants', as: operator, body: tenantBody(), idempotencyKey: true })).json().data
    // BUG-031: not a tenant of its inviter or its approver, but one created by an unrelated vendor user.
    const unrelated = await createSignedInUser({ tenantId: null, stepUp: true })
    const otherTenant = (await call(app, { method: 'POST', url: '/v1/tenants', as: unrelated, body: tenantBody(), idempotencyKey: true })).json().data
    const approved = await call(app, { method: 'POST', url: `/v1/tenants/${otherTenant.id}/approve`, as: sessionFrom(confirmed), idempotencyKey: true })
    const ownInviters = await call(app, { method: 'POST', url: `/v1/tenants/${tenant.id}/approve`, as: sessionFrom(confirmed), idempotencyKey: true })
    const userId: string = invited.json().data.user.id

    expect(invited.statusCode).toBe(201)
    expect(invited.json().data.user).toMatchObject({
      email, display_name: 'Second Operator', state: 'invited', created_by: operator.id, invitation_status: 'pending_approval',
    })
    expect(mail).toContain(`/invitation?realm=vendor#token=${invitationToken(mail!)}`)
    expect(accepted.statusCode).toBe(204)
    expect(signedIn.json().data.next_step).toBe('mfa_enrolment')
    expect(confirmed.statusCode).toBe(200)
    expect(approved.json().data.state).toBe('implementation')
    expect(ownInviters.json().error.code).toBe('APPROVER_NOT_INDEPENDENT')
    expect((await vendorLog(userId)).map((event) => event.action).slice(0, 4)).toEqual([
      'USER.INVITED', 'USER.INVITATION_APPROVED', 'USER.INVITATION_SENT', 'USER.ACTIVATED',
    ])
    expect(await ownerRows('SELECT 1 FROM audit.audit_event WHERE object_id = $1', [userId])).toEqual([])
  })

  test('replays the same request, refuses another under its key, needs the key, a fresh factor and a new email', async () => {
    const email = newEmail()
    const key = randomUUID()

    const first = await invite({ email }, operator, key)
    const again = await invite({ email }, operator, key)
    const other = await invite({ email: newEmail() }, operator, key)
    const withoutKey = await call(app, { method: 'POST', url: '/v1/vendor-users', as: operator, body: { email: newEmail() } })
    const withoutStepUp = await invite({ email: newEmail() }, unconfirmed)
    const taken = await invite({ email: email.toUpperCase() })

    expect(again.statusCode).toBe(201)
    expect(again.headers['idempotent-replayed']).toBe('true')
    expect(again.json().data.user.id).toBe(first.json().data.user.id)
    expect(await mailsTo(email)).toEqual([]) // BUG-031: pending until a second vendor user approves
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(withoutKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(withoutStepUp.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(taken.json().error.code).toBe('EMAIL_TAKEN')
  })

  test('lists vendor users only; re-invites an invited user only; tenant users are refused', async () => {
    const email = newEmail()
    const userId: string = (await invite({ email })).json().data.user.id
    const beforeApproval = await call(app, { method: 'POST', url: `/v1/vendor-users/${userId}/invitation`, as: operator })
    await approveInvitation(userId)

    const list = await call(app, { method: 'GET', url: '/v1/vendor-users?limit=200', as: operator })
    const reissued = await call(app, { method: 'POST', url: `/v1/vendor-users/${userId}/invitation`, as: operator })
    const active = await call(app, { method: 'POST', url: `/v1/vendor-users/${operator.id}/invitation`, as: operator })
    const tenantUser = await call(app, { method: 'POST', url: `/v1/vendor-users/${tenantAdmin.id}/invitation`, as: operator })
    const fromTenant = await call(app, { method: 'GET', url: '/v1/vendor-users', as: tenantAdmin })
    const emails = list.json().data.map((user: { email: string }) => user.email)

    expect(emails).toEqual(expect.arrayContaining([email, operator.email]))
    expect(emails).not.toContain(tenantAdmin.email)
    expect(beforeApproval.json().error.code).toBe('INVITATION_NOT_APPROVED')
    expect(reissued.statusCode).toBe(202)
    expect(await mailsTo(email)).toHaveLength(2)
    expect(active.json().error.code).toBe('USER_NOT_INVITED')
    expect(tenantUser.statusCode).toBe(404)
    expect(fromTenant.json().error.code).toBe('REALM_FORBIDDEN')
  })

  test('deactivation needs a fresh factor, ends the user\'s sessions and leaves at least one vendor user', async () => {
    const leaver = await createSignedInUser({ tenantId: null })

    const withoutStepUp = await call(app, { method: 'POST', url: `/v1/vendor-users/${leaver.id}/deactivate`, as: unconfirmed })
    const done = await call(app, { method: 'POST', url: `/v1/vendor-users/${leaver.id}/deactivate`, as: operator })
    const leaverCall = await call(app, { method: 'GET', url: '/v1/me', as: leaver })
    const others = await ownerRows<{ id: string }>(`SELECT id FROM user_account WHERE realm = 'vendor' AND state = 'active' AND id <> $1`, [operator.id])
    await ownerRows(`UPDATE user_account SET state = 'deactivated' WHERE id = ANY ($1)`, [others.map((row) => row.id)])
    const last = await call(app, { method: 'POST', url: `/v1/vendor-users/${operator.id}/deactivate`, as: operator })

    expect(withoutStepUp.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(done.json().data.state).toBe('deactivated')
    expect(leaverCall.statusCode).toBe(401)
    expect(last.json().error.code).toBe('LAST_VENDOR_USER')
    expect((await vendorLog(leaver.id)).map((event) => event.action)).toEqual(['USER.DEACTIVATED'])
  })
})

describe('BUG-012: GET /v1/vendor-audit-events (the vendor log, FR-OPS-001)', () => {
  test('vendor users read the vendor log newest first, filtered and paged; tenant users are refused', async () => {
    const email = newEmail()
    const userId: string = (await invite({ email })).json().data.user.id

    const filtered = await call(app, { method: 'GET', url: `/v1/vendor-audit-events?object_id=${userId}`, as: operator })
    const page = await call(app, { method: 'GET', url: '/v1/vendor-audit-events?limit=1', as: operator })
    const next = await call(app, { method: 'GET', url: `/v1/vendor-audit-events?limit=1&cursor=${page.json().meta.next_cursor}`, as: operator })
    const fromTenant = await call(app, { method: 'GET', url: '/v1/vendor-audit-events', as: tenantAdmin })

    expect(filtered.json().data.map((event: { action: string }) => event.action)).toEqual(['USER.INVITED'])
    expect(filtered.json().data[0]).toMatchObject({ actor_type: 'vendor_user', actor_id: operator.id, object_type: 'user_account' })
    expect(Number(next.json().data[0].seq)).toBeLessThan(Number(page.json().data[0].seq))
    expect(fromTenant.json().error.code).toBe('REALM_FORBIDDEN')
  })
})
