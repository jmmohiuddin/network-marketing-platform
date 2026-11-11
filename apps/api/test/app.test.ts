import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { requireAuth } from '../src/lib/auth.js'
import { envelope, parse } from '../src/lib/http.js'
import type { ApiModule } from '../src/lib/module.js'
import { auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb } from './helpers/index.js'

// A probe module: one public route with validation, one authenticated route.
const probe: ApiModule = {
  name: 'probe',
  register(app) {
    app.post('/v1/probe/echo', async (request) => envelope(parse(z.strictObject({ n: z.number().int() }), request.body)))
    app.get('/v1/probe/whoami', { preHandler: [requireAuth()] }, async (request) => envelope({ user: request.auth?.userId }))
  },
}

let app: FastifyInstance
let tenantId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  app = await buildTestApp({ modules: [probe], env: { API_RATE_LIMIT_PER_MINUTE: '1000' } })
})

afterAll(async () => {
  await app.close()
})

describe('response envelope and headers', () => {
  test('an unknown route answers 404 in the error envelope with the request id', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/nothing-here' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such endpoint.', details: null, request_id: response.headers['x-request-id'] },
    })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  test('validation errors list every problem and reject unknown fields', async () => {
    const response = await call(app, { method: 'POST', url: '/v1/probe/echo', body: { n: 'x', extra: true } })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_FAILED')
    expect(response.json().error.details.issues).toHaveLength(2)
  })

  test('malformed JSON is a 400 in the envelope', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/probe/echo', payload: '{', headers: { 'content-type': 'application/json', 'x-requested-with': 'x' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('MALFORMED_REQUEST')
  })

  test('success uses { data, meta } and every response has a fresh request id', async () => {
    const first = await call(app, { method: 'POST', url: '/v1/probe/echo', body: { n: 1 } })
    const second = await call(app, { method: 'POST', url: '/v1/probe/echo', body: { n: 1 }, headers: { 'x-request-id': 'forged' } })

    expect(first.json()).toEqual({ data: { n: 1 }, meta: {} })
    expect(second.headers['x-request-id']).not.toBe('forged')
    expect(second.headers['x-request-id']).not.toBe(first.headers['x-request-id'])
  })
})

describe('CSRF defence', () => {
  test('an unsafe request without X-Requested-With is refused before anything runs', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/probe/echo', payload: { n: 1 } })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CSRF_HEADER_MISSING')
  })

  test('safe methods need no header', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/probe/whoami' })

    expect(response.statusCode).toBe(401)
  })
})

describe('session resolution', () => {
  test('no cookie, a malformed cookie and an unknown token are all 401 UNAUTHENTICATED', async () => {
    const cookies = ['', 'nmp_session=short', `nmp_session=${'A'.repeat(43)}`]

    for (const cookie of cookies) {
      const response = await call(app, { method: 'GET', url: '/v1/probe/whoami', as: { cookie } })
      expect(response.json().error.code).toBe('UNAUTHENTICATED')
    }
  })

  test('a live session resolves to its user', async () => {
    const user = await createSignedInUser({ tenantId })

    const response = await call(app, { method: 'GET', url: '/v1/probe/whoami', as: user })

    expect(response.json().data.user).toBe(user.id)
  })

  test('an idle session is refused, revoked and the expiry audited by the system in the same transaction', async () => {
    const user = await createSignedInUser({ tenantId })
    await ownerRows(`UPDATE session SET last_seen_at = now() - interval '31 minutes' WHERE id = $1`, [user.sessionId])

    const response = await call(app, { method: 'GET', url: '/v1/probe/whoami', as: user })
    const again = await call(app, { method: 'GET', url: '/v1/probe/whoami', as: user })
    const [session] = await ownerRows<{ revoked: boolean }>('SELECT revoked_at IS NOT NULL AS revoked FROM session WHERE id = $1', [user.sessionId])
    const events = await ownerRows<{ actor_type: string; actor_id: string | null; request_id: string }>(
      `SELECT actor_type, actor_id, request_id FROM audit.audit_event WHERE action = 'AUTH.SESSION_EXPIRED' AND object_id = $1`,
      [user.sessionId],
    )

    expect(response.statusCode).toBe(401)
    expect(again.statusCode).toBe(401)
    expect(session).toEqual({ revoked: true })
    expect(events).toEqual([{ actor_type: 'system', actor_id: null, request_id: response.headers['x-request-id'] }])
  })

  test('sessions of deactivated users and archived tenants stop working', async () => {
    const deactivated = await createSignedInUser({ tenantId })
    const archivedTenant = await createTenant({ state: 'archived' })
    const archived = await createSignedInUser({ tenantId: archivedTenant.id })
    await ownerRows(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [deactivated.id])

    const responses = await Promise.all([deactivated, archived].map((as) => call(app, { method: 'GET', url: '/v1/probe/whoami', as })))

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401])
    expect(await auditActions(tenantId)).toContain('AUTH.SESSION_REVOKED')
    expect(await auditActions(archivedTenant.id)).toContain('AUTH.SESSION_REVOKED')
  })
})

describe('rate limiting', () => {
  test('a session over the per-minute limit gets 429 RATE_LIMITED with Retry-After', async () => {
    const limited = await buildTestApp({ modules: [probe], env: { API_RATE_LIMIT_PER_MINUTE: '2' } })
    const user = await createSignedInUser({ tenantId })
    try {
      const statuses: number[] = []
      for (let attempt = 0; attempt < 3; attempt += 1) {
        statuses.push((await call(limited, { method: 'GET', url: '/v1/probe/whoami', as: user })).statusCode)
      }
      const last = await call(limited, { method: 'GET', url: '/v1/probe/whoami', as: user })

      expect(statuses).toEqual([200, 200, 429])
      expect(last.json().error.code).toBe('RATE_LIMITED')
      expect(last.headers['retry-after']).toBeDefined()
    } finally {
      await limited.close()
    }
  })
})
