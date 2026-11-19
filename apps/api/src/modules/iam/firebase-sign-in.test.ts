import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { createLocalJWKSet, createRemoteJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, resetApiDb, sessionFrom,
  type TestTenant,
} from '../../../test/helpers/index.js'
import { hashPassword } from '../../lib/passwords.js'
import { portalMember } from './portal-test-support.js'

const PROJECT = 'nmp-test'
const FIREBASE_ENV = {
  FIREBASE_PROJECT_ID: PROJECT, FIREBASE_WEB_API_KEY: 'web-api-key', FIREBASE_AUTH_DOMAIN: 'nmp-test.firebaseapp.com',
  FIREBASE_APP_ID: '1:123:web:abc',
}
const KID = 'test-key'
const HOUR = 3600
const REFUSED = { code: 'INVALID_CREDENTIALS', message: 'The sign-in could not be completed.' }
const PASSWORD = 'correct horse battery staple'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let signingKey: CryptoKey
let otherKey: CryptoKey
let firebaseKeys: ReturnType<typeof createLocalJWKSet>
let passwordHash: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  ;[acme, globex] = [await createTenant(), await createTenant()]
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  firebaseKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' }] })
  app = await buildTestApp({ env: { ...FIREBASE_ENV, SIGN_IN_RATE_LIMIT_PER_MINUTE: '1000' }, firebaseKeys })
  passwordHash = await hashPassword(PASSWORD)
})

afterAll(async () => {
  await app.close()
})

interface TokenOptions {
  readonly email?: string
  readonly sub?: string
  readonly emailVerified?: boolean
  readonly issuer?: string
  readonly audience?: string
  /** Seconds from now. */
  readonly issuedAt?: number
  readonly expiresAt?: number
  readonly key?: CryptoKey
  /** The firebase claim; default { sign_in_provider: 'google.com' }. */
  readonly firebase?: Record<string, unknown> | null
}

/** A Firebase ID token as Google issues it, signed by the test key unless told otherwise. */
function idToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    ...(options.email === undefined ? {} : { email: options.email }),
    email_verified: options.emailVerified ?? true, auth_time: now,
    ...(options.firebase === null ? {} : { firebase: options.firebase ?? { sign_in_provider: 'google.com' } }),
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(options.issuer ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(options.audience ?? PROJECT)
    .setSubject(options.sub ?? randomUUID())
    .setIssuedAt(now + (options.issuedAt ?? 0))
    .setExpirationTime(now + (options.expiresAt ?? HOUR))
    .sign(options.key ?? signingKey)
}

const withPassword = (password: string | undefined) => (password === undefined ? {} : { password })
const signIn = (tenant: string, token: string, password?: string, on = app) =>
  call(on, { method: 'POST', url: '/v1/auth/firebase-sessions', body: { tenant, id_token: token, ...withPassword(password) } })
const vendorSignIn = (token: string, password?: string) =>
  call(app, { method: 'POST', url: '/v1/auth/vendor-firebase-sessions', body: { id_token: token, ...withPassword(password) } })

/** Staff with a known password: the first Firebase sign-in must prove it. */
const staff = (options: Omit<Parameters<typeof createSignedInUser>[0], 'passwordHash'>) => createSignedInUser({ ...options, passwordHash })

const subjectOf = async (userId: string) =>
  (await ownerRows<{ firebase_subject: string | null }>('SELECT firebase_subject FROM user_account WHERE id = $1', [userId]))[0]!.firebase_subject
const auditOf = (userId: string, action: string) => ownerRows<{ after_ref: string | null }>(
  `SELECT after_ref FROM audit.audit_event WHERE action = $2 AND (object_id = $1
     OR object_id IN (SELECT id FROM session WHERE user_id = $1)) ORDER BY seq`,
  [userId, action],
)
const afterOf = (row: { after_ref: string | null }) => (JSON.parse(row.after_ref!) as { after: unknown }).after

describe('GET /v1/auth/firebase-config', () => {
  test('answers the public web config to anyone', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/auth/firebase-config' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({
      api_key: 'web-api-key', auth_domain: 'nmp-test.firebaseapp.com', project_id: PROJECT, app_id: '1:123:web:abc',
    })
  })
})

describe('POST /v1/auth/firebase-sessions (tenant realm)', () => {
  test('an unlinked account is not opened by its email address alone: 401 FIREBASE_LINK_REQUIRED, nothing bound', async () => {
    const user = await staff({ tenantId: acme.id, roles: ['Commission analyst'], mfa: 'none' })
    const token = await idToken({ email: user.email })

    const responses = [await signIn(acme.slug, token), await signIn(acme.slug, token, 'not the password!')]

    expect(responses.map((response) => [response.statusCode, response.json().error.code]))
      .toEqual([[401, 'FIREBASE_LINK_REQUIRED'], [401, 'INVALID_CREDENTIALS']])
    expect(responses.some((response) => response.headers['set-cookie'] !== undefined)).toBe(false)
    expect(await subjectOf(user.id)).toBeNull()
    expect(await auditOf(user.id, 'AUTH.SIGN_IN')).toHaveLength(0)
    expect((await auditOf(user.id, 'AUTH.SIGN_IN_FAILED')).map(afterOf)).toEqual([
      { reason: 'link_required', subject: expect.any(String), sign_in_provider: 'google.com' }, { reason: 'invalid_credentials' },
    ])
  })

  test('a verified Google token with the account password links it once, audits who was bound and opens a session', async () => {
    const user = await staff({ tenantId: acme.id, roles: ['Commission analyst'], mfa: 'none' })
    const sub = randomUUID()

    const response = await signIn(acme.slug, await idToken({ email: user.email.toUpperCase(), sub }), PASSWORD)
    const again = await signIn(acme.slug, await idToken({ email: user.email, sub }))
    const me = await call(app, { method: 'GET', url: '/v1/me', as: sessionFrom(response) })
    const [signInEvent] = await auditOf(user.id, 'AUTH.SIGN_IN')

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toEqual({ expires_at: expect.any(String), next_step: 'none' })
    expect(response.headers['set-cookie']).toMatch(/; HttpOnly(;|$)/)
    expect(again.statusCode).toBe(201) // bound: the password is not asked again
    expect(me.json().data.user.id).toBe(user.id)
    expect(await subjectOf(user.id)).toBe(sub)
    expect((await auditOf(user.id, 'AUTH.IDENTITY_LINKED')).map(afterOf))
      .toEqual([{ provider: 'firebase', subject: sub, sign_in_provider: 'google.com' }])
    expect(afterOf(signInEvent!)).toEqual({ method: 'firebase', provider: 'google.com' })
  })

  test('one person who is staff in two tenants links the same Google account to both', async () => {
    const email = `${randomUUID()}@example.test`
    const [inAcme, inGlobex] = [await staff({ tenantId: acme.id, email, mfa: 'none' }), await staff({ tenantId: globex.id, email, mfa: 'none' })]
    const sub = randomUUID()

    const responses = [await signIn(acme.slug, await idToken({ email, sub }), PASSWORD), await signIn(globex.slug, await idToken({ email, sub }), PASSWORD)]

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201])
    expect([await subjectOf(inAcme.id), await subjectOf(inGlobex.id)]).toEqual([sub, sub])
  })

  test('the same subject signs in again without linking again; MFA rules apply as for passwords', async () => {
    const user = await staff({ tenantId: acme.id, roles: ['Finance approver'], mfa: 'none' })
    const sub = randomUUID()

    const first = await signIn(acme.slug, await idToken({ email: user.email, sub }), PASSWORD)
    const second = await signIn(acme.slug, await idToken({ email: user.email, sub }))

    expect([first.statusCode, second.statusCode]).toEqual([201, 201])
    expect(second.json().data.next_step).toBe('mfa_enrolment')
    expect(await auditOf(user.id, 'AUTH.IDENTITY_LINKED')).toHaveLength(1)
    expect(await auditOf(user.id, 'AUTH.SIGN_IN')).toHaveLength(2)
  })

  test('another subject for an account already linked is refused, even with the password, and audited as identity_mismatch', async () => {
    const user = await staff({ tenantId: acme.id, mfa: 'none' })
    const [sub, other] = [randomUUID(), randomUUID()]
    await signIn(acme.slug, await idToken({ email: user.email, sub }), PASSWORD)

    const response = await signIn(acme.slug, await idToken({ email: user.email, sub: other }), PASSWORD)

    expect(response.statusCode).toBe(401)
    expect(response.json().error).toMatchObject(REFUSED)
    expect(await subjectOf(user.id)).toBe(sub)
    expect((await auditOf(user.id, 'AUTH.SIGN_IN_FAILED')).map(afterOf))
      .toEqual([{ reason: 'identity_mismatch', subject: other, sign_in_provider: 'google.com' }])
  })

  test('a subject already linked to another account of the tenant is 409 IDENTITY_IN_USE, audited with the subject', async () => {
    const [first, second] = [await staff({ tenantId: acme.id, mfa: 'none' }), await staff({ tenantId: acme.id, mfa: 'none' })]
    const sub = randomUUID()
    await signIn(acme.slug, await idToken({ email: first.email, sub }), PASSWORD)

    const response = await signIn(acme.slug, await idToken({ email: second.email, sub }), PASSWORD)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('IDENTITY_IN_USE')
    expect(await subjectOf(second.id)).toBeNull()
    expect(await auditOf(second.id, 'AUTH.SIGN_IN')).toHaveLength(0)
    expect((await auditOf(second.id, 'AUTH.SIGN_IN_FAILED')).map(afterOf))
      .toEqual([{ reason: 'identity_in_use', subject: sub, sign_in_provider: 'google.com' }])
  })

  test('a token whose email is missing or not verified is 401 EMAIL_NOT_VERIFIED', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, mfa: 'none' })

    const responses = [
      await signIn(acme.slug, await idToken({ email: user.email, emailVerified: false })),
      await signIn(acme.slug, await idToken()),
    ]

    for (const response of responses) {
      expect(response.statusCode).toBe(401)
      expect(response.json().error.code).toBe('EMAIL_NOT_VERIFIED')
    }
    expect(await subjectOf(user.id)).toBeNull()
  })

  test('a token of another project or issuer, HS256, another key, expired, issued in the future or garbage is refused', async () => {
    const user = await staff({ tenantId: acme.id, mfa: 'none' })
    const email = user.email
    const hs256 = await new SignJWT({ email, email_verified: true, auth_time: Math.floor(Date.now() / 1000) })
      .setProtectedHeader({ alg: 'HS256', kid: KID }).setIssuer(`https://securetoken.google.com/${PROJECT}`).setAudience(PROJECT)
      .setSubject(randomUUID()).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('a shared secret of 32 bytes or more!'))

    const tokens = [
      await idToken({ email, audience: 'other-project' }),
      await idToken({ email, issuer: 'https://securetoken.google.com/other-project' }),
      hs256,
      await idToken({ email, key: otherKey }),
      await idToken({ email, issuedAt: -2 * HOUR, expiresAt: -HOUR }),
      await idToken({ email, issuedAt: 600 }),
      'not.a.token',
      // Only Google and Firebase email/password sign-in, of the project itself (no Identity Platform tenant).
      ...(await Promise.all([
        { sign_in_provider: 'oidc.some-idp' }, { sign_in_provider: 'saml.x' }, { sign_in_provider: 'custom' }, {},
        { sign_in_provider: 'password', tenant: 'other-gcip-tenant' }, null,
      ].map((firebase) => idToken({ email, firebase })))),
    ]

    for (const token of tokens) {
      const response = await signIn(acme.slug, token, PASSWORD)
      expect(response.statusCode).toBe(401)
      expect(response.json().error).toMatchObject(REFUSED)
    }
    expect(await subjectOf(user.id)).toBeNull()
  })

  test('unknown email, another tenant and a deactivated user get the same 401 as a bad token', async () => {
    const user = await createSignedInUser({ tenantId: acme.id, mfa: 'none' })
    const deactivated = await createSignedInUser({ tenantId: acme.id, mfa: 'none' })
    await ownerRows(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [deactivated.id])

    const responses = [
      await signIn(acme.slug, await idToken({ email: 'nobody@example.test' })),
      await signIn(globex.slug, await idToken({ email: user.email })), // tenant B's sign-in never finds tenant A's user
      await signIn('no-such-tenant', await idToken({ email: user.email })),
      await signIn(acme.slug, await idToken({ email: deactivated.email })),
    ]

    for (const response of responses) {
      expect(response.statusCode).toBe(401)
      expect(response.json().error).toMatchObject(REFUSED)
    }
    expect([await subjectOf(user.id), await subjectOf(deactivated.id)]).toEqual([null, null])
  })

  test('AC-35.2: a locked account key cannot sign in by Firebase either; a Firebase success resets the counter', async () => {
    const locked = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })
    const fine = await createSignedInUser({ tenantId: acme.id, mfa: 'none', passwordHash })
    const wrongPassword = (email: string) =>
      call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: acme.slug, email, password: 'wrong password!' } })
    for (let attempt = 0; attempt < 5; attempt += 1) await wrongPassword(locked.email)
    for (let attempt = 0; attempt < 4; attempt += 1) await wrongPassword(fine.email)

    const refused = await signIn(acme.slug, await idToken({ email: locked.email }))
    const accepted = await signIn(acme.slug, await idToken({ email: fine.email }), PASSWORD)
    const afterSuccess = await wrongPassword(fine.email)

    expect(refused.statusCode).toBe(429)
    expect(refused.json().error.code).toBe('SIGN_IN_LOCKED')
    expect(accepted.statusCode).toBe(201)
    expect(afterSuccess.statusCode).toBe(401) // the four earlier failures no longer count
  })

  test('SEC-23: one token replayed from many addresses is rate limited', async () => {
    const strict = await buildTestApp({ env: { ...FIREBASE_ENV, SIGN_IN_RATE_LIMIT_PER_MINUTE: '2' }, firebaseKeys })
    try {
      const token = await idToken({ email: 'nobody@example.test' })
      const statuses: number[] = []
      for (let n = 1; n <= 3; n += 1) {
        const response = await call(strict, {
          method: 'POST', url: '/v1/auth/firebase-sessions', body: { tenant: acme.slug, id_token: token }, remoteAddress: `10.7.0.${n}`,
        })
        statuses.push(response.statusCode)
      }

      expect(statuses).toEqual([401, 401, 429])
    } finally {
      await strict.close()
    }
  })
})

describe('POST /v1/auth/vendor-firebase-sessions', () => {
  test('vendor users sign in to the vendor realm and always continue with MFA; tenant users cannot use it', async () => {
    const enrolled = await staff({ tenantId: null, mfa: 'unverified' })
    const unenrolled = await staff({ tenantId: null, mfa: 'none' })
    const tenantUser = await staff({ tenantId: acme.id, mfa: 'none' })
    const sub = randomUUID()

    const responses = [
      await vendorSignIn(await idToken({ email: enrolled.email, sub }), PASSWORD),
      await vendorSignIn(await idToken({ email: unenrolled.email }), PASSWORD),
    ]
    const refused = await vendorSignIn(await idToken({ email: tenantUser.email }), PASSWORD)
    const linked = await ownerRows<{ action: string }>(
      `SELECT action FROM audit.vendor_event WHERE object_id = $1 AND action = 'AUTH.IDENTITY_LINKED'`, [enrolled.id],
    )

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201])
    expect(responses.map((response) => response.json().data.next_step)).toEqual(['mfa_verification', 'mfa_enrolment'])
    expect(await subjectOf(enrolled.id)).toBe(sub)
    expect(linked).toHaveLength(1)
    expect(refused.statusCode).toBe(401)
    expect(await subjectOf(tenantUser.id)).toBeNull()
  })
})

describe('Firebase disabled (no FIREBASE_* configuration)', () => {
  test('all three routes answer 404 FIREBASE_DISABLED', async () => {
    const disabled = await buildTestApp({ firebaseKeys })
    try {
      const token = await idToken({ email: 'nobody@example.test' })
      const responses = [
        await call(disabled, { method: 'GET', url: '/v1/auth/firebase-config' }),
        await signIn(acme.slug, token, undefined, disabled),
        await call(disabled, { method: 'POST', url: '/v1/auth/vendor-firebase-sessions', body: { id_token: token } }),
      ]

      for (const response of responses) {
        expect(response.statusCode).toBe(404)
        expect(response.json().error.code).toBe('FIREBASE_DISABLED')
      }
    } finally {
      await disabled.close()
    }
  })
})

describe('Google key set unavailable', () => {
  test('a key set answered with an error or with no JSON is a 500, not a refusal of the caller', async () => {
    const answers = [{ status: 503, body: 'unavailable' }, { status: 200, body: '<html>captive portal</html>' }]
    for (const answer of answers) {
      const server = createServer((_request, response) => response.writeHead(answer.status).end(answer.body))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const keys = createRemoteJWKSet(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`))
      const remote = await buildTestApp({ env: FIREBASE_ENV, firebaseKeys: keys })
      try {
        const response = await signIn(acme.slug, await idToken({ email: 'nobody@example.test' }), undefined, remote)

        expect(response.statusCode).toBe(500)
      } finally {
        await remote.close()
        server.close()
      }
    }
  })
})

describe('POST /v1/auth/portal-firebase-sessions (T-B5-02)', () => {
  test('binds with the account password once, then opens a portal session; the staff route refuses the same token', async () => {
    const market = await createMarket(acme.id, 'NL')
    const member = await portalMember(acme.id, market)
    const user = await createPortalUser({ tenantId: acme.id, participantId: member.id, email: member.email!, passwordHash })
    const token = await idToken({ email: user.email })
    const portalSignIn = (password?: string) => call(app, {
      method: 'POST', url: '/v1/auth/portal-firebase-sessions', body: { tenant: acme.slug, id_token: token, ...withPassword(password) },
    })

    const unlinked = await portalSignIn()
    const linked = await portalSignIn(PASSWORD)
    const atStaff = await signIn(acme.slug, token)
    const [session] = await ownerRows<{ realm: string }>('SELECT realm FROM session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id])

    expect(unlinked.json().error.code).toBe('FIREBASE_LINK_REQUIRED')
    expect(linked.statusCode).toBe(201)
    expect(session!.realm).toBe('portal')
    expect(atStaff.statusCode).toBe(401)
  })
})
