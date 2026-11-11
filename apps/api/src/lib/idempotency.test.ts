import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser } from '../../test/helpers/index.js'
import { requireAuth } from './auth.js'
import { enqueueOutbox } from './outbox.js'
import { inTenant } from './db.js'
import { envelope, parse } from './http.js'
import { idempotent, sendIdempotent } from './idempotency.js'
import type { ApiModule } from './module.js'

// Each first execution writes one outbox row, so side effects can be counted.
const probe: ApiModule = {
  name: 'probe',
  register(app) {
    app.post('/v1/probe/things/:id', { preHandler: [requireAuth()] }, async (request, reply) => {
      const body = parse(z.strictObject({ n: z.number() }), request.body)
      const result = await inTenant(request, (tx) =>
        idempotent(tx, request, async () => {
          const id = await enqueueOutbox(tx, { type: 'probe.created', payload: { n: body.n } })
          if (body.n < 0) throw new Error('boom')
          return { statusCode: 201, body: envelope({ id, n: body.n }) }
        }),
      )
      return sendIdempotent(reply, result)
    })
  },
}

let app: FastifyInstance
let user: TestUser
let otherTenantUser: TestUser
const URL_A = '/v1/probe/things/00000000-0000-4000-8000-000000000001'

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  user = await createSignedInUser({ tenantId: (await createTenant()).id })
  otherTenantUser = await createSignedInUser({ tenantId: (await createTenant()).id })
  app = await buildTestApp({ modules: [probe] })
})

afterAll(async () => {
  await app.close()
})

const sideEffects = async () => (await ownerRows(`SELECT 1 FROM outbox_event WHERE topic = 'probe.created'`)).length
const post = (as: TestUser, url: string, n: number, key?: string) =>
  call(app, { method: 'POST', url, as, body: { n }, ...(key === undefined ? {} : { idempotencyKey: key }) })

describe('idempotent()', () => {
  test('the same key and request replays the stored response without a second side effect', async () => {
    const before = await sideEffects()

    const first = await post(user, URL_A, 1, 'key-1')
    const replay = await post(user, URL_A, 1, 'key-1')

    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(first.headers['idempotent-replayed']).toBeUndefined()
    expect(await sideEffects()).toBe(before + 1)
  })

  test('the same key with a different body or path is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await post(user, URL_A, 1, 'key-2')

    const otherBody = await post(user, URL_A, 2, 'key-2')
    const otherPath = await post(user, '/v1/probe/things/00000000-0000-4000-8000-000000000002', 1, 'key-2')

    expect(otherBody.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(otherPath.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  test('keys are per tenant: another tenant may use the same key', async () => {
    await post(user, URL_A, 1, 'shared-key')

    const other = await post(otherTenantUser, URL_A, 1, 'shared-key')

    expect(other.statusCode).toBe(201)
    expect(other.headers['idempotent-replayed']).toBeUndefined()
  })

  test('a concurrent duplicate waits for the first request and replays its response', async () => {
    const before = await sideEffects()

    const [first, second] = await Promise.all([post(user, URL_A, 5, 'key-race'), post(user, URL_A, 5, 'key-race')])

    expect([first.statusCode, second.statusCode]).toEqual([201, 201])
    expect(first.json()).toEqual(second.json())
    expect([first, second].filter((response) => response.headers['idempotent-replayed'] === 'true')).toHaveLength(1)
    expect(await sideEffects()).toBe(before + 1)
  })

  test('a failed first attempt leaves no key behind, so a retry runs', async () => {
    const failed = await post(user, URL_A, -1, 'key-3')
    const keys = await ownerRows(`SELECT 1 FROM idempotency_key WHERE key = 'key-3'`)

    expect(failed.statusCode).toBe(500)
    expect(keys).toEqual([])
  })

  test('a missing or malformed key is 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const missing = await post(user, URL_A, 1)
    const spaced = await post(user, URL_A, 1, 'has space')

    expect(missing.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(spaced.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })
})
