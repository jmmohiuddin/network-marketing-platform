import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, sessionFrom,
  type TestTenant,
} from '../../../test/helpers/index.js'
import { hashPassword } from '../../lib/passwords.js'

const PASSWORD = 'correct horse battery staple'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let passwordHash: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  ;[acme, globex] = [await createTenant(), await createTenant()]
  passwordHash = await hashPassword(PASSWORD)
  app = await buildTestApp({ env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '100' } })
})

afterAll(async () => {
  await app.close()
})

const signIn = (tenant: string, email: string, password = PASSWORD) =>
  call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant, email, password } })

describe('POST /v1/auth/sessions (tenant realm)', () => {
  test('a correct password opens a session in an HttpOnly, SameSite=Strict cookie and audits AUTH.SIGN_IN', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], mfa: 'none', passwordHash })

    const response = await signIn(acme.slug, user.email.toUpperCase())
    const me = await call(app, { method: 'GET', url: '/v1/me', as: sessionFrom(response) })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.next_step).toBe('none')
    expect(response.headers['set-cookie']).toMatch(/^nmp_session=[\w-]{43}; /)
    expect(response.headers['set-cookie']).toMatch(/; HttpOnly(;|$)/)
    expect(response.headers['set-cookie']).toMatch(/; SameSite=Strict(;|$)/)
    expect(response.headers['set-cookie']).toMatch(/; Secure(;|$)/) // fails closed: Secure unless COOKIE_SECURE=false
    expect(me.json().data.user.id).toBe(user.id)
    expect(await auditActions(acme.id)).toContain('AUTH.SIGN_IN')
  })

  test('next_step tells an MFA user what to do', async () => {
    const unenrolled = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'], mfa: 'none', passwordHash })
    const enrolled = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], mfa: 'unverified', passwordHash })

    const steps = [(await signIn(acme.slug, unenrolled.email)).json(), (await signIn(acme.slug, enrolled.email)).json()]

    expect(steps.map((body) => body.data.next_step)).toEqual(['mfa_enrolment', 'mfa_verification'])
  })

  test('wrong password, unknown email, unknown tenant and another tenant all get the same 401', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })

    const responses = [
      await signIn(acme.slug, user.email, 'wrong password!'),
      await signIn(acme.slug, 'nobody@example.test'),
      await signIn('no-such-tenant', user.email),
      await signIn(globex.slug, user.email), // tenant B's sign-in never finds tenant A's user
    ]

    for (const response of responses) {
      expect(response.statusCode).toBe(401)
      expect(response.json().error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'The email or password is not correct.' })
    }
  })

  test('deactivated users cannot sign in; an archived tenant\'s users still do, to read and export (D-V1A-07)', async () => {
    const archived = await createTenant({ state: 'archived' })
    const deactivated = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })
    const inArchived = await createSignedInUser({ tenantId: archived.id, mfa: 'none', passwordHash })
    await ownerRows(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [deactivated.id])

    expect((await signIn(acme.slug, deactivated.email)).statusCode).toBe(401)
    expect((await signIn(archived.slug, inArchived.email)).statusCode).toBe(201)
  })

  test('AC-35.2: five failures lock the account; the sixth attempt is refused even with the right password', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })
    for (let attempt = 0; attempt < 5; attempt += 1) await signIn(acme.slug, user.email, 'wrong password!')

    const sixth = await signIn(acme.slug, user.email)
    const actions = await auditActions(acme.id)

    expect(sixth.statusCode).toBe(429)
    expect(sixth.json().error.code).toBe('SIGN_IN_LOCKED')
    expect(actions).toContain('AUTH.ACCOUNT_LOCKED')
    expect(actions.filter((action) => action === 'AUTH.SIGN_IN_FAILED').length).toBeGreaterThanOrEqual(6)
  })

  test('AC-35.2 under concurrency: 30 parallel wrong passwords from 30 addresses get 5 checks, then SIGN_IN_LOCKED', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })
    const attempt = (_: unknown, n: number) => call(app, {
      method: 'POST', url: '/v1/auth/sessions', body: { tenant: acme.slug, email: user.email, password: 'wrong password!' },
      remoteAddress: `10.1.0.${n + 1}`,
    })

    const responses = await Promise.all(Array.from({ length: 30 }, attempt))
    const statuses = responses.map((response) => response.statusCode)
    const failures = await ownerRows(`SELECT 1 FROM login_attempt WHERE account_key = $1 AND NOT succeeded`, [`${acme.slug}:${user.email}`])
    const locks = await ownerRows(`SELECT 1 FROM audit.audit_event WHERE object_id = $1 AND action = 'AUTH.ACCOUNT_LOCKED'`, [user.id])

    expect(statuses.filter((status) => status === 401)).toHaveLength(5)
    expect(responses.filter((response) => response.json().error.code === 'SIGN_IN_LOCKED')).toHaveLength(25)
    expect(failures).toHaveLength(5)
    expect(locks).toHaveLength(1)
  })

  test('the lock response does not reveal whether the account exists', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await signIn(acme.slug, 'ghost@example.test', 'wrong password!')

    const sixth = await signIn(acme.slug, 'ghost@example.test')

    expect(sixth.statusCode).toBe(429)
    expect(sixth.json().error.code).toBe('SIGN_IN_LOCKED')
  })

  test('SEC-23: sign-in is rate limited per IP across accounts and per account across IPs', async () => {
    const strict = await buildTestApp({ env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '3' } })
    const attempt = (email: string, remoteAddress: string) =>
      call(strict, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: 'x', email, password: 'p' }, remoteAddress })
    try {
      const spraying: number[] = []
      for (let n = 1; n <= 4; n += 1) spraying.push((await attempt(`user${n}@b.test`, '10.9.9.9')).statusCode)
      const distributed: number[] = []
      for (let n = 1; n <= 4; n += 1) distributed.push((await attempt('target@b.test', `10.8.0.${n}`)).statusCode)
      const limited = await attempt('fresh@b.test', '10.9.9.9')

      expect(spraying).toEqual([401, 401, 401, 429])
      expect(distributed).toEqual([401, 401, 401, 429])
      expect(limited.json().error.code).toBe('RATE_LIMITED')
      expect(limited.headers['retry-after']).toBeDefined()
    } finally {
      await strict.close()
    }
  })
})

describe('POST /v1/auth/vendor-sessions', () => {
  test('vendor users sign in to the vendor realm only; tenant users cannot use it', async () => {
    const vendor = await createSignedInUser({ tenantId: null, mfa: 'unverified', passwordHash })
    const tenantUser = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })

    const ok = await call(app, { method: 'POST', url: '/v1/auth/vendor-sessions', body: { email: vendor.email, password: PASSWORD } })
    const refused = await call(app, { method: 'POST', url: '/v1/auth/vendor-sessions', body: { email: tenantUser.email, password: PASSWORD } })
    const vendorEvents = await ownerRows<{ action: string }>('SELECT action FROM audit.vendor_event WHERE actor_id = $1', [vendor.id])

    expect(ok.statusCode).toBe(201)
    expect(ok.json().data.next_step).toBe('mfa_verification')
    expect(refused.statusCode).toBe(401)
    expect(vendorEvents.map((row) => row.action)).toEqual(['AUTH.SIGN_IN'])
  })
})

describe('DELETE /v1/auth/sessions/current', () => {
  test('signs out: the session is revoked, the cookie cleared and the event audited', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'], mfa: 'none' })

    const response = await call(app, { method: 'DELETE', url: '/v1/auth/sessions/current', as: user })
    const after = await call(app, { method: 'GET', url: '/v1/me', as: user })

    expect(response.statusCode).toBe(204) // reachable while MFA enrolment is pending
    expect(response.headers['set-cookie']).toMatch(/^nmp_session=;/)
    expect(after.statusCode).toBe(401)
    expect(await auditActions(acme.id)).toContain('AUTH.SIGN_OUT')
  })

  test('without a session it is 401', async () => {
    expect((await call(app, { method: 'DELETE', url: '/v1/auth/sessions/current' })).statusCode).toBe(401)
  })
})
