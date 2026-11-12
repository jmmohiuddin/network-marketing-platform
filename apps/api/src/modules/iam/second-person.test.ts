import { randomUUID } from 'node:crypto'
import { getPool } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { authenticator } from 'otplib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, invitationToken, mailsTo, ownerRows, resetApiDb,
  sessionFrom, signInExisting, type TestUser,
} from '../../../test/helpers/index.js'
import { opsModule } from '../ops/index.js'
import { prvModule } from '../prv/index.js'
import { tenModule } from '../ten/index.js'
import { iamModule } from './index.js'

// BUG-031: two-person control for vendor users. A invites, an independent vendor user approves; nobody approves the
// action of someone they invited, were invited by, approved or were approved by.

const PASSWORD = 'correct horse battery staple'

let app: FastifyInstance
// Bootstrap users (seed / CLI): no inviter, independent of each other.
let rootA: TestUser
let rootB: TestUser
let rootE: TestUser
// Invited by A, approved by B; D likewise: C and D are independent of each other.
let userC: TestUser
let userD: TestUser
// Sock-puppet chain: A invites X1 (B approves), X1 invites X2 (E approves). X2 is tied to A through X1.
let chainX1: TestUser
let chainX2: TestUser
let unconfirmed: TestUser

closePoolsAfterAll()

const newEmail = () => `ops-${randomUUID().slice(0, 8)}@vendor.test`
// idempotencyKey null = send none.
const post = (url: string, as: TestUser, body?: Record<string, unknown>, idempotencyKey: true | string | null = true) =>
  call(app, { method: 'POST', url, as, ...(body === undefined ? {} : { body }), ...(idempotencyKey === null ? {} : { idempotencyKey }) })
const invite = (as: TestUser, email = newEmail()) => post('/v1/vendor-users', as, { email })
const decide = (userId: string, decision: 'approve' | 'reject', as: TestUser, key: true | string = true) =>
  post(`/v1/vendor-users/${userId}/${decision}`, as, undefined, key)
const vendorLog = async (objectId: string) =>
  ownerRows<{ action: string; actor_id: string; after: Record<string, unknown> | null }>(
    `SELECT action, actor_id, (after_ref::jsonb)->'after' AS after FROM audit.vendor_event WHERE object_id = $1 ORDER BY seq`, [objectId],
  )
const code = (response: { json(): { error?: { code: string } } }) => response.json().error?.code

/** A vendor user invited by `inviter` and approved by `approver` through the API, then active and signed in. */
async function invitedUser(inviter: TestUser, approver: TestUser): Promise<TestUser> {
  const email = newEmail()
  const id: string = (await invite(inviter, email)).json().data.user.id
  expect((await decide(id, 'approve', approver)).statusCode).toBe(200)
  await ownerRows(`UPDATE user_account SET state = 'active' WHERE id = $1`, [id])
  return signInExisting({ id, tenantId: null, email })
}

function tenantBody() {
  const suffix = randomUUID().slice(0, 8)
  return {
    legal_name: 'Initech Ltd', slug: `initech-${suffix}`, region: 'eu', isolation_tier: 'pooled', dpa_document_id: randomUUID(),
    markets: [{ code: 'GB', currency: 'GBP', minor_unit: 2, time_zone: 'Europe/London', languages: ['en'], market_pack: 'none' }],
    first_admin: { email: `admin-${suffix}@initech.test`, display_name: null },
  }
}

async function tenantBy(creator: TestUser): Promise<string> {
  const response = await post('/v1/tenants', creator, tenantBody())
  expect(response.statusCode).toBe(201)
  return response.json().data.id
}

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [iamModule, tenModule, prvModule, opsModule] })
  rootA = await createSignedInUser({ tenantId: null, stepUp: true })
  rootB = await createSignedInUser({ tenantId: null, stepUp: true })
  rootE = await createSignedInUser({ tenantId: null, stepUp: true })
  unconfirmed = await createSignedInUser({ tenantId: null })
  userC = await invitedUser(rootA, rootB)
  userD = await invitedUser(rootA, rootB)
  chainX1 = await invitedUser(rootA, rootB)
  chainX2 = await invitedUser(chainX1, rootE)
})

afterAll(async () => {
  await app.close()
})

describe('BUG-031: one person cannot become the second vendor user', () => {
  test('operator invites operator-alt, accepts, enrols MFA and approves their own provisioning request: refused', async () => {
    const altEmail = newEmail()
    const tenantId = await tenantBy(rootA)

    const invited = await invite(rootA, altEmail)
    const mailBeforeApproval = await mailsTo(altEmail)
    const altId: string = invited.json().data.user.id
    // Even if an independent colleague approves the invitation, operator-alt stays tied to its inviter.
    await decide(altId, 'approve', rootB)
    const [mail] = await mailsTo(altEmail)
    await call(app, { method: 'POST', url: '/v1/auth/invitations/accept', body: { token: invitationToken(mail!), password: PASSWORD } })
    const signedIn = await call(app, { method: 'POST', url: '/v1/auth/vendor-sessions', body: { email: altEmail, password: PASSWORD } })
    const started = await call(app, { method: 'POST', url: '/v1/auth/mfa/totp', as: sessionFrom(signedIn) })
    const confirmed = await call(app, {
      method: 'POST', url: '/v1/auth/mfa/totp/confirm', as: sessionFrom(signedIn), body: { code: authenticator.generate(started.json().data.secret) },
    })
    const approved = await call(app, { method: 'POST', url: `/v1/tenants/${tenantId}/approve`, as: sessionFrom(confirmed), idempotencyKey: true })

    expect(invited.json().data.user).toMatchObject({ state: 'invited', invitation_status: 'pending_approval' })
    expect(mailBeforeApproval).toEqual([])
    expect(approved.statusCode).toBe(403)
    expect(code(approved)).toBe('APPROVER_NOT_INDEPENDENT')
    expect(await ownerRows('SELECT state, approved_by FROM tenant WHERE id = $1', [tenantId])).toEqual([{ state: 'provisioning', approved_by: null }])
    expect((await vendorLog(tenantId)).map((event) => [event.action, event.after?.refusal ?? null])).toEqual([
      ['TENANT.CREATED', null], ['SECOND_PERSON.REFUSED', 'APPROVER_NOT_INDEPENDENT'],
    ])
  })
})

describe('vendor-user invitations need a second, independent vendor user', () => {
  test('a new invitation is pending: no invitation token, no mail, no re-send, and the inviter cannot approve it', async () => {
    const email = newEmail()
    const id: string = (await invite(rootA, email)).json().data.user.id

    const bySelf = await decide(id, 'approve', rootA)
    const rejectBySelf = await decide(id, 'reject', rootA)
    const withoutStepUp = await decide(id, 'approve', unconfirmed)
    const withoutKey = await post(`/v1/vendor-users/${id}/approve`, rootB, undefined, null)
    const resend = await post(`/v1/vendor-users/${id}/invitation`, rootA, undefined, null)

    expect(code(bySelf)).toBe('SOD_SELF_APPROVAL')
    expect(code(rejectBySelf)).toBe('SOD_SELF_APPROVAL')
    expect(code(withoutStepUp)).toBe('STEP_UP_REQUIRED')
    expect(code(withoutKey)).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(code(resend)).toBe('INVITATION_NOT_APPROVED')
    expect(await ownerRows('SELECT 1 FROM user_invitation WHERE user_id = $1', [id])).toEqual([])
    expect(await mailsTo(email)).toEqual([])
    expect((await vendorLog(id)).map((event) => event.action)).toEqual(['USER.INVITED', 'SECOND_PERSON.REFUSED', 'SECOND_PERSON.REFUSED'])
  })

  test('approval by an independent vendor user sends the invitation; replays; a second decision is refused', async () => {
    const email = newEmail()
    const id: string = (await invite(rootA, email)).json().data.user.id
    const key = randomUUID()

    const approved = await decide(id, 'approve', rootB, key)
    const replayed = await decide(id, 'approve', rootB, key)
    const again = await decide(id, 'reject', rootE)
    const resend = await post(`/v1/vendor-users/${id}/invitation`, rootA, undefined, null)

    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.user).toMatchObject({
      state: 'invited', invitation_status: 'approved', invitation_decided_by: rootB.id, created_by: rootA.id,
    })
    expect(replayed.headers['idempotent-replayed']).toBe('true')
    expect(code(again)).toBe('REQUEST_ALREADY_DECIDED')
    expect(resend.statusCode).toBe(202)
    expect(await mailsTo(email)).toHaveLength(2)
    expect((await vendorLog(id)).map((event) => [event.action, event.actor_id])).toEqual([
      ['USER.INVITED', rootA.id], ['USER.INVITATION_APPROVED', rootB.id], ['USER.INVITATION_SENT', rootB.id],
      ['USER.INVITATION_SENT', rootA.id],
    ])
  })

  test('rejection ends the invitation: the account is closed and can never be approved or activated', async () => {
    const email = newEmail()
    const id: string = (await invite(rootA, email)).json().data.user.id

    const rejected = await decide(id, 'reject', rootB)
    const approveLater = await decide(id, 'approve', rootE)

    expect(rejected.json().data.user).toMatchObject({ state: 'deactivated', invitation_status: 'rejected' })
    expect(code(approveLater)).toBe('REQUEST_ALREADY_DECIDED')
    expect(await mailsTo(email)).toEqual([])
    expect((await vendorLog(id)).map((event) => event.action)).toEqual(['USER.INVITED', 'USER.INVITATION_REJECTED'])
  })

  test('the approver may not be tied to the inviter: who invited them, whom they invited, who approved them', async () => {
    const byC = (await invite(userC)).json().data.user.id // C was invited by A and approved by B
    const byA = (await invite(rootA)).json().data.user.id

    const inviterOfInviter = await decide(byC, 'approve', rootA)
    const approverOfInviter = await decide(byC, 'approve', rootB)
    const invitedByInviter = await decide(byA, 'approve', userC)
    const independent = await decide(byC, 'approve', userD)

    expect([inviterOfInviter, approverOfInviter, invitedByInviter].map(code)).toEqual(Array(3).fill('APPROVER_NOT_INDEPENDENT'))
    expect(inviterOfInviter.statusCode).toBe(403)
    expect(independent.statusCode).toBe(200)
  })
})

describe('tenant provisioning approval and go-live need an independent second vendor user', () => {
  test.each([
    ['the approver was invited by the initiator', (): [TestUser, TestUser] => [rootA, userC]],
    ['the approver invited the initiator', (): [TestUser, TestUser] => [userC, rootA]],
    ['the approver\'s account was approved by the initiator', (): [TestUser, TestUser] => [rootB, userC]],
    ['the approver approved the initiator\'s account', (): [TestUser, TestUser] => [userC, rootB]],
  ] as const)('provisioning approval is refused when %s', async (_case, people) => {
    const [initiator, approver] = people()
    const tenantId = await tenantBy(initiator)

    const response = await post(`/v1/tenants/${tenantId}/approve`, approver)

    expect(response.statusCode).toBe(403)
    expect(code(response)).toBe('APPROVER_NOT_INDEPENDENT')
    expect((await vendorLog(tenantId)).at(-1)).toMatchObject({
      action: 'SECOND_PERSON.REFUSED', actor_id: approver.id,
      after: { action: 'TENANT.PROVISIONING_APPROVED', initiator_id: initiator.id, refusal: 'APPROVER_NOT_INDEPENDENT' },
    })
  })

  test('provisioning approval by an independent vendor user succeeds (C and D share an inviter and an approver only)', async () => {
    const tenantId = await tenantBy(userC)

    const response = await post(`/v1/tenants/${tenantId}/approve`, userD)

    expect(response.json().data.state).toBe('implementation')
  })

  test('go-live is a second-person step: not the creator, not someone tied to the creator; an independent user may', async () => {
    const tenantId = await tenantBy(userC)
    await post(`/v1/tenants/${tenantId}/approve`, userD)
    const admin = await createSignedInUser({ tenantId, roles: ['Tenant admin'], stepUp: true })
    await call(app, {
      method: 'PUT', url: '/v1/settings/privacy.breach_contacts', as: admin, headers: { 'if-match': '"0"' },
      body: { value: [{ name: 'Dana Privacy', role: 'DPO', email: 'dpo@initech.test', phone: '+44 20 7946 0000' }], reason: 'Runbook' },
    })
    const goLive = (as: TestUser) => post(`/v1/tenants/${tenantId}/go-live`, as, undefined, null)

    const withoutStepUp = await goLive(unconfirmed)
    const byCreator = await goLive(userC)
    const byInviter = await goLive(rootA)
    const live = await goLive(userD)

    expect(code(withoutStepUp)).toBe('STEP_UP_REQUIRED')
    expect(code(byCreator)).toBe('SOD_SELF_APPROVAL')
    expect(code(byInviter)).toBe('APPROVER_NOT_INDEPENDENT')
    expect(live.json().data.state).toBe('live')
    expect(await ownerRows('SELECT went_live_by FROM tenant WHERE id = $1', [tenantId])).toEqual([{ went_live_by: userD.id }])
  })
})

describe('independence follows the whole invitation line (review of BUG-031: chain A -> X1 -> X2)', () => {
  test('X2 cannot approve A\'s tenant, take it live, or approve A\'s invitation; nor A X2\'s', async () => {
    const provisioning = await tenantBy(rootA)
    const implementation = await tenantBy(rootA)
    await post(`/v1/tenants/${implementation}/approve`, rootB)
    const byA = (await invite(rootA)).json().data.user.id
    const byX2 = (await invite(chainX2)).json().data.user.id

    const approval = await post(`/v1/tenants/${provisioning}/approve`, chainX2)
    const goLive = await post(`/v1/tenants/${implementation}/go-live`, chainX2, undefined, null)
    const invitationOfA = await decide(byA, 'approve', chainX2)
    const invitationOfX2 = await decide(byX2, 'approve', rootA)
    // B approved X1, an inviter-ancestor of X2: tied as well.
    const approverOfAncestor = await decide(byX2, 'approve', rootB)

    expect([approval, goLive, invitationOfA, invitationOfX2, approverOfAncestor].map(code))
      .toEqual(Array(5).fill('APPROVER_NOT_INDEPENDENT'))
    expect(await ownerRows('SELECT state FROM tenant WHERE id = ANY($1) ORDER BY state', [[provisioning, implementation]]))
      .toEqual([{ state: 'implementation' }, { state: 'provisioning' }])
  })

  test('a vendor user outside the line stays a valid second person (D for X2: same root inviter only)', async () => {
    const tenantId = await tenantBy(chainX2)

    const response = await post(`/v1/tenants/${tenantId}/approve`, userD)

    expect(response.json().data.state).toBe('implementation')
  })
})

describe('invitation decisions: Idempotency-Key and closed addresses (review of BUG-031)', () => {
  test('a key used to approve cannot replay as a reject: 422, and the invitation stays approved', async () => {
    const id: string = (await invite(rootA)).json().data.user.id
    const key = randomUUID()

    const approved = await decide(id, 'approve', rootB, key)
    const rejectSameKey = await decide(id, 'reject', rootB, key)

    expect(approved.statusCode).toBe(200)
    expect(rejectSameKey.statusCode).toBe(422)
    expect(code(rejectSameKey)).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await ownerRows('SELECT invitation_decision FROM user_account WHERE id = $1', [id])).toEqual([{ invitation_decision: 'approved' }])
  })

  test('a rejected address can be invited again: the new invitation is approved, accepted and signs in', async () => {
    const email = newEmail()
    const rejectedId: string = (await invite(rootA, email)).json().data.user.id
    await decide(rejectedId, 'reject', rootB)

    const again = await invite(rootA, email)
    const takenWhileOpen = await invite(rootE, email)
    const againId: string = again.json().data.user.id
    await decide(againId, 'approve', rootB)
    const [mail] = await mailsTo(email)
    const accepted = await call(app, { method: 'POST', url: '/v1/auth/invitations/accept', body: { token: invitationToken(mail!), password: PASSWORD } })
    const signedIn = await call(app, { method: 'POST', url: '/v1/auth/vendor-sessions', body: { email, password: PASSWORD } })

    expect(again.statusCode).toBe(201)
    expect(againId).not.toBe(rejectedId)
    expect(code(takenWhileOpen)).toBe('EMAIL_TAKEN')
    expect(accepted.statusCode).toBeLessThan(300)
    expect(signedIn.statusCode).toBe(201) // the open account, not the closed one with the same address
    expect(await ownerRows('SELECT id, state FROM user_account WHERE email = $1 ORDER BY created_at', [email]))
      .toEqual([{ id: rejectedId, state: 'deactivated' }, { id: againId, state: 'active' }])
  })
})

describe('the database refuses what the API refuses (nmp_app with the API bypassed)', () => {
  // A vendor-realm transaction as the API opens it: nmp_app, app.realm vendor, app.user_id the acting vendor user.
  async function asVendor(userId: string, sql: string, params: unknown[]): Promise<unknown> {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `SELECT set_config('app.realm', 'vendor', true), set_config('app.user_id', $1, true), set_config('app.actor_type', 'vendor_user', true)`,
        [userId],
      )
      await client.query(sql, params)
      await client.query('COMMIT')
      return 'committed'
    } catch (error) {
      await client.query('ROLLBACK')
      return (error as { code?: string }).code
    } finally {
      client.release()
    }
  }

  const DECIDE = `UPDATE user_account SET invitation_decision = 'approved', invitation_decided_by = $2, invitation_decided_at = now()
                  WHERE id = $1`

  test('a pending vendor user cannot be activated, given a token, or approved by its inviter or someone tied to it', async () => {
    const pending: string = (await invite(userC)).json().data.user.id

    const activate = await asVendor(rootE.id, `UPDATE user_account SET state = 'active' WHERE id = $1`, [pending])
    const token = await asVendor(rootE.id,
      `INSERT INTO user_invitation (tenant_id, user_id, token_hash, expires_at, created_by)
       VALUES (NULL, $1, sha256(gen_random_bytes(16)), now() + interval '1 hour', $2)`, [pending, rootE.id])
    const byInviter = await asVendor(userC.id, DECIDE, [pending, userC.id])
    const byLinked = await asVendor(rootA.id, DECIDE, [pending, rootA.id])
    const forged = await asVendor(rootE.id, DECIDE, [pending, userD.id]) // someone else's name on the approval

    expect([activate, token, byInviter, byLinked, forged]).toEqual(['23514', '42501', '42501', '42501', '42501'])
  })

  test('a vendor user cannot create a bootstrap (inviter-less) or pre-approved vendor user', async () => {
    const insert = `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state, created_by)
                    VALUES (NULL, 'vendor', $1, $2, $3, $4)`

    const bootstrap = await asVendor(rootE.id, insert, [randomUUID(), newEmail(), 'active', null])
    const active = await asVendor(rootE.id, insert, [randomUUID(), newEmail(), 'active', rootE.id])

    expect([bootstrap, active]).toEqual(['42501', '42501'])
  })

  test('tenant approval and go-live rows refuse a linked or forged second person', async () => {
    const provisioning = await tenantBy(userC)
    const implementation = await tenantBy(userC)
    await post(`/v1/tenants/${implementation}/approve`, userD)
    const approve = `UPDATE tenant SET approved_by = $2, state = 'implementation' WHERE id = $1`

    const linked = await asVendor(rootA.id, approve, [provisioning, rootA.id])
    const forged = await asVendor(rootE.id, approve, [provisioning, userD.id])
    const unapproved = await asVendor(rootE.id, `UPDATE tenant SET state = 'implementation' WHERE id = $1`, [provisioning])
    const liveLinked = await asVendor(rootB.id, `UPDATE tenant SET went_live_by = $2, state = 'live' WHERE id = $1`, [implementation, rootB.id])
    const liveUnnamed = await asVendor(rootE.id, `UPDATE tenant SET state = 'live' WHERE id = $1`, [implementation])

    expect([linked, forged, unapproved, liveLinked, liveUnnamed]).toEqual(['42501', '42501', '42501', '42501', '42501'])
  })

  test('the creator cannot null or re-point created_by to approve their own tenant (review of BUG-031, a and c)', async () => {
    const tenantId = await tenantBy(rootA)

    const nulled = await asVendor(rootA.id, `UPDATE tenant SET created_by = NULL, approved_by = $2, state = 'implementation' WHERE id = $1`,
      [tenantId, rootA.id])
    const repointed = await asVendor(rootA.id, `UPDATE tenant SET created_by = $3, approved_by = $2, state = 'implementation' WHERE id = $1`,
      [tenantId, rootA.id, rootB.id])
    const chain = await asVendor(chainX2.id, `UPDATE tenant SET approved_by = $2, state = 'implementation' WHERE id = $1`, [tenantId, chainX2.id])

    expect([nulled, repointed, chain]).toEqual(['42501', '42501', '42501'])
    expect(await ownerRows('SELECT state, created_by FROM tenant WHERE id = $1', [tenantId])).toEqual([{ state: 'provisioning', created_by: rootA.id }])
  })

  test('a vendor user inserts tenants only in provisioning, in its own name, with no second person (review of BUG-031, b)', async () => {
    const insert = (state: string, createdBy: string | null, wentLiveBy: string | null = null) => asVendor(rootA.id,
      `INSERT INTO tenant (legal_name, slug, region, isolation_tier, db_route, state, created_by, went_live_by)
       VALUES ('RT', $1, 'eu', 'pooled', 'pooled', $2, $3, $4)`, [`rt-${randomUUID().slice(0, 8)}`, state, createdBy, wentLiveBy])

    const live = await insert('live', rootA.id)
    const preNamed = await insert('provisioning', rootA.id, rootB.id)
    const creatorless = await insert('provisioning', null)
    const inAnotherName = await insert('provisioning', rootB.id)
    const ordinary = await insert('provisioning', rootA.id)

    expect([live, preNamed, creatorless, inAnotherName, ordinary]).toEqual(['42501', '42501', '42501', '42501', 'committed'])
  })

  test('tenant creation stays possible for the independence check without a creator (seeded tenants)', async () => {
    const tenant = await createTenant({ state: 'provisioning' })

    const result = await asVendor(rootE.id, `UPDATE tenant SET approved_by = $2, state = 'implementation' WHERE id = $1`, [tenant.id, rootE.id])

    expect(result).toBe('committed')
  })
})
