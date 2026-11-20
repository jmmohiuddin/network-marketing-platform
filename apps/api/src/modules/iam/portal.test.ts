// FR-IAM-007 distributor sign-in (PLAN B5 D-B5-02..06): T-B5-01 portal accounts, T-B5-02 password sign-in and realm
// separation, T-B5-03 one-time codes, T-B5-04 lockout keys, T-B5-05 re-authentication, T-B5-06 terminated participants.
import type { FastifyInstance } from 'fastify'
import { getOwnerPool } from '@nmp/db/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant,
  invitationToken, mailsTo, ownerRows, resetApiDb, runQueuedJobs, sessionFrom, type Caller, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { hashPassword } from '../../lib/passwords.js'
import { sendInvitationJob } from './invitations.js'
import { portalMember } from './portal-test-support.js'
import {
  sendSignInCodeJob, SIGN_IN_CODE_COOLDOWN_SECONDS, SIGN_IN_CODE_MAX_ATTEMPTS, SIGN_IN_CODES_PER_DAY,
} from './sign-in-codes.js'

const PASSWORD = 'correct horse battery staple'
const INVALID = { code: 'INVALID_CREDENTIALS', message: 'The email or password is not correct.' }
const CODE_INVALID = { code: 'INVALID_CREDENTIALS', message: 'The code is not valid or has expired. Request a new code.' }

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let de: string
let fr: string
let support: TestUser
let passwordHash: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  ;[acme, globex] = [await createTenant(), await createTenant()]
  ;[de, fr] = [await createMarket(acme.id, 'DE'), await createMarket(acme.id, 'FR')]
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  passwordHash = await hashPassword(PASSWORD)
  app = await buildTestApp({ env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '1000' } })
})

afterAll(async () => {
  await app.close()
})

const invite = (participantId: string, as: TestUser = support) =>
  call(app, { method: 'POST', url: `/v1/participants/${participantId}/portal-account`, as, idempotencyKey: true })
const portalSignIn = (body: Record<string, unknown>) => call(app, { method: 'POST', url: '/v1/auth/portal-sessions', body })
const requestCode = (email: string, tenant = acme.slug) =>
  call(app, { method: 'POST', url: '/v1/auth/portal-codes', body: { tenant, email } })

/** An active portal account with a password, of a new member of DE. */
async function signedUpMember(options: Parameters<typeof portalMember>[2] = {}) {
  const member = await portalMember(acme.id, de, options)
  const user = await createPortalUser({ tenantId: acme.id, participantId: member.id, email: member.email!, passwordHash })
  return { member, user }
}

const refusal = (r: { statusCode: number; json(): { error: { code: string; message: string } } }) =>
  [r.statusCode, { code: r.json().error.code, message: r.json().error.message }]

// Moves a code past the guard that allows one more check at a time (fixture time travel, triggers off).
async function setCode(userId: string, set: string): Promise<void> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    await client.query(`UPDATE portal_sign_in_code SET ${set} WHERE user_id = $1 AND used_at IS NULL`, [userId])
    await client.query('COMMIT')
  } finally {
    client.release()
  }
}

const latestCode = async (email: string) => {
  const mails = await mailsTo(email)
  return /sign-in code is (\d{6})/.exec(mails.at(-1) ?? '')![1]!
}

describe('portal accounts on participants (T-B5-01, AC-IAM7-1)', () => {
  test('invite: an invited portal account with the contact email, a portal invitation mail, accepted into an active account', async () => {
    const member = await portalMember(acme.id, de)

    const response = await invite(member.id)
    await runQueuedJobs(sendInvitationJob)
    const [mail] = await mailsTo(member.email!)
    const accepted = await call(app, {
      method: 'POST', url: '/v1/auth/invitations/accept', body: { token: invitationToken(mail!), password: PASSWORD },
    })
    const status = await call(app, { method: 'GET', url: `/v1/participants/${member.id}/portal-account`, as: support })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toEqual({ state: 'invited' })
    expect(mail).toContain(`invitation?tenant=${acme.slug}&realm=portal#token=`)
    expect(accepted.statusCode).toBe(204)
    expect(status.json().data).toMatchObject({ state: 'active', email_masked: 'm•••@e•••.test', mfa_enrolled: false })
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['PORTAL_ACCOUNT.INVITED', 'USER.ACTIVATED']))
  })

  test('BUG-112: the mail states the expiry as a readable time in the tenant\'s first market zone, named, not an ISO instant', async () => {
    const member = await portalMember(acme.id, de)
    await invite(member.id)
    await runQueuedJobs(sendInvitationJob)
    const [mail] = await mailsTo(member.email!)
    const [invitation] = await ownerRows<{ expires_at: Date }>(
      'SELECT i.expires_at FROM user_invitation i JOIN user_account u ON u.id = i.user_id WHERE u.email = $1', [member.email])
    const readable = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(invitation!.expires_at)

    expect(mail).toContain(`It works once, until ${readable} (Europe/London):`)
    expect(mail).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  test('a second invitation is 409 PORTAL_ACCOUNT_EXISTS; another member with the same email is 409 PORTAL_EMAIL_IN_USE', async () => {
    const first = await portalMember(acme.id, de)
    const sharing = await portalMember(acme.id, de, { email: first.email })
    await invite(first.id)

    const again = await invite(first.id)
    const shared = await invite(sharing.id)

    expect(again.json().error.code).toBe('PORTAL_ACCOUNT_EXISTS')
    expect(shared.statusCode).toBe(409)
    expect(shared.json().error).toMatchObject({ code: 'PORTAL_EMAIL_IN_USE', message: "Another member's portal account uses this email." })
  })

  test('not eligible: a retail customer (not_can_earn) and a member without a contact email', async () => {
    const retail = await portalMember(acme.id, de, { canEarn: false })
    const noEmail = await portalMember(acme.id, de, { email: null })

    const answers = [await invite(retail.id), await invite(noEmail.id)]

    expect(answers.map((r) => [r.statusCode, r.json().error.code, r.json().error.details.reason])).toEqual([
      [422, 'PORTAL_NOT_ELIGIBLE', 'not_can_earn'], [422, 'PORTAL_NOT_ELIGIBLE', 'no_contact_email'],
    ])
  })

  test('scope and permission: a DE-scoped agent gets 404 for an FR member, an analyst 403, another tenant 404', async () => {
    const frMember = await portalMember(acme.id, fr)
    const deAgent = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [de] })
    const analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
    const outsider = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })

    const answers = [await invite(frMember.id, deAgent), await invite(frMember.id, analyst), await invite(frMember.id, outsider)]
    const read = await call(app, { method: 'GET', url: `/v1/participants/${frMember.id}/portal-account`, as: deAgent })

    expect(answers.map((r) => r.statusCode)).toEqual([404, 403, 404])
    expect(read.statusCode).toBe(404)
  })

  test('staff user routes never show a portal account and cannot grant it a role; the database refuses a direct grant', async () => {
    const { user } = await signedUpMember()
    const admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
    const [role] = await ownerRows<{ id: string }>(`SELECT id FROM role WHERE name = 'Support agent' AND is_base`)

    const list = await call(app, { method: 'GET', url: '/v1/users?limit=50', as: admin })
    const detail = await call(app, { method: 'GET', url: `/v1/users/${user.id}`, as: admin })
    const grant = await call(app, {
      method: 'POST', url: `/v1/users/${user.id}/role-assignments`, as: admin, idempotencyKey: true, body: { role_id: role!.id },
    })
    const direct = await ownerRows('INSERT INTO role_assignment (tenant_id, user_id, role_id, valid_from) VALUES ($1, $2, $3, now())', [
      acme.id, user.id, role!.id,
    ]).then(() => null, (error: { code?: string }) => error.code)

    expect(list.json().data.map((u: { id: string }) => u.id)).not.toContain(user.id)
    expect(detail.statusCode).toBe(404)
    expect(grant.statusCode).toBe(404)
    expect(direct).toBe('42501')
  })

  test('re-send needs an invited account (409 PORTAL_ACCOUNT_ACTIVE); deactivate closes the account and its sessions', async () => {
    const { member, user } = await signedUpMember()

    const resend = await call(app, { method: 'POST', url: `/v1/participants/${member.id}/portal-account/invitation`, as: support })
    const deactivated = await call(app, {
      method: 'POST', url: `/v1/participants/${member.id}/portal-account/deactivate`, as: support, body: { reason: 'Left the business' },
    })
    const me = await call(app, { method: 'GET', url: '/v1/me', as: user })
    const reinvited = await invite(member.id)

    expect(resend.json().error.code).toBe('PORTAL_ACCOUNT_ACTIVE')
    expect(deactivated.json().data.state).toBe('deactivated')
    expect(me.statusCode).toBe(401)
    expect(reinvited.statusCode).toBe(201) // a new row: a deactivated account is never reopened
  })
})

describe('portal password sign-in (T-B5-02, AC-IAM7-2/4)', () => {
  test('opens a portal session; /v1/me is the portal shape without roles or permissions', async () => {
    const { member, user } = await signedUpMember()

    const response = await portalSignIn({ tenant: acme.slug, email: user.email, password: PASSWORD })
    const me = await call(app, { method: 'GET', url: '/v1/me', as: sessionFrom(response) })
    const [session] = await ownerRows<{ realm: string }>('SELECT realm FROM session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id])

    expect(response.statusCode).toBe(201)
    expect(response.json().data.next_step).toBe('none')
    expect(session!.realm).toBe('portal')
    expect(me.json().data).toMatchObject({
      realm: 'portal', roles: [], permissions: [], terminated: false, mfa: { required: false, enrolled: false },
      participant: { participant_id: member.id, external_ref: member.ref },
    })
    expect(me.json().data.navigation.map((n: { key: string }) => n.key)).toEqual(['home', 'earnings', 'rank', 'customers', 'more'])
  })

  test('an MFA-enrolled portal user is asked for the second factor', async () => {
    const member = await portalMember(acme.id, de)
    const user = await createPortalUser({ tenantId: acme.id, participantId: member.id, passwordHash, mfa: 'unverified' })

    const response = await portalSignIn({ tenant: acme.slug, email: user.email, password: PASSWORD })

    expect(response.json().data.next_step).toBe('mfa_verification')
  })

  test('while MFA is pending /v1/me returns no participant data', async () => {
    const member = await portalMember(acme.id, de)
    const user = await createPortalUser({ tenantId: acme.id, participantId: member.id, passwordHash, mfa: 'unverified' })

    const me = await call(app, { method: 'GET', url: '/v1/me', as: user })

    expect(me.statusCode).toBe(200)
    expect(me.json().data).toMatchObject({ realm: 'portal', participant: null, positions: [], navigation: [], mfa: { enrolled: true, verified: false } })
    expect(me.json().data).not.toHaveProperty('terminated')
    expect(JSON.stringify(me.json().data)).not.toContain(member.ref)
  })

  test('realms stay apart: portal credentials at the staff route and staff credentials at the portal route are 401', async () => {
    const { user } = await signedUpMember()
    const staff = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], passwordHash })

    const atStaff = await call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: acme.slug, email: user.email, password: PASSWORD } })
    const atPortal = await portalSignIn({ tenant: acme.slug, email: staff.email, password: PASSWORD })

    expect([atStaff.statusCode, atPortal.statusCode]).toEqual([401, 401])
    expect(atPortal.json().error).toMatchObject(INVALID)
  })

  test('a staff route refuses a portal session (403 REALM_FORBIDDEN)', async () => {
    const { user } = await signedUpMember()

    const response = await call(app, { method: 'GET', url: '/v1/participants', as: user })

    expect(response.statusCode).toBe(403)
  })

  test('deactivated account, merged or pseudonymised member, wrong password: the same 401', async () => {
    const deactivated = await signedUpMember()
    await ownerRows(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [deactivated.user.id])
    const merged = await signedUpMember()
    const target = await portalMember(acme.id, de)
    await ownerRows(`UPDATE participant SET status = 'merged', merged_into_id = $2 WHERE id = $1`, [merged.member.id, target.id])
    const erased = await signedUpMember()
    await ownerRows('UPDATE participant SET display_name = NULL, contact = NULL, pseudonymised_at = now() WHERE id = $1', [erased.member.id])
    const wrong = await signedUpMember()

    const answers = await Promise.all([
      portalSignIn({ tenant: acme.slug, email: deactivated.user.email, password: PASSWORD }),
      portalSignIn({ tenant: acme.slug, email: merged.user.email, password: PASSWORD }),
      portalSignIn({ tenant: acme.slug, email: erased.user.email, password: PASSWORD }),
      portalSignIn({ tenant: acme.slug, email: wrong.user.email, password: 'not the password' }),
      portalSignIn({ tenant: acme.slug, email: 'nobody@example.test', password: PASSWORD }),
    ])

    expect(answers.map(refusal)).toEqual(Array(5).fill([401, INVALID]))
  })
})

describe('one-time sign-in codes (T-B5-03, AC-IAM7-3)', () => {
  test('202 for known and unknown emails alike; a mail and a hashed code only for a real portal account', async () => {
    const { user } = await signedUpMember()

    const known = await requestCode(user.email)
    const unknown = await requestCode('nobody@example.test')
    const queued = await runQueuedJobs(sendSignInCodeJob)
    const [code] = await ownerRows<{ code_hash: Buffer }>('SELECT code_hash FROM portal_sign_in_code WHERE user_id = $1', [user.id])

    expect([known.statusCode, unknown.statusCode]).toEqual([202, 202])
    expect(known.json()).toEqual(unknown.json())
    expect(queued).toBe(1)
    expect(await mailsTo(user.email)).toHaveLength(1)
    expect(code!.code_hash.toString()).not.toContain(await latestCode(user.email))
    expect(await auditActions(acme.id)).toContain('AUTH.SIGN_IN_CODE_SENT')
  })

  test('a code signs in once; a used, wrong or unknown-account code is the same 401', async () => {
    const { user } = await signedUpMember()
    await requestCode(user.email)
    await runQueuedJobs(sendSignInCodeJob)
    const code = await latestCode(user.email)
    const wrongCode = code === '000000' ? '000001' : '000000'

    const wrong = await portalSignIn({ tenant: acme.slug, email: user.email, code: wrongCode })
    const first = await portalSignIn({ tenant: acme.slug, email: user.email, code })
    const reused = await portalSignIn({ tenant: acme.slug, email: user.email, code })
    const unknown = await portalSignIn({ tenant: acme.slug, email: 'nobody@example.test', code })

    expect(first.statusCode).toBe(201)
    expect([wrong, reused, unknown].map(refusal)).toEqual(Array(3).fill([401, CODE_INVALID]))
  })

  test('a new code replaces the old one; an expired code and a code after its last check are refused', async () => {
    const { user } = await signedUpMember()
    await requestCode(user.email)
    await runQueuedJobs(sendSignInCodeJob)
    const old = await latestCode(user.email)
    await setCode(user.id, `created_at = now() - interval '${SIGN_IN_CODE_COOLDOWN_SECONDS + 1} seconds'`)
    await requestCode(user.email)
    await runQueuedJobs(sendSignInCodeJob)
    const current = await latestCode(user.email)

    const replaced = old === current ? null : await portalSignIn({ tenant: acme.slug, email: user.email, code: old })
    await setCode(user.id, `attempts = ${SIGN_IN_CODE_MAX_ATTEMPTS}`)
    const exhausted = await portalSignIn({ tenant: acme.slug, email: user.email, code: current })
    await setCode(user.id, `attempts = 0, created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute'`)
    const expired = await portalSignIn({ tenant: acme.slug, email: user.email, code: current })

    expect(replaced?.statusCode ?? 401).toBe(401)
    expect([exhausted.statusCode, expired.statusCode]).toEqual([401, 401])
  })

  test('per account: no new code within the cooldown (the open code keeps working) and none past the daily cap', async () => {
    const { user } = await signedUpMember()
    await requestCode(user.email)
    await requestCode(user.email)
    await runQueuedJobs(sendSignInCodeJob)
    const [cooled] = await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM portal_sign_in_code WHERE user_id = $1', [user.id])
    const mailsInCooldown = (await mailsTo(user.email)).length
    const signIn = await portalSignIn({ tenant: acme.slug, email: user.email, code: await latestCode(user.email) })
    await ownerRows(
      `INSERT INTO portal_sign_in_code (tenant_id, user_id, code_hash, expires_at, created_at)
       SELECT $1, $2, sha256(n::text::bytea), now() - interval '1 hour', now() - interval '2 hours'
       FROM generate_series(1, $3::int) n`, [acme.id, user.id, SIGN_IN_CODES_PER_DAY])
    await requestCode(user.email)
    await runQueuedJobs(sendSignInCodeJob)

    expect(cooled!.n).toBe(1)
    expect(mailsInCooldown).toBe(1)
    expect(signIn.statusCode).toBe(201)
    expect(await mailsTo(user.email)).toHaveLength(1)
  })
})

describe('lockout (T-B5-04, AC-IAM7-3)', () => {
  test('the portal key locks (429) while a staff account with the same email still signs in', async () => {
    const { user } = await signedUpMember()
    await createSignedInUser({ tenantId: acme.id, email: user.email, roles: ['Commission analyst'], mfa: 'none', passwordHash })

    for (let i = 0; i < 5; i++) await portalSignIn({ tenant: acme.slug, email: user.email, password: 'wrong password' })
    const locked = await portalSignIn({ tenant: acme.slug, email: user.email, password: PASSWORD })
    const staff = await call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: acme.slug, email: user.email, password: PASSWORD } })

    expect(locked.json().error.code).toBe('SIGN_IN_LOCKED')
    expect(staff.statusCode).toBe(201)
  })

  test('portal-code requests count in their own rate-limit bucket: they cannot rate-limit a staff sign-in', async () => {
    const strict = await buildTestApp({ env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '3' } })
    const staff = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], mfa: 'none', passwordHash })
    try {
      const codes: number[] = []
      for (let n = 1; n <= 3; n += 1) {
        codes.push((await call(strict, { method: 'POST', url: '/v1/auth/portal-codes', body: { tenant: acme.slug, email: staff.email }, remoteAddress: `10.7.0.${n}` })).statusCode)
      }
      const signIn = await call(strict, {
        method: 'POST', url: '/v1/auth/sessions', body: { tenant: acme.slug, email: staff.email, password: PASSWORD }, remoteAddress: '10.7.0.9',
      })

      expect(codes).toEqual([202, 202, 202])
      expect(signIn.statusCode).toBe(201)
    } finally {
      await strict.close()
    }
  })
})

describe('re-authentication (T-B5-05, D-B5-04)', () => {
  const reauth = (as: Caller, password: string) =>
    call(app, { method: 'POST', url: '/v1/auth/sessions/current/reauth', as, body: { password } })

  test('a wrong password is 401 and counts; the right one sets step_up_at; a staff session is 403', async () => {
    const { user } = await signedUpMember()
    const staff = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })

    const wrong = await reauth(user, 'not the password')
    const right = await reauth(user, PASSWORD)
    const [session] = await ownerRows<{ step_up_at: Date | null }>('SELECT step_up_at FROM session WHERE id = $1', [user.sessionId])
    const [attempt] = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM login_attempt WHERE account_key = $1 AND NOT succeeded`, [`portal:${acme.slug}:${user.email}`])

    expect(wrong.statusCode).toBe(401)
    expect(right.statusCode).toBe(200)
    expect(session!.step_up_at).not.toBeNull()
    expect(attempt!.n).toBeGreaterThanOrEqual(1)
    expect((await reauth(staff, PASSWORD)).json().error.code).toBe('REALM_FORBIDDEN')
    expect(await auditActions(acme.id)).toContain('AUTH.REAUTHENTICATED')
  })

  test('a mailed-code session cannot enrol an authenticator app (whose confirmation is a step-up) without the password', async () => {
    const { user } = await signedUpMember()
    await requestCode(user.email)
    await runQueuedJobs(sendSignInCodeJob)
    const viaCode = sessionFrom(await portalSignIn({ tenant: acme.slug, email: user.email, code: await latestCode(user.email) }))
    const enrol = () => call(app, { method: 'POST', url: '/v1/auth/mfa/totp', as: viaCode })

    const refused = await enrol()
    const [stored] = await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM mfa_credential WHERE user_id = $1', [user.id])
    const reauthed = await reauth(viaCode, PASSWORD)
    const started = await enrol()

    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(stored!.n).toBe(0)
    expect(reauthed.statusCode).toBe(200)
    expect(started.statusCode).toBe(201)
  })
})

describe('terminated participants (T-B5-06, AC-IAM7-5)', () => {
  test('sign in and see terminated: true', async () => {
    const { user } = await signedUpMember({ position: 'terminated' })

    const response = await portalSignIn({ tenant: acme.slug, email: user.email, password: PASSWORD })
    const me = await call(app, { method: 'GET', url: '/v1/me', as: sessionFrom(response) })

    expect(response.statusCode).toBe(201)
    expect(me.json().data.terminated).toBe(true)
  })
})
