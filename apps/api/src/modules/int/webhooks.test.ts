import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { createIntModule } from './index.js'

let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let adminWithoutStepUp: TestUser
let analyst: TestUser
let globexAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  adminWithoutStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [createIntModule()] })
})

afterAll(async () => {
  await app.close()
})

const HOOK_URL = 'https://hooks.example.com/nmp'
const endpointBody = (overrides: Record<string, unknown> = {}) => ({ url: HOOK_URL, topics: ['compliance.snapshot.ready'], ...overrides })
const create = (body: Record<string, unknown> = endpointBody(), as: TestUser = admin, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: '/v1/webhook-endpoints', as, body, idempotencyKey })

async function endpoint(as: TestUser = admin): Promise<string> {
  const response = await create(endpointBody(), as)
  expect(response.statusCode).toBe(201)
  return response.json().data.endpoint.id as string
}

describe('GET /v1/webhook-topics', () => {
  test('lists the subscribable topics and their payload fields', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/webhook-topics', as: admin })

    expect(response.json().data).toEqual([
      expect.objectContaining({ topic: 'compliance.snapshot.ready', payload_fields: ['snapshot_id', 'market_id'] }),
      expect.objectContaining({ topic: 'market.went_live', payload_fields: ['market_id', 'code'] }),
      expect.objectContaining({ topic: 'case.decided', payload_fields: ['case_id', 'type', 'decision'] }),
      expect.objectContaining({ topic: 'order.ingested', payload_fields: ['order_id', 'market_id', 'source_system'] }),
      expect.objectContaining({ topic: 'genealogy.changed', payload_fields: ['kind', 'child_position_id', 'valid_from', 'event_type'] }),
      expect.objectContaining({ topic: 'run.committed', payload_fields: ['run_id', 'period_id', 'gross_minor'] }),
      expect.objectContaining({ topic: 'plan.version.activated', payload_fields: ['plan_id', 'plan_version_id', 'effective_from'] }),
      expect.objectContaining({ topic: 'payout.batch.approved', payload_fields: ['batch_id', 'market_id', 'total_minor'] }),
      expect.objectContaining({ topic: 'payout.settled', payload_fields: ['instruction_id', 'batch_id', 'participant_id', 'amount_minor'] }),
      expect.objectContaining({ topic: 'payout.returned', payload_fields: ['instruction_id', 'batch_id', 'participant_id', 'amount_minor', 'case_id'] }),
    ])
    expect((await call(app, { method: 'GET', url: '/v1/webhook-topics', as: analyst })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/webhook-topics' })).statusCode).toBe(401)
  })
})

describe('POST /v1/webhook-endpoints', () => {
  test('shows the secret once and stores it sealed; a replay returns the endpoint without it; audited', async () => {
    const key = randomUUID()
    const first = await create(endpointBody({ description: 'Warehouse' }), admin, key)
    const replay = await create(endpointBody({ description: 'Warehouse' }), admin, key)
    const { endpoint: created, secret, secret_shown: shown } = first.json().data
    const [stored] = await ownerRows<{ secret_sealed: string }>('SELECT secret_sealed FROM webhook_endpoint WHERE id = $1', [created.id])

    expect(first.statusCode).toBe(201)
    expect(shown).toBe(true)
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/)
    expect(created).toMatchObject({
      url: HOOK_URL, description: 'Warehouse', topics: ['compliance.snapshot.ready'], state: 'active', secret_rotation_ends_at: null,
      last_delivery: null, created_by: { id: admin.id, display_name: null },
    })
    expect(stored!.secret_sealed).not.toContain(secret.slice('whsec_'.length))
    expect(replay.json().data).toEqual({ endpoint: created, secret_shown: false })
    expect(JSON.stringify(await ownerRows('SELECT response FROM idempotency_key WHERE key = $1', [key]))).not.toContain(secret)
    expect(await ownerRows('SELECT action FROM audit.audit_event WHERE object_id = $1', [created.id])).toEqual([{ action: 'WEBHOOK_ENDPOINT.CREATED' }])
  })

  test.each([
    ['http://hooks.example.com/x', 'NOT_HTTPS'],
    ['https://127.0.0.1/x', 'ADDRESS_BLOCKED'],
    ['https://[::1]/x', 'ADDRESS_BLOCKED'],
    ['https://169.254.169.254/x', 'ADDRESS_BLOCKED'],
    ['https://10.0.0.5/x', 'ADDRESS_BLOCKED'],
    ['https://localhost/x', 'NAME_BLOCKED'],
    ['https://x.internal/x', 'NAME_BLOCKED'],
    ['https://h:8080/x', 'PORT_NOT_ALLOWED'],
    ['https://u:p@hooks.example.com/x', 'USERINFO'],
    [`https://hooks.example.com/${'é'.repeat(400)}`, 'INVALID_URL'], // within 2048 as typed, over it encoded (é is %C3%A9)
  ])('refuses %s with 422 WEBHOOK_URL_NOT_ALLOWED (%s)', async (url, reason) => {
    const response = await create(endpointBody({ url }))

    expect(response.statusCode).toBe(422)
    expect(response.json().error).toMatchObject({ code: 'WEBHOOK_URL_NOT_ALLOWED', details: { reason } })
  })

  test('refuses unknown and internal topics, needs step-up and integration.manage', async () => {
    const unknown = await create(endpointBody({ topics: ['compliance.snapshot.ready', 'orders.created', 'webhook.test'] }))

    expect(unknown.json().error).toMatchObject({ code: 'TOPIC_UNKNOWN', details: { topics: ['orders.created', 'webhook.test'] } })
    expect((await create(endpointBody(), adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await create(endpointBody(), analyst)).json().error.code).toBe('PERMISSION_DENIED')
    expect((await create(endpointBody({ topics: [] }))).statusCode).toBe(400)
  })

  test('an endpoint receives every market\'s events: a manager limited to one market gets 403 SCOPE_NOT_HELD', async () => {
    const scoped = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [await createMarket(acme.id, 'GB')], stepUp: true })

    expect((await create(endpointBody(), scoped)).json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'integration.manage' } })
    expect((await call(app, { method: 'GET', url: '/v1/webhook-endpoints', as: scoped })).json().error.code).toBe('SCOPE_NOT_HELD')
  })
})

describe('reading and changing endpoints', () => {
  test('list and detail show own endpoints only; another tenant gets 404', async () => {
    const id = await endpoint()
    const globexId = await endpoint(globexAdmin)
    const list = await call(app, { method: 'GET', url: '/v1/webhook-endpoints?limit=200', as: admin })

    expect(list.json().data.map((row: { id: string }) => row.id)).toContain(id)
    expect(list.json().data.map((row: { id: string }) => row.id)).not.toContain(globexId)
    expect((await call(app, { method: 'GET', url: `/v1/webhook-endpoints/${id}`, as: admin })).json().data.id).toBe(id)
    expect((await call(app, { method: 'GET', url: `/v1/webhook-endpoints/${id}`, as: globexAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/webhook-endpoints/${id}`, as: analyst })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: '/v1/webhook-endpoints', as: analyst })).statusCode).toBe(403)
  })

  test('PATCH changes url, topics, description and state with the save-time rules; disabling cancels scheduled attempts', async () => {
    const id = await endpoint()
    const patch = (body: Record<string, unknown>, as: TestUser = admin) => call(app, { method: 'PATCH', url: `/v1/webhook-endpoints/${id}`, as, body })
    const [event] = await ownerRows<{ id: string }>(
      `INSERT INTO outbox_event (tenant_id, topic, key, payload, dispatched_at) VALUES ($1, 'compliance.snapshot.ready', 'k', '{}', now()) RETURNING id`,
      [acme.id],
    )
    await ownerRows(
      `INSERT INTO webhook_delivery (tenant_id, endpoint_id, outbox_event_id, attempt, outcome, next_attempt_at) VALUES ($1, $2, $3, 1, 'scheduled', now())`,
      [acme.id, id, event!.id],
    )

    const changed = await patch({ url: 'HTTPS://Hooks.Example.ORG:443/v2', topics: ['market.went_live', 'case.decided'], description: null })
    expect(changed.json().data).toMatchObject({ url: 'https://hooks.example.org/v2', topics: ['market.went_live', 'case.decided'], description: null })
    expect((await patch({ url: 'https://10.1.1.1/x' })).json().error.details.reason).toBe('ADDRESS_BLOCKED')
    expect((await patch({ topics: ['nope'] })).json().error.code).toBe('TOPIC_UNKNOWN')
    expect((await patch({})).statusCode).toBe(400)
    expect((await patch({ state: 'disabled' }, globexAdmin)).statusCode).toBe(404)
    expect((await patch({ state: 'disabled' }, analyst)).statusCode).toBe(403)

    expect((await patch({ state: 'disabled' })).json().data.state).toBe('disabled')
    expect(await ownerRows('SELECT outcome, error FROM webhook_delivery WHERE endpoint_id = $1', [id]))
      .toEqual([{ outcome: 'cancelled', error: 'ENDPOINT_DISABLED' }])
    expect((await patch({ state: 'active' }, adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await patch({ state: 'active' })).json().data.state).toBe('active')
    const audit = await ownerRows<{ action: string; before: { url: string } | null; after: { url: string } }>(
      `SELECT action, before_ref::jsonb AS before, after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE object_id = $1 ORDER BY seq`, [id],
    )
    expect(audit.map((row) => row.action)).toEqual([
      'WEBHOOK_ENDPOINT.CREATED', 'WEBHOOK_ENDPOINT.UPDATED', 'WEBHOOK_ENDPOINT.UPDATED', 'WEBHOOK_ENDPOINT.UPDATED',
    ])
    expect(audit[0]!.after.url).toBe(HOOK_URL)
    expect(audit[1]).toMatchObject({ before: { url: HOOK_URL }, after: { url: 'https://hooks.example.org/v2' } })
  })

  test('PATCH to a new URL or back to active needs step-up; other changes do not', async () => {
    const id = await endpoint()
    const patch = (body: Record<string, unknown>) => call(app, { method: 'PATCH', url: `/v1/webhook-endpoints/${id}`, as: adminWithoutStepUp, body })

    expect((await patch({ url: 'https://attacker.example.net/collect' })).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await patch({ state: 'disabled' })).statusCode).toBe(200)
    expect((await patch({ state: 'active' })).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await patch({ topics: ['market.went_live'], description: 'BI' })).statusCode).toBe(200)
    expect(await ownerRows('SELECT url, state FROM webhook_endpoint WHERE id = $1', [id])).toEqual([{ url: HOOK_URL, state: 'disabled' }])
  })
})

describe('POST /v1/webhook-endpoints/:id/rotate-secret', () => {
  test('a new secret once; the old one stays for the grace; needs step-up; refused while disabled', async () => {
    const id = await endpoint()
    const rotate = (grace: number, as: TestUser = admin, idempotencyKey: true | string = true) =>
      call(app, { method: 'POST', url: `/v1/webhook-endpoints/${id}/rotate-secret`, as, body: { grace_minutes: grace }, idempotencyKey })
    const key = randomUUID()

    const rotated = await rotate(30, admin, key)
    const replay = await rotate(30, admin, key)
    const [row] = await ownerRows<{ previous_secret_sealed: string | null }>('SELECT previous_secret_sealed FROM webhook_endpoint WHERE id = $1', [id])

    expect(rotated.statusCode).toBe(200)
    expect(rotated.json().data.secret).toMatch(/^whsec_/)
    expect(Date.parse(rotated.json().data.endpoint.secret_rotation_ends_at) - Date.now()).toBeGreaterThan(29 * 60_000)
    expect(row!.previous_secret_sealed).not.toBeNull()
    expect(replay.json().data).toEqual({ endpoint: rotated.json().data.endpoint, secret_shown: false })
    expect((await rotate(0)).json().data.endpoint.secret_rotation_ends_at).toBeNull()
    expect((await rotate(0, adminWithoutStepUp)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await rotate(0, globexAdmin)).statusCode).toBe(404)
    expect((await rotate(20_000)).statusCode).toBe(400)
    await call(app, { method: 'PATCH', url: `/v1/webhook-endpoints/${id}`, as: admin, body: { state: 'disabled' } })
    expect((await rotate(0)).json().error.code).toBe('ENDPOINT_DISABLED')
  })
})

describe('POST /v1/webhook-endpoints/:id/test', () => {
  test('queues a webhook.test event for this endpoint; refused while disabled; another tenant gets 404', async () => {
    const id = await endpoint()
    const send = (as: TestUser = admin) => call(app, { method: 'POST', url: `/v1/webhook-endpoints/${id}/test`, as, body: {}, idempotencyKey: true })

    const sent = await send()
    expect(sent.statusCode).toBe(202)
    expect(await ownerRows('SELECT topic, payload FROM outbox_event WHERE id = $1', [sent.json().data.event_id]))
      .toEqual([{ topic: 'webhook.test', payload: { endpoint_id: id } }])
    expect((await send(globexAdmin)).statusCode).toBe(404)
    expect((await send(analyst)).statusCode).toBe(403)
    await call(app, { method: 'PATCH', url: `/v1/webhook-endpoints/${id}`, as: admin, body: { state: 'disabled' } })
    expect((await send()).json().error.code).toBe('ENDPOINT_DISABLED')
  })
})
