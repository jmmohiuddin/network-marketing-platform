import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import type { ApiModule } from '../../lib/module.js'
import { API_SCOPES, apiKeyOrSession, iamModule } from './index.js'

// A key-accessible route: who the request runs as inside its tenant transaction.
const probeModule: ApiModule = {
  name: 'probe',
  register(app) {
    const guard = apiKeyOrSession(app, 'compliance:read', requireRealm('tenant'), requirePermission('compliance.read'))
    app.get('/probe', { config: { apiKey: true }, preHandler: [guard] }, async (request) => {
      const { rows } = await inTenant(request, (tx) =>
        tx.query(`SELECT app_tenant_id() AS tenant_id, current_setting('app.user_id') AS user_id,
                         current_setting('app.actor_type') AS actor_type`),
      )
      return { session: request.auth !== null, key_id: request.apiKey?.keyId ?? null, ...rows[0] }
    })
  },
}

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let admin: TestUser
let adminWithoutStepUp: TestUser
let analyst: TestUser
let globexAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  adminWithoutStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, probeModule] })
})

afterAll(async () => {
  await app.close()
})

async function serviceAccount(as: TestUser = admin, name = `BI export ${randomUUID().slice(0, 8)}`): Promise<string> {
  const response = await call(app, { method: 'POST', url: '/v1/service-accounts', as, body: { name, purpose: 'Nightly BI extract' }, idempotencyKey: true })
  expect(response.statusCode).toBe(201)
  return response.json().data.id as string
}

const keyBody = (overrides: Record<string, unknown> = {}) => ({ name: 'Primary', scopes: ['compliance:read'], rate_tier: 'standard', ...overrides })

async function mintKey(accountId: string, overrides: Record<string, unknown> = {}, target: FastifyInstance = app, as: TestUser = admin) {
  const response = await call(target, { method: 'POST', url: `/v1/service-accounts/${accountId}/keys`, as, body: keyBody(overrides), idempotencyKey: true })
  expect(response.statusCode).toBe(201)
  return { id: response.json().data.key.id as string, token: response.json().data.token as string }
}

const probe = (token: string, target: FastifyInstance = app, remoteAddress?: string) =>
  target.inject({ method: 'GET', url: '/probe', headers: { authorization: `Bearer ${token}` }, ...(remoteAddress === undefined ? {} : { remoteAddress }) })

describe('GET /v1/api-keys/options', () => {
  test('lists the scope catalogue, the rate tiers from configuration and the longest grace', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/api-keys/options', as: admin })

    expect(response.json().data).toEqual({
      scopes: [
        { scope: 'compliance:read', description: 'Read compliance snapshots', personal_data: false, permissions: ['compliance.read'] },
        {
          scope: 'participants:write', description: 'Enrol participants and record types, positions, agreements, signals and servicing',
          personal_data: true, permissions: ['integration.manage', 'participant.manage', 'servicing.manage'],
        },
        { scope: 'orders:write', description: 'Send orders and order events', personal_data: false, permissions: ['integration.manage'] },
        { scope: 'ledger:export', description: 'Create and download GL journal exports', personal_data: false, permissions: ['ledger.export'] },
      ],
      rate_tiers: [{ tier: 'standard', requests_per_minute: 120 }, { tier: 'high', requests_per_minute: 1200 }],
      max_grace_minutes: 10_080,
    })
    expect((await call(app, { method: 'GET', url: '/v1/api-keys/options', as: analyst })).json().error.code).toBe('PERMISSION_DENIED')
    expect((await call(app, { method: 'GET', url: '/v1/api-keys/options' })).statusCode).toBe(401)
  })
})

describe('service accounts', () => {
  test('create needs a purpose and a unique name; replays under the same key; audited', async () => {
    const key = randomUUID()
    const body = { name: 'Warehouse sync', purpose: 'Reads compliance figures into the warehouse' }
    const first = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body, idempotencyKey: key })
    const replay = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body, idempotencyKey: key })
    const taken = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body, idempotencyKey: true })
    const noPurpose = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body: { name: 'x' }, idempotencyKey: true })
    const otherTenant = await call(app, { method: 'POST', url: '/v1/service-accounts', as: globexAdmin, body, idempotencyKey: true })

    expect(first.statusCode).toBe(201)
    expect(first.json().data).toMatchObject({ name: 'Warehouse sync', purpose: body.purpose, state: 'active' })
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json().data.id).toBe(first.json().data.id)
    expect(taken.json().error.code).toBe('SERVICE_ACCOUNT_NAME_TAKEN')
    expect(noPurpose.statusCode).toBe(400)
    expect(otherTenant.statusCode).toBe(201)
    expect(await ownerRows('SELECT action, actor_id FROM audit.audit_event WHERE object_id = $1', [first.json().data.id]))
      .toEqual([{ action: 'SERVICE_ACCOUNT.CREATED', actor_id: admin.id }])
    expect((await call(app, { method: 'POST', url: '/v1/service-accounts', as: analyst, body, idempotencyKey: true })).statusCode).toBe(403)
  })

  test('the list shows each account with its keys (never a hash or token), only of the own tenant', async () => {
    const accountId = await serviceAccount()
    const { id: keyId } = await mintKey(accountId)
    const globexAccount = await serviceAccount(globexAdmin)

    const list = await call(app, { method: 'GET', url: '/v1/service-accounts?limit=200', as: admin })
    const account = list.json().data.find((row: { id: string }) => row.id === accountId)

    expect(account).toMatchObject({ purpose: 'Nightly BI extract', state: 'active', created_by: { id: admin.id, display_name: null } })
    expect(account.keys).toHaveLength(1)
    expect(account.keys[0]).toMatchObject({ id: keyId, scopes: ['compliance:read'], rate_tier: 'standard', status: 'active', ip_allow: null })
    expect(account.keys[0].key_prefix).toMatch(/^nmpk_[A-Za-z0-9_-]{7}$/)
    expect(JSON.stringify(list.json())).not.toMatch(/key_hash|"token"/)
    expect(list.json().data.map((row: { id: string }) => row.id)).not.toContain(globexAccount)
    expect((await call(app, { method: 'GET', url: '/v1/service-accounts', as: analyst })).statusCode).toBe(403)
  })

  test('disable needs step-up, happens once, stops every key; another tenant gets 404', async () => {
    const accountId = await serviceAccount()
    const { token } = await mintKey(accountId)
    const disable = (as: TestUser) => call(app, { method: 'POST', url: `/v1/service-accounts/${accountId}/disable`, as, body: { reason: 'Supplier offboarded' } })

    expect((await disable(adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await disable(globexAdmin)).statusCode).toBe(404)
    expect((await disable(analyst)).statusCode).toBe(403)
    expect((await probe(token)).statusCode).toBe(200)
    const disabled = await disable(admin)
    expect(disabled.json().data).toMatchObject({ id: accountId, state: 'disabled' })
    expect((await disable(admin)).json().error.code).toBe('SERVICE_ACCOUNT_DISABLED')
    expect((await probe(token)).json().error.code).toBe('API_KEY_INVALID')
    expect((await call(app, { method: 'POST', url: `/v1/service-accounts/${accountId}/keys`, as: admin, body: keyBody(), idempotencyKey: true })).json().error.code)
      .toBe('SERVICE_ACCOUNT_DISABLED')
  })
})

describe('T-B1-15/17 POST /v1/service-accounts/:id/keys', () => {
  test('shows the token once, stores only its SHA-256 and prefix; a replay returns the key without the token', async () => {
    const accountId = await serviceAccount()
    const idempotencyKey = randomUUID()
    const request = { method: 'POST' as const, url: `/v1/service-accounts/${accountId}/keys`, as: admin, body: keyBody(), idempotencyKey }
    const first = await call(app, request)
    const replay = await call(app, request)
    const { key, token, token_shown: shown } = first.json().data
    const stored = await ownerRows<{ key_hash: string; key_prefix: string }>('SELECT key_hash, key_prefix FROM api_key WHERE id = $1', [key.id])
    const idempotency = await ownerRows<{ response: unknown }>('SELECT response FROM idempotency_key WHERE key = $1', [idempotencyKey])
    const audit = await ownerRows('SELECT before_ref, after_ref FROM audit.audit_event WHERE object_id = $1', [key.id])

    expect(first.statusCode).toBe(201)
    expect(shown).toBe(true)
    expect(token).toMatch(/^nmpk_[A-Za-z0-9_-]{43}$/)
    expect(stored).toEqual([{ key_hash: (await ownerRows<{ h: string }>(`SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS h`, [token]))[0]!.h, key_prefix: token.slice(0, 12) }])
    expect(replay.statusCode).toBe(201)
    expect(replay.json().data).toEqual({ key, token_shown: false })
    expect(JSON.stringify(idempotency)).not.toContain(token)
    expect(JSON.stringify(audit)).not.toContain(token)
    expect((await probe(token)).json()).toMatchObject({ session: false, key_id: key.id, tenant_id: acme.id, user_id: accountId, actor_type: 'service_account' })
  })

  test('refuses unknown scopes, bad networks, past expiry; needs step-up and the permission; another tenant gets 404', async () => {
    const accountId = await serviceAccount()
    const mint = (body: Record<string, unknown>, as: TestUser = admin) =>
      call(app, { method: 'POST', url: `/v1/service-accounts/${accountId}/keys`, as, body: keyBody(body), idempotencyKey: true })

    const unknownScope = await mint({ scopes: ['compliance:read', 'payouts:write'] })
    expect(unknownScope.json().error).toMatchObject({ code: 'SCOPE_UNKNOWN', details: { scopes: ['payouts:write'] } })
    expect((await mint({ ip_allow: ['not-an-ip'] })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await mint({ ip_allow: ['10.0.0.0/33'] })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await mint({ ip_allow: ['fe80::1%eth0'] })).json().error.code).toBe('VALIDATION_FAILED')
    const hostBits = await mint({ ip_allow: ['10.0.0.0/8', '10.1.2.3/16'] })
    expect(hostBits.json().error.details.issues).toEqual([{ path: 'ip_allow.1', message: 'has host bits set; use 10.1.0.0/16' }])
    expect((await mint({ expires_at: '2020-01-01T00:00:00Z' })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await mint({}, adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await mint({}, analyst)).statusCode).toBe(403)
    expect((await mint({}, globexAdmin)).statusCode).toBe(404)
    expect(await ownerRows('SELECT id FROM api_key WHERE service_account_id = $1', [accountId])).toEqual([])
  })
})

describe('keys are tenant-wide: minting and rotating need all-markets scope', () => {
  // integration.manage for all markets, compliance.read for one market only (a custom role beside a scoped base role).
  async function integratorWithScopedRead(): Promise<TestUser> {
    const user = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [await createMarket(acme.id, 'IE')], stepUp: true })
    const [role] = await ownerRows<{ id: string }>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required)
       VALUES ($1, $2, '{integration.manage}', false, true) RETURNING id`, [acme.id, `Integrator ${randomUUID().slice(0, 8)}`],
    )
    await ownerRows('INSERT INTO role_assignment (tenant_id, user_id, role_id, valid_from) VALUES ($1, $2, $3, now()) RETURNING id', [acme.id, user.id, role!.id])
    return user
  }

  test('a Tenant admin limited to one market cannot manage service accounts or mint a key (SCOPE_NOT_HELD)', async () => {
    const accountId = await serviceAccount()
    const scoped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [await createMarket(acme.id, 'GB')], stepUp: true })
    const minted = await call(app, { method: 'POST', url: `/v1/service-accounts/${accountId}/keys`, as: scoped, body: keyBody(), idempotencyKey: true })

    expect(minted.statusCode).toBe(403)
    expect(minted.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'integration.manage' } })
    expect((await call(app, { method: 'GET', url: '/v1/service-accounts', as: scoped })).json().error.code).toBe('SCOPE_NOT_HELD')
    expect(await ownerRows('SELECT id FROM api_key WHERE service_account_id = $1', [accountId])).toEqual([])
    const me = await call(app, { method: 'GET', url: '/v1/me', as: scoped })
    expect(me.json().data.navigation.map((entry: { key: string }) => entry.key)).not.toContain('integrations')
  })

  test('PLAN B2 2.8 scope pin: orders:write needs integration.manage, participants:write also participant.manage and servicing.manage, for all markets', async () => {
    const accountId = await serviceAccount()
    const scoped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [await createMarket(acme.id, 'NL')], stepUp: true })
    const integrator = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Support agent'], stepUp: true })
    const mint = (as: TestUser, scopes: string[]) =>
      call(app, { method: 'POST', url: `/v1/service-accounts/${accountId}/keys`, as, body: keyBody({ scopes }), idempotencyKey: true })

    const refused = await mint(scoped, ['orders:write'])
    const ordersOnly = await mint(admin, ['orders:write'])
    // A Tenant admin holds neither participant.manage nor servicing.manage: a key must not do what its minter cannot.
    const escalation = await mint(admin, ['participants:write'])
    const minted = await mint(integrator, ['orders:write', 'participants:write'])

    expect(API_SCOPES.filter((entry) => entry.scope !== 'compliance:read').map(({ scope, permissions }) => [scope, permissions]))
      .toEqual([
        ['participants:write', ['integration.manage', 'participant.manage', 'servicing.manage']], ['orders:write', ['integration.manage']],
        ['ledger:export', ['ledger.export']],
      ])
    expect(refused.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'integration.manage' } })
    expect(ordersOnly.statusCode).toBe(201)
    expect(escalation.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'participant.manage' } })
    expect(minted.statusCode).toBe(201)
    expect(minted.json().data.key.scopes).toEqual(['orders:write', 'participants:write'])
  })

  test('minting or rotating a compliance:read key needs compliance.read for all markets', async () => {
    const integrator = await integratorWithScopedRead()
    const accountId = await serviceAccount(integrator)
    const minted = await call(app, { method: 'POST', url: `/v1/service-accounts/${accountId}/keys`, as: integrator, body: keyBody(), idempotencyKey: true })
    const existing = await mintKey(accountId)
    const rotated = await call(app, { method: 'POST', url: `/v1/api-keys/${existing.id}/rotate`, as: integrator, body: { grace_minutes: 0 }, idempotencyKey: true })

    expect(minted.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'compliance.read' } })
    expect(rotated.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'compliance.read' } })
    expect(await ownerRows('SELECT id FROM api_key WHERE service_account_id = $1', [accountId])).toEqual([{ id: existing.id }])
    expect((await probe(existing.token)).statusCode).toBe(200)
  })
})

describe('T-B1-15 rotation and revocation', () => {
  test('rotation with grace keeps both keys working inside it; grace 0 stops the old key now (AC-IAM6-2)', async () => {
    const accountId = await serviceAccount()
    const old = await mintKey(accountId, { ip_allow: ['127.0.0.0/8'] })
    const rotate = (id: string, grace: number, as: TestUser = admin) =>
      call(app, { method: 'POST', url: `/v1/api-keys/${id}/rotate`, as, body: { grace_minutes: grace }, idempotencyKey: true })

    const withGrace = await rotate(old.id, 60)
    const { key, token, rotated_from: rotatedFrom } = withGrace.json().data
    expect(withGrace.statusCode).toBe(201)
    const again = await rotate(old.id, 60)
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('API_KEY_ALREADY_ROTATED')
    expect(await ownerRows('SELECT id FROM api_key WHERE rotated_from_id = $1', [old.id])).toEqual([{ id: key.id }])
    expect(key).toMatchObject({ rotated_from_id: old.id, scopes: ['compliance:read'], ip_allow: ['127.0.0.0/8'], status: 'active' })
    expect(Date.parse(rotatedFrom.expires_at) - Date.now()).toBeGreaterThan(59 * 60_000)
    expect((await probe(old.token)).statusCode).toBe(200)
    expect((await probe(token)).statusCode).toBe(200)
    const list = await call(app, { method: 'GET', url: '/v1/service-accounts?limit=200', as: admin })
    const keys = list.json().data.find((row: { id: string }) => row.id === accountId).keys
    expect(keys.find((row: { id: string }) => row.id === old.id).status).toBe('expiring')

    const immediate = await rotate(key.id, 0)
    expect(immediate.statusCode).toBe(201)
    expect((await probe(token)).json().error.code).toBe('API_KEY_INVALID')
    expect((await probe(immediate.json().data.token)).statusCode).toBe(200)
    expect((await rotate(key.id, 0)).json().error.code).toBe('API_KEY_INACTIVE')
    expect((await rotate(old.id, 20_000)).statusCode).toBe(400)
    expect((await rotate(old.id, 5, adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await rotate(old.id, 5, globexAdmin)).statusCode).toBe(404)
    expect(await ownerRows('SELECT action FROM audit.audit_event WHERE object_id = $1 ORDER BY seq', [old.id]))
      .toEqual([{ action: 'API_KEY.CREATED' }, { action: 'API_KEY.ROTATED' }])
  })

  test('a rotation replay returns the new key without its token', async () => {
    const old = await mintKey(await serviceAccount())
    const request = { method: 'POST' as const, url: `/v1/api-keys/${old.id}/rotate`, as: admin, body: { grace_minutes: 10 }, idempotencyKey: randomUUID() }
    const first = await call(app, request)
    const replay = await call(app, request)

    expect(first.json().data.token_shown).toBe(true)
    expect(replay.json().data).toEqual({ key: first.json().data.key, rotated_from: first.json().data.rotated_from, token_shown: false })
  })

  test('revoke stops the key at once, needs step-up, happens once', async () => {
    const { id, token } = await mintKey(await serviceAccount())
    const revoke = (as: TestUser) => call(app, { method: 'POST', url: `/v1/api-keys/${id}/revoke`, as, body: { reason: 'Leaked in a ticket' } })

    expect((await revoke(adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await revoke(globexAdmin)).statusCode).toBe(404)
    expect((await revoke(admin)).statusCode).toBe(200)
    expect((await revoke(admin)).json().error.code).toBe('API_KEY_INACTIVE')
    const refused = await probe(token)
    expect(refused.statusCode).toBe(401)
    expect(refused.headers['www-authenticate']).toBe('Bearer')
    expect(refused.json().error.code).toBe('API_KEY_INVALID')
  })
})

describe('T-B1-16 key authentication', () => {
  test('unknown, malformed, expired and archived-tenant keys are 401 API_KEY_INVALID with WWW-Authenticate', async () => {
    const expired = await mintKey(await serviceAccount())
    await ownerRows(`UPDATE api_key SET expires_at = now() - interval '1 second' WHERE id = $1`, [expired.id])
    const archivedTenant = await createTenant()
    const archivedAdmin = await createSignedInUser({ tenantId: archivedTenant.id, roles: ['Tenant admin'], stepUp: true })
    const archivedKey = await mintKey(await serviceAccount(archivedAdmin), {}, app, archivedAdmin)
    expect((await probe(archivedKey.token)).statusCode).toBe(200)
    await ownerRows(`UPDATE tenant SET state = 'archived' WHERE id = $1`, [archivedTenant.id])

    for (const token of [`nmpk_${'A'.repeat(43)}`, 'nmpk_short', expired.token, archivedKey.token]) {
      const response = await probe(token)
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.json().error.code).toBe('API_KEY_INVALID')
    }
  })

  test('a request from outside the allow-list is 403 IP_NOT_ALLOWED; IPv4-mapped addresses count as IPv4', async () => {
    const { token } = await mintKey(await serviceAccount(), { ip_allow: ['10.1.0.0/16', '2001:db8::/32'] })

    expect((await probe(token, app, '10.1.2.3')).statusCode).toBe(200)
    expect((await probe(token, app, '::ffff:10.1.9.9')).statusCode).toBe(200)
    expect((await probe(token, app, '2001:db8::5')).statusCode).toBe(200)
    expect((await probe(token, app, '10.2.0.1')).json().error.code).toBe('IP_NOT_ALLOWED')
    expect((await probe(token, app, '2001:db9::5')).json().error.code).toBe('IP_NOT_ALLOWED')
  })

  test('without TRUST_PROXY the socket peer counts; with it, the client in X-Forwarded-For from a trusted proxy', async () => {
    const proxied = await buildTestApp({ modules: [iamModule, probeModule], env: { TRUST_PROXY: 'loopback' } })
    try {
      const { token } = await mintKey(await serviceAccount(), { ip_allow: ['203.0.113.0/24'] })
      const via = (target: FastifyInstance, client: string, peer = '127.0.0.1') => target.inject({
        method: 'GET', url: '/probe', remoteAddress: peer, headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': client },
      })

      expect((await via(proxied, '203.0.113.9')).statusCode).toBe(200)
      expect((await via(proxied, '198.51.100.7')).json().error.code).toBe('IP_NOT_ALLOWED')
      expect((await via(proxied, '203.0.113.9', '192.0.2.50')).json().error.code).toBe('IP_NOT_ALLOWED') // untrusted peer
      expect((await via(app, '203.0.113.9')).json().error.code).toBe('IP_NOT_ALLOWED')
    } finally {
      await proxied.close()
    }
  })

  test('a key without the route\'s scope is 403 SCOPE_MISSING (AC-22.3)', async () => {
    // A scope of a later increment: the catalogue cannot mint it yet, so the key row is written directly.
    const token = `nmpk_${randomBytes(32).toString('base64url')}`
    await ownerRows(
      `INSERT INTO api_key (tenant_id, service_account_id, name, key_prefix, key_hash, scopes, rate_tier, created_by)
       VALUES ($1, $2, 'Ledger', $3, encode(sha256(convert_to($4, 'UTF8')), 'hex'), '{ledger:export}', 'standard', $5)`,
      [acme.id, await serviceAccount(), token.slice(0, 12), token, admin.id],
    )

    const response = await probe(token)
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toMatchObject({ code: 'SCOPE_MISSING', details: { scope: 'compliance:read' } })
  })

  test('a key never reaches a session-only route; a session never needs a key (AC-IAM6-5)', async () => {
    const { token } = await mintKey(await serviceAccount())
    const keyOnStaffRoute = await app.inject({ method: 'GET', url: '/v1/api-keys/options', headers: { authorization: `Bearer ${token}` } })
    const sessionOnKeyRoute = await call(app, { method: 'GET', url: '/probe', as: await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] }) })

    expect(keyOnStaffRoute.statusCode).toBe(401)
    expect(keyOnStaffRoute.json().error.code).toBe('UNAUTHENTICATED')
    expect(sessionOnKeyRoute.json()).toMatchObject({ session: true, key_id: null, actor_type: 'user' })
    const withoutPermission = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })
    expect((await call(app, { method: 'GET', url: '/probe', as: withoutPermission })).json().error.code).toBe('PERMISSION_DENIED')
    expect((await app.inject({ method: 'GET', url: '/probe' })).statusCode).toBe(401)
  })

  test('last_used_at is stamped on use', async () => {
    const { id, token } = await mintKey(await serviceAccount())
    await probe(token)
    const [row] = await ownerRows<{ last_used_at: Date | null }>('SELECT last_used_at FROM api_key WHERE id = $1', [id])
    expect(row!.last_used_at).not.toBeNull()
  })
})

describe('T-B1-16 per-key rate limits (AC-IAM6-4)', () => {
  let limited: FastifyInstance
  beforeAll(async () => {
    limited = await buildTestApp({
      modules: [iamModule, probeModule], env: { API_KEY_RATE_STANDARD_PER_MINUTE: '3', API_KEY_RATE_HIGH_PER_MINUTE: '5', API_RATE_LIMIT_PER_MINUTE: '4' },
    })
  })
  afterAll(async () => {
    await limited.close()
  })

  // The API-wide limit (4) is below the high tier (5): key callers are not counted by it (D-B1-18).
  test('each key has its own counter of its tier, also behind one address; over it is 429 with Retry-After', async () => {
    const accountId = await serviceAccount()
    const first = await mintKey(accountId, {}, limited)
    const second = await mintKey(accountId, {}, limited)
    const high = await mintKey(accountId, { rate_tier: 'high' }, limited)
    const statuses = async (token: string, count: number) => {
      const codes: number[] = []
      for (let i = 0; i < count; i += 1) codes.push((await probe(token, limited, '192.0.2.10')).statusCode)
      return codes
    }

    expect(await statuses(first.token, 4)).toEqual([200, 200, 200, 429])
    expect(await statuses(second.token, 3)).toEqual([200, 200, 200])
    expect(await statuses(high.token, 6)).toEqual([200, 200, 200, 200, 200, 429])
    const over = await probe(first.token, limited, '192.0.2.10')
    expect(over.json().error.code).toBe('RATE_LIMITED')
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0)
  })

  test('failed lookups are limited per address', async () => {
    const codes: number[] = []
    for (let i = 0; i < 5; i += 1) codes.push((await probe(`nmpk_${'B'.repeat(43)}`, limited, '198.51.100.20')).statusCode)

    expect(codes).toEqual([401, 401, 401, 401, 429])
    expect((await probe(`nmpk_${'B'.repeat(43)}`, limited, '198.51.100.21')).statusCode).toBe(401)
  })

  test('a valid key used from outside its allow-list is limited per address, not against the key\'s quota', async () => {
    const { token } = await mintKey(await serviceAccount(), { ip_allow: ['203.0.113.0/24'] }, limited)
    const codes: number[] = []
    for (let i = 0; i < 5; i += 1) codes.push((await probe(token, limited, '198.51.100.7')).statusCode)

    expect(codes).toEqual([403, 403, 403, 403, 429])
    expect((await probe(token, limited, '203.0.113.5')).statusCode).toBe(200)
  })

  test('a bearer header on a route that takes no API keys is counted by the API-wide limiter', async () => {
    const headers = { authorization: `Bearer nmpk_${'C'.repeat(43)}` }
    const codes: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const response = await limited.inject({ method: 'GET', url: '/v1/api-keys/options', headers, remoteAddress: '203.0.113.30' })
      codes.push(response.statusCode)
    }

    expect(codes).toEqual([401, 401, 401, 401, 429])
  })
})
