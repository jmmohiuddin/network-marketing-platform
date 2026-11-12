import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, invitationToken, mailsTo, ownerRows,
  resetApiDb, runQueuedJobs, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { sendInvitationJob } from './invitations.js'

const PASSWORD = 'a long enough password'

let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let otherAdmin: TestUser
let globexAdmin: TestUser
let analyst: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  otherAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const invite = (as: TestUser, email: string, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: '/v1/users', as, body: { email, display_name: 'New Person' }, idempotencyKey })
const accept = (token: string, password = PASSWORD) =>
  call(app, { method: 'POST', url: '/v1/auth/invitations/accept', body: { token, password } })

// Delivers queued invitation mails (the worker's job) and returns the newest token mailed to the address.
async function deliveredToken(email: string): Promise<string> {
  await runQueuedJobs(sendInvitationJob)
  const mails = await mailsTo(email)
  return invitationToken(mails.at(-1)!)
}

describe('GET /v1/users', () => {
  test('lists the tenant users in email order with their roles, page by page', async () => {
    const first = await call(app, { method: 'GET', url: '/v1/users?limit=2', as: admin })
    const second = await call(app, { method: 'GET', url: `/v1/users?limit=2&cursor=${first.json().meta.next_cursor}`, as: admin })
    const emails = [...first.json().data, ...second.json().data].map((user: { email: string }) => user.email)

    expect(first.json().data).toHaveLength(2)
    expect(emails).toEqual([...emails].sort())
    expect(emails).not.toContain(globexAdmin.email)
    const all = (await call(app, { method: 'GET', url: '/v1/users?limit=200', as: admin })).json().data
    expect(all.find((user: { id: string }) => user.id === admin.id).roles).toMatchObject([{ name: 'Tenant admin' }])
  })

  test('needs user.manage', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/users', as: analyst })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PERMISSION_DENIED')
  })
})

describe('GET /v1/users/:id', () => {
  test('reads a user of the own tenant; another tenant gets 404, not 403', async () => {
    const own = await call(app, { method: 'GET', url: `/v1/users/${analyst.id}`, as: admin })
    const foreign = await call(app, { method: 'GET', url: `/v1/users/${analyst.id}`, as: globexAdmin })

    expect(own.json().data).toMatchObject({ id: analyst.id, state: 'active', roles: [{ name: 'Commission analyst' }] })
    expect(foreign.statusCode).toBe(404)
  })

  test('needs user.manage', async () => {
    expect((await call(app, { method: 'GET', url: `/v1/users/${admin.id}`, as: analyst })).statusCode).toBe(403)
  })
})

describe('POST /v1/users (invite) and POST /v1/auth/invitations/accept', () => {
  test('the one-time link is mailed to the invitee only; they set a password and sign in', async () => {
    const invited = await invite(admin, 'New.Person@Example.test', 'invite-1')
    const replay = await invite(admin, 'New.Person@Example.test', 'invite-1')
    const token = await deliveredToken('new.person@example.test')
    const [mail] = await mailsTo('new.person@example.test')
    const [stored] = await ownerRows<{ created_by: string }>(
      'SELECT created_by FROM user_invitation WHERE user_id = $1', [invited.json().data.user.id],
    )
    const weak = await accept(token, 'short')
    const accepted = await accept(token)
    const reused = await accept(token)
    const signIn = await call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: acme.slug, email: 'new.person@example.test', password: PASSWORD } })

    expect(invited.statusCode).toBe(201)
    expect(invited.json().data).toEqual({ user: expect.objectContaining({ email: 'new.person@example.test', state: 'invited', roles: [] }) })
    expect(JSON.stringify(invited.json())).not.toContain(token) // the inviting admin never sees the token
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json()).toEqual(invited.json())
    expect(mail).toContain(`/invitation?tenant=${acme.slug}#token=${token}`)
    expect(stored).toEqual({ created_by: admin.id }) // the inviter is recorded
    expect(weak.statusCode).toBe(400)
    expect(accepted.statusCode).toBe(204)
    expect(reused.json().error.code).toBe('INVITATION_INVALID')
    expect(signIn.statusCode).toBe(201)
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['USER.INVITED', 'USER.INVITATION_SENT', 'USER.ACTIVATED']))
  })

  test('a user deactivated before the mail goes out gets no invitation', async () => {
    const invited = (await invite(admin, 'gone@example.test')).json().data.user
    await call(app, { method: 'POST', url: `/v1/users/${invited.id}/deactivate`, as: admin })

    await runQueuedJobs(sendInvitationJob)

    expect(await mailsTo('gone@example.test')).toEqual([])
    expect(await ownerRows('SELECT 1 FROM user_invitation WHERE user_id = $1', [invited.id])).toEqual([])
  })

  test('the same email twice in a tenant is 409; another tenant may use it', async () => {
    await invite(admin, 'dup@example.test')

    expect((await invite(admin, 'dup@example.test')).json().error.code).toBe('EMAIL_TAKEN')
    expect((await invite(globexAdmin, 'dup@example.test')).statusCode).toBe(201)
  })

  test('needs an Idempotency-Key and user.manage', async () => {
    const noKey = await call(app, { method: 'POST', url: '/v1/users', as: admin, body: { email: 'k@example.test' } })

    expect(noKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect((await invite(analyst, 'x@example.test')).statusCode).toBe(403)
  })
})

describe('POST /v1/users/:id/invitation', () => {
  test('a new link is mailed to the invitee and replaces the old one; the admin gets neither', async () => {
    const invited = (await invite(admin, 'again@example.test')).json().data
    const firstToken = await deliveredToken('again@example.test')
    const reissued = await call(app, { method: 'POST', url: `/v1/users/${invited.user.id}/invitation`, as: admin, idempotencyKey: true })
    const secondToken = await deliveredToken('again@example.test')
    const oldLink = await accept(firstToken)
    const newLink = await accept(secondToken)

    expect(reissued.statusCode).toBe(202)
    expect(reissued.json().data.user).toMatchObject({ id: invited.user.id, state: 'invited' })
    expect(JSON.stringify(reissued.json())).not.toContain(secondToken)
    expect(secondToken).not.toBe(firstToken)
    expect(oldLink.statusCode).toBe(422)
    expect(newLink.statusCode).toBe(204)
  })

  test('active users have nothing to re-issue; another tenant gets 404; analysts get 403', async () => {
    const active = await call(app, { method: 'POST', url: `/v1/users/${analyst.id}/invitation`, as: admin, idempotencyKey: true })
    const foreign = await call(app, { method: 'POST', url: `/v1/users/${analyst.id}/invitation`, as: globexAdmin, idempotencyKey: true })
    const denied = await call(app, { method: 'POST', url: `/v1/users/${analyst.id}/invitation`, as: analyst, idempotencyKey: true })

    expect(active.json().error.code).toBe('USER_NOT_INVITED')
    expect(foreign.statusCode).toBe(404)
    expect(denied.statusCode).toBe(403)
  })
})

describe('POST /v1/users/:id/deactivate', () => {
  test('deactivates, revokes sessions and audits; repeating it changes nothing', async () => {
    const leaver = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })

    const response = await call(app, { method: 'POST', url: `/v1/users/${leaver.id}/deactivate`, as: admin })
    const again = await call(app, { method: 'POST', url: `/v1/users/${leaver.id}/deactivate`, as: admin })
    const leaverCall = await call(app, { method: 'GET', url: '/v1/me', as: leaver })
    const sessions = await ownerRows('SELECT 1 FROM session WHERE user_id = $1 AND revoked_at IS NULL', [leaver.id])

    expect(response.json().data.state).toBe('deactivated')
    expect(again.statusCode).toBe(200)
    expect(leaverCall.statusCode).toBe(401)
    expect(sessions).toEqual([])
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'USER.DEACTIVATED' AND object_id = $1`, [leaver.id])).toHaveLength(1)
  })

  test('FR-IAM-003 under concurrency: of three admins, two deactivating each other at once leave two admins', async () => {
    const trio = await createTenant()
    const [first, second] = [
      await createSignedInUser({ tenantId: trio.id, roles: ['Tenant admin'], stepUp: true }),
      await createSignedInUser({ tenantId: trio.id, roles: ['Tenant admin'], stepUp: true }),
      await createSignedInUser({ tenantId: trio.id, roles: ['Tenant admin'] }),
    ]

    const responses = await Promise.all([
      call(app, { method: 'POST', url: `/v1/users/${second.id}/deactivate`, as: first }),
      call(app, { method: 'POST', url: `/v1/users/${first.id}/deactivate`, as: second }),
    ])
    const active = await ownerRows(`SELECT 1 FROM user_account WHERE tenant_id = $1 AND state = 'active'`, [trio.id])

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1)
    expect(active).toHaveLength(2)
  })

  test('BUG-014: the second-last admin cannot be deactivated (422 SECOND_ADMIN_REQUIRED)', async () => {
    const pair = await createTenant()
    const first = await createSignedInUser({ tenantId: pair.id, roles: ['Tenant admin'], stepUp: true })
    const second = await createSignedInUser({ tenantId: pair.id, roles: ['Tenant admin'], stepUp: true })

    const response = await call(app, { method: 'POST', url: `/v1/users/${second.id}/deactivate`, as: first })
    const [stored] = await ownerRows<{ state: string }>('SELECT state FROM user_account WHERE id = $1', [second.id])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('SECOND_ADMIN_REQUIRED')
    expect(stored).toEqual({ state: 'active' })
  })

  test('the last admin cannot be deactivated', async () => {
    const solo = await createTenant()
    const soloAdmin = await createSignedInUser({ tenantId: solo.id, roles: ['Tenant admin'], stepUp: true })

    const response = await call(app, { method: 'POST', url: `/v1/users/${soloAdmin.id}/deactivate`, as: soloAdmin })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('LAST_ADMIN')
  })

  test('BUG-007: deactivating a user who holds a privileged role needs a fresh second factor', async () => {
    const officer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
    const stepped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })

    const refused = await call(app, { method: 'POST', url: `/v1/users/${officer.id}/deactivate`, as: admin })
    const done = await call(app, { method: 'POST', url: `/v1/users/${officer.id}/deactivate`, as: stepped })

    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(done.json().data.state).toBe('deactivated')
  })

  test('another tenant gets 404; analysts get 403', async () => {
    expect((await call(app, { method: 'POST', url: `/v1/users/${otherAdmin.id}/deactivate`, as: globexAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: `/v1/users/${otherAdmin.id}/deactivate`, as: analyst })).statusCode).toBe(403)
  })
})

describe('POST /v1/auth/invitations/accept', () => {
  test('an unknown token is refused without detail', async () => {
    const response = await call(app, { method: 'POST', url: '/v1/auth/invitations/accept', body: { token: 'nope', password: PASSWORD } })

    expect(response.json().error.code).toBe('INVITATION_INVALID')
  })
})
