import type { FastifyInstance } from 'fastify'
import { authenticator } from 'otplib'
import { withTenant } from '@nmp/db'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { elevateSession } from '../../lib/session.js'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, sessionFrom,
  totpCode, type Caller, type TestTenant,
} from '../../../test/helpers/index.js'

let app: FastifyInstance
let tenant: TestTenant

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenant = await createTenant()
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const protectedRead = (as: Caller) => call(app, { method: 'GET', url: '/v1/settings/compliance.late_order_day', as })
// The user's live sessions: elevation at sign-in replaces the session (new row, new token), step-up keeps it.
const liveSessions = (userId: string) =>
  ownerRows<{ assurance_level: string; verified: boolean; stepped_up: boolean }>(
    `SELECT assurance_level, mfa_verified_at IS NOT NULL AS verified, step_up_at IS NOT NULL AS stepped_up
     FROM session WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  )

describe('AC-35.1 forced enrolment', () => {
  test('a Finance approver without a factor reaches nothing but me, MFA and sign-out', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'], mfa: 'none' })

    const blocked = await protectedRead(user)
    const me = await call(app, { method: 'GET', url: '/v1/me', as: user })

    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')
    expect(me.statusCode).toBe(200)
    expect(me.json().data.mfa).toEqual({ required: true, enrolled: false, verified: false })
    expect(me.json().data.navigation).toEqual([])
  })

  test('enrol, confirm with a valid code, then the pages open', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'], mfa: 'none' })

    const started = await call(app, { method: 'POST', url: '/v1/auth/mfa/totp', as: user })
    const secret: string = started.json().data.secret
    const wrong = await call(app, { method: 'POST', url: '/v1/auth/mfa/totp/confirm', as: user, body: { code: '000000' } })
    const confirmed = await call(app, { method: 'POST', url: '/v1/auth/mfa/totp/confirm', as: user, body: { code: authenticator.generate(secret) } })
    const opened = await protectedRead(sessionFrom(confirmed))
    const preMfaToken = await protectedRead(user)
    const [stored] = await ownerRows<{ secret_encrypted: string }>('SELECT secret_encrypted FROM mfa_credential WHERE user_id = $1', [user.id])

    expect(started.statusCode).toBe(201)
    expect(started.json().data.otpauth_uri).toMatch(/^otpauth:\/\/totp\/NMP:/)
    expect(stored!.secret_encrypted).not.toContain(secret) // sealed at rest
    expect(wrong.statusCode).toBe(422)
    expect(wrong.json().error.code).toBe('MFA_CODE_INVALID')
    expect(confirmed.statusCode).toBe(200)
    expect(opened.statusCode).toBe(200)
    expect(preMfaToken.statusCode).toBe(401) // elevated with a new token
    expect(await liveSessions(user.id)).toEqual([{ assurance_level: 'aal2', verified: true, stepped_up: true }])
    expect(await auditActions(tenant.id)).toEqual(expect.arrayContaining(['MFA.ENROLMENT_STARTED', 'AUTH.MFA_FAILED', 'MFA.ENROLLED']))
  })

  test('an enrolled factor cannot be replaced by a new enrolment', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'] })

    const response = await call(app, { method: 'POST', url: '/v1/auth/mfa/totp', as: user })

    expect(response.statusCode).toBe(409)
  })
})

describe('second factor at sign-in', () => {
  test('an enrolled user must verify before anything else, then gets AAL2', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Commission analyst'], mfa: 'unverified' })

    const blocked = await protectedRead(user)
    const verified = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/mfa', as: user, body: { code: totpCode(user.totpSecret!) } })
    const opened = await protectedRead(sessionFrom(verified))

    expect(blocked.json().error.code).toBe('MFA_VERIFICATION_REQUIRED')
    expect(verified.statusCode).toBe(200)
    expect(opened.statusCode).toBe(200)
    expect(await liveSessions(user.id)).toMatchObject([{ assurance_level: 'aal2' }])
  })

  test('ASVS V3.2.1: the token issued before the second factor never reaches AAL2', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Commission analyst'], mfa: 'unverified' })

    const verified = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/mfa', as: user, body: { code: totpCode(user.totpSecret!) } })
    const oldToken = await call(app, { method: 'GET', url: '/v1/me', as: user })
    const newToken = await call(app, { method: 'GET', url: '/v1/me', as: sessionFrom(verified) })

    expect(verified.headers['set-cookie']).toMatch(/^nmp_session=[\w-]{43}; .*HttpOnly/)
    expect(oldToken.statusCode).toBe(401)
    expect(newToken.json().data.mfa).toMatchObject({ verified: true })
  })

  test('a session that ended while its code was checked is refused with 401, never elevated', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, mfa: 'unverified' })
    await ownerRows('UPDATE session SET revoked_at = now() WHERE id = $1', [user.sessionId])

    const elevation = withTenant({ tenantId: tenant.id, userId: user.id }, (tx) => elevateSession(tx, user.sessionId, true))

    await expect(elevation).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' })
    expect(await liveSessions(user.id)).toEqual([])
  })

  test('a code is accepted once: replaying it for step-up fails (last_used_step)', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Commission analyst'], mfa: 'unverified' })
    const code = totpCode(user.totpSecret!)

    const verified = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/mfa', as: user, body: { code } })
    const replay = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/step-up', as: sessionFrom(verified), body: { code } })

    expect(replay.statusCode).toBe(422)
  })

  test('limited retries: after five wrong codes even a valid one is refused with 429 MFA_LOCKED', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, mfa: 'unverified' })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await call(app, { method: 'POST', url: '/v1/auth/sessions/current/mfa', as: user, body: { code: '000000' } })
    }

    const locked = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/mfa', as: user, body: { code: totpCode(user.totpSecret!) } })
    const refusals = await ownerRows(
      `SELECT 1 FROM audit.audit_event WHERE actor_id = $1 AND action = 'AUTH.MFA_FAILED' AND after_ref LIKE '%"locked"%'`,
      [user.id],
    )

    expect(locked.statusCode).toBe(429)
    expect(locked.json().error.code).toBe('MFA_LOCKED')
    expect(refusals).toHaveLength(1) // a refused attempt is audited too
  })

  test('limited retries hold under concurrency: 20 parallel wrong codes get 5 checks, then MFA_LOCKED', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, mfa: 'unverified' })
    const attempt = () => call(app, { method: 'POST', url: '/v1/auth/sessions/current/mfa', as: user, body: { code: '000000' } })

    const statuses = (await Promise.all(Array.from({ length: 20 }, attempt))).map((response) => response.statusCode)
    const failures = await ownerRows(`SELECT 1 FROM login_attempt WHERE account_key = $1 AND NOT succeeded`, [`mfa:${user.id}`])

    expect(statuses.filter((status) => status === 422)).toHaveLength(5)
    expect(statuses.filter((status) => status === 429)).toHaveLength(15)
    expect(failures).toHaveLength(5)
  })
})

describe('step-up', () => {
  test('a verified session refreshes step_up_at with a new code', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    await ownerRows('UPDATE session SET step_up_at = NULL WHERE id = $1', [user.sessionId])

    const response = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/step-up', as: user, body: { code: totpCode(user.totpSecret!, -1) } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['set-cookie']).toBeUndefined() // already AAL2: the token stays
    expect(await liveSessions(user.id)).toMatchObject([{ stepped_up: true }])
    expect(await auditActions(tenant.id)).toContain('AUTH.STEP_UP')
  })

  test('step-up is not reachable before the sign-in factor is verified, nor without a session', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, mfa: 'unverified' })

    const pending = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/step-up', as: user, body: { code: '123456' } })
    const anonymous = await call(app, { method: 'POST', url: '/v1/auth/sessions/current/step-up', body: { code: '123456' } })

    expect(pending.json().error.code).toBe('MFA_VERIFICATION_REQUIRED')
    expect(anonymous.statusCode).toBe(401)
  })

  test('every MFA route needs a session', async () => {
    for (const url of ['/v1/auth/mfa/totp', '/v1/auth/mfa/totp/confirm', '/v1/auth/sessions/current/mfa']) {
      expect((await call(app, { method: 'POST', url, body: { code: '123456' } })).statusCode).toBe(401)
    }
  })
})

describe('GET /v1/me', () => {
  test('returns user, tenant, roles, sorted permissions and navigation from permissions', async () => {
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'] })

    const body = (await call(app, { method: 'GET', url: '/v1/me', as: user })).json().data

    expect(body.user.id).toBe(user.id)
    expect(body.tenant).toMatchObject({ id: tenant.id, slug: tenant.slug })
    expect(body.roles.map((role: { name: string }) => role.name)).toEqual(['Compliance officer'])
    expect(body.permissions).toEqual(['audit.read', 'compliance.read', 'export', 'mapping.approve', 'market.signoff', 'snapshot.create'])
    expect(body.navigation.map((entry: { key: string }) => entry.key)).toEqual(['compliance', 'audit', 'markets'])
  })

  test('an entry opens with any one of its permissions (PLAN B1 2.10)', async () => {
    const keys = async (roles: Parameters<typeof createSignedInUser>[0]['roles']) => {
      const user = await createSignedInUser({ tenantId: tenant.id, roles })
      return (await call(app, { method: 'GET', url: '/v1/me', as: user })).json().data.navigation.map((entry: { key: string }) => entry.key)
    }

    expect(await keys(['Tenant admin'])).toEqual(expect.arrayContaining(['settings', 'markets', 'integrations']))
    expect(await keys(['Finance approver'])).toContain('settings')
    expect(await keys(['Finance approver'])).not.toContain('markets')
    expect(await keys(['Commission analyst'])).not.toContain('integrations')
  })

  test('a vendor user sees the vendor console only and no tenant', async () => {
    const vendor = await createSignedInUser({ tenantId: null })

    const body = (await call(app, { method: 'GET', url: '/v1/me', as: vendor })).json().data

    expect(body).toMatchObject({ realm: 'vendor', tenant: null, permissions: [], mfa: { required: true } })
    expect(body.navigation.map((entry: { key: string }) => entry.key)).toEqual(['console'])
  })

  test('without a session it is 401', async () => {
    expect((await call(app, { method: 'GET', url: '/v1/me' })).statusCode).toBe(401)
  })
})
