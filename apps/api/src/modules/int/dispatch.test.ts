import { createHmac, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, testConfig, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { DISPATCH_JOB_NAME, dispatchWebhooks } from './dispatch.js'
import { createIntModule } from './index.js'
import { TEST_TLS_CERT, TEST_TLS_HOST, TEST_TLS_KEY } from '../../../test/helpers/test-tls.js'
import { httpsTransport, type DeliveryRequest, type DeliveryResult, type WebhookResolver, type WebhookTransport } from './transport.js'

const PUBLIC_ADDRESS = '93.184.216.34'
const SNAPSHOT_READY = 'compliance.snapshot.ready'

// Fake network: each test host answers as configured; every request is recorded. TEST_TLS_HOST goes to a real
// local TLS server through the production transport.
const answers = new Map<string, () => DeliveryResult>()
const addresses = new Map<string, readonly string[]>()
const sent: DeliveryRequest[] = []
let tlsServer: Server
let tlsPort: number
let received: { headers: Record<string, string | string[] | undefined>; body: string }[] = []
let tlsStatus = 204
let tlsTransport: WebhookTransport

const resolver: WebhookResolver = async (host) => {
  const found = addresses.get(host)
  if (found === undefined) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
  return found.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}

const transport: WebhookTransport = async (request) => {
  sent.push(request)
  if (request.host === TEST_TLS_HOST) return tlsTransport({ ...request, address: { address: '127.0.0.1', family: 4 } })
  return (answers.get(request.host) ?? (() => ({ kind: 'response', status: 200 })))()
}

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let admin: TestUser
let globexAdmin: TestUser
let env: Record<string, string>

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  await ownerRows('UPDATE outbox_event SET dispatched_at = now() WHERE dispatched_at IS NULL')
  tlsServer = createServer({ cert: TEST_TLS_CERT, key: TEST_TLS_KEY }, (request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      received.push({ headers: request.headers, body })
      if (tlsStatus === 302) response.setHeader('location', 'https://169.254.169.254/')
      response.writeHead(tlsStatus).end('ok')
    })
  })
  await new Promise<void>((resolve) => tlsServer.listen(0, '127.0.0.1', resolve))
  tlsPort = (tlsServer.address() as AddressInfo).port
  tlsTransport = httpsTransport({ ca: TEST_TLS_CERT })
  env = { WEBHOOK_ALLOWED_PORTS: `443,${tlsPort}` }
  acme = await createTenant()
  globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [createIntModule({ transport, resolver })], env })
})

// Every test starts with no active endpoint and nothing scheduled, so it sees only its own deliveries.
beforeEach(async () => {
  await ownerRows(`UPDATE webhook_endpoint SET state = 'disabled' WHERE state = 'active'`)
  await ownerRows(`UPDATE webhook_delivery SET outcome = 'cancelled', error = 'ENDPOINT_DISABLED' WHERE outcome = 'scheduled'`)
})

afterAll(async () => {
  await app.close()
  await new Promise((resolve) => tlsServer.close(resolve))
})

function run(overrides: Record<string, string> = {}) {
  const ctx = { jobId: randomUUID(), log: fastify({ logger: false }).log, config: testConfig({ ...env, ...overrides }) }
  return dispatchWebhooks(ctx, { transport, resolver })
}

async function endpoint(host: string, options: { as?: TestUser; topics?: string[]; port?: number; resolvesTo?: readonly string[] } = {}) {
  addresses.set(host, options.resolvesTo ?? [PUBLIC_ADDRESS])
  const url = `https://${host}${options.port === undefined ? '' : `:${options.port}`}/hooks/nmp`
  const response = await call(app, {
    method: 'POST', url: '/v1/webhook-endpoints', as: options.as ?? admin, body: { url, topics: options.topics ?? [SNAPSHOT_READY] }, idempotencyKey: true,
  })
  expect(response.statusCode).toBe(201)
  return { id: response.json().data.endpoint.id as string, secret: response.json().data.secret as string }
}

async function event(tenantId: string, topic = SNAPSHOT_READY): Promise<string> {
  const payload = { snapshot_id: randomUUID(), market_id: randomUUID() }
  const [row] = await ownerRows<{ id: string }>(
    'INSERT INTO outbox_event (tenant_id, topic, key, payload) VALUES ($1, $2, $3, $4) RETURNING id', [tenantId, topic, randomUUID(), payload],
  )
  return row!.id
}

const deliveries = (endpointId: string) =>
  ownerRows<{ attempt: number; outcome: string; status: number | null; error: string | null; next_attempt_at: Date }>(
    'SELECT attempt, outcome, status, error, next_attempt_at FROM webhook_delivery WHERE endpoint_id = $1 ORDER BY attempt', [endpointId],
  )

function verify(secret: string, headers: Readonly<Record<string, unknown>>, body: string): string[] {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const expected = `v1,${createHmac('sha256', key).update(`${String(headers['webhook-id'])}.${String(headers['webhook-timestamp'])}.${body}`).digest('base64')}`
  return String(headers['webhook-signature']).split(' ').filter((signature) => signature === expected)
}

describe('T-B1-19 fan-out and signing', () => {
  test('one signed delivery per subscribed endpoint of the event\'s tenant that existed before it; other topics settle undelivered', async () => {
    const subscribed = await endpoint('a.hooks.example')
    const otherTopic = await endpoint('b.hooks.example', { topics: ['market.went_live'] })
    const globexEndpoint = await endpoint('c.hooks.example', { as: globexAdmin })
    const snapshotEvent = await event(acme.id)
    const internalEvent = await event(acme.id, 'settings.version.created')
    const late = await endpoint('d.hooks.example')
    sent.length = 0

    const result = await run()
    const request = sent.find((entry) => entry.host === 'a.hooks.example')!
    const body = JSON.parse(request.body)

    expect(result.events).toBe(2)
    expect(sent.map((entry) => entry.host)).toEqual(['a.hooks.example'])
    expect(request.address).toEqual({ address: PUBLIC_ADDRESS, family: 4 })
    expect(request.headers['webhook-id']).toBe(snapshotEvent)
    expect(Math.abs(Number(request.headers['webhook-timestamp']) - Date.now() / 1000)).toBeLessThan(60)
    expect(verify(subscribed.secret, request.headers, request.body)).toHaveLength(1)
    expect(body).toEqual({ id: snapshotEvent, type: SNAPSHOT_READY, occurred_at: expect.any(String), tenant: acme.id, data: expect.objectContaining({ snapshot_id: expect.any(String) }) })
    expect(await deliveries(subscribed.id)).toEqual([expect.objectContaining({ attempt: 1, outcome: 'delivered', status: 200, error: null })])
    for (const id of [otherTopic.id, globexEndpoint.id, late.id]) expect(await deliveries(id)).toEqual([])
    expect(await ownerRows('SELECT id FROM outbox_event WHERE id = ANY ($1) AND dispatched_at IS NULL', [[snapshotEvent, internalEvent]])).toEqual([])
    expect((await run()).events).toBe(0)
    expect(await deliveries(subscribed.id)).toHaveLength(1)
  })

  test('T-B1-22: events of one tenant never reach another tenant\'s endpoints', async () => {
    const acmeEndpoint = await endpoint('e.hooks.example')
    const globexEndpoint = await endpoint('f.hooks.example', { as: globexAdmin })
    await event(globex.id)
    sent.length = 0

    await run()

    expect(sent.map((entry) => entry.host)).toEqual(['f.hooks.example'])
    expect(JSON.parse(sent[0]!.body).tenant).toBe(globex.id)
    expect(await deliveries(acmeEndpoint.id)).toEqual([])
    expect(await deliveries(globexEndpoint.id)).toHaveLength(1)
  })

  test('a local TLS server receives the Standard Webhooks request with a verifiable signature; two signatures during a rotation grace', async () => {
    const tls = await endpoint(TEST_TLS_HOST, { port: tlsPort })
    received = []
    tlsStatus = 204
    await event(acme.id)
    await run()

    expect(received).toHaveLength(1)
    expect(received[0]!.headers).toMatchObject({ 'content-type': 'application/json', host: `${TEST_TLS_HOST}:${tlsPort}` })
    expect(verify(tls.secret, received[0]!.headers, received[0]!.body)).toHaveLength(1)
    expect(await deliveries(tls.id)).toEqual([expect.objectContaining({ outcome: 'delivered', status: 204 })])

    const rotated = await call(app, { method: 'POST', url: `/v1/webhook-endpoints/${tls.id}/rotate-secret`, as: admin, body: { grace_minutes: 30 }, idempotencyKey: true })
    received = []
    await event(acme.id)
    await run()
    const signatures = String(received[0]!.headers['webhook-signature']).split(' ')
    expect(signatures).toHaveLength(2)
    expect(verify(rotated.json().data.secret, received[0]!.headers, received[0]!.body)).toHaveLength(1)
    expect(verify(tls.secret, received[0]!.headers, received[0]!.body)).toHaveLength(1)
  })

  test('a redirect is refused and not followed; a TLS name mismatch fails', async () => {
    const tls = await endpoint(TEST_TLS_HOST, { port: tlsPort })
    tlsStatus = 302
    received = []
    await event(acme.id)
    await run()
    tlsStatus = 204

    expect(received).toHaveLength(1)
    expect((await deliveries(tls.id))[0]).toMatchObject({ outcome: 'failed', status: 302, error: 'REDIRECT_REFUSED' })
    const mismatch = await tlsTransport({
      url: new URL(`https://other.example:${tlsPort}/`), host: 'other.example', port: tlsPort, address: { address: '127.0.0.1', family: 4 },
      headers: {}, body: '{}', timeoutMs: 5000,
    })
    expect(mismatch).toEqual({ kind: 'error', error: 'TLS_FAILED' })
  })
})

describe('T-B1-20 failures, backoff, dead letters and retry', () => {
  test('a private address in the DNS answer fails ADDRESS_BLOCKED without a connection; the next attempt is backed off ~1 min', async () => {
    const blocked = await endpoint('g.hooks.example', { resolvesTo: [PUBLIC_ADDRESS, '10.0.0.7'] })
    const mapped = await endpoint('h.hooks.example', { resolvesTo: ['::ffff:127.0.0.1'] })
    const unresolvable = await endpoint('i.hooks.example')
    addresses.delete('i.hooks.example')
    await event(acme.id)
    sent.length = 0

    await run()

    expect(sent).toEqual([])
    const [failed, next] = await deliveries(blocked.id)
    expect(failed).toMatchObject({ attempt: 1, outcome: 'failed', error: 'ADDRESS_BLOCKED', status: null })
    expect(next).toMatchObject({ attempt: 2, outcome: 'scheduled' })
    const delay = next!.next_attempt_at.getTime() - Date.now()
    expect(delay).toBeGreaterThan(50_000)
    expect(delay).toBeLessThan(67_000)
    expect((await deliveries(mapped.id))[0]).toMatchObject({ error: 'ADDRESS_BLOCKED' })
    expect((await deliveries(unresolvable.id))[0]).toMatchObject({ error: 'DNS_FAILED' })
  })

  test('HTTP errors, timeouts and connection failures are retried; past the give-up window the delivery is dead and audited', async () => {
    const failing = await endpoint('j.hooks.example')
    const timeout = await endpoint('k.hooks.example')
    answers.set('j.hooks.example', () => ({ kind: 'response', status: 503 }))
    answers.set('k.hooks.example', () => ({ kind: 'error', error: 'TIMEOUT' }))
    await event(acme.id)

    await run()
    expect((await deliveries(failing.id))[0]).toMatchObject({ outcome: 'failed', status: 503, error: 'HTTP_STATUS' })
    expect((await deliveries(timeout.id))[0]).toMatchObject({ outcome: 'failed', status: null, error: 'TIMEOUT' })

    // Next attempt due now; a first retry two hours away lies beyond a one-hour give-up window: dead.
    await ownerRows(`UPDATE webhook_delivery SET next_attempt_at = now() WHERE endpoint_id = $1 AND outcome = 'scheduled'`, [failing.id])
    await run({ WEBHOOK_GIVE_UP_HOURS: '1', WEBHOOK_RETRY_BASE_SECONDS: '7200' })
    const history = await deliveries(failing.id)
    expect(history.map((row) => [row.attempt, row.outcome])).toEqual([[1, 'failed'], [2, 'dead']])
    const [dead] = await ownerRows<{ id: string }>(`SELECT id FROM webhook_delivery WHERE endpoint_id = $1 AND outcome = 'dead'`, [failing.id])
    expect(await ownerRows('SELECT action, actor_type, actor_id FROM audit.audit_event WHERE object_id = $1', [dead!.id]))
      .toEqual([{ action: 'WEBHOOK.DELIVERY_DEAD', actor_type: 'system', actor_id: null }])

    // Retry now re-opens a dead delivery with a new attempt, sent on the next run.
    answers.delete('j.hooks.example')
    const retried = await call(app, { method: 'POST', url: `/v1/webhook-deliveries/${dead!.id}/retry`, as: admin, body: {}, idempotencyKey: true })
    expect(retried.json().data).toMatchObject({ attempt: 3, outcome: 'scheduled' })
    await run()
    expect((await deliveries(failing.id)).map((row) => row.outcome)).toEqual(['failed', 'dead', 'delivered'])
    const again = await call(app, { method: 'POST', url: `/v1/webhook-deliveries/${dead!.id}/retry`, as: admin, body: {}, idempotencyKey: true })
    expect(again.json().error.code).toBe('DELIVERY_NOT_RETRYABLE')
  })

  test('retry moves a waiting attempt to now; refused for another tenant, without permission and while disabled', async () => {
    const waiting = await endpoint('l.hooks.example')
    answers.set('l.hooks.example', () => ({ kind: 'error', error: 'CONNECTION_FAILED' }))
    await event(acme.id)
    await run()
    const [first] = await ownerRows<{ id: string }>('SELECT id FROM webhook_delivery WHERE endpoint_id = $1 AND attempt = 1', [waiting.id])
    const retry = (as: TestUser) => call(app, { method: 'POST', url: `/v1/webhook-deliveries/${first!.id}/retry`, as, body: {}, idempotencyKey: true })

    expect((await retry(globexAdmin)).statusCode).toBe(404)
    expect((await retry(await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] }))).statusCode).toBe(403)
    const moved = await retry(admin)
    expect(moved.json().data).toMatchObject({ attempt: 2, outcome: 'scheduled' })
    expect(Date.parse(moved.json().data.next_attempt_at)).toBeLessThanOrEqual(Date.now())
    await call(app, { method: 'PATCH', url: `/v1/webhook-endpoints/${waiting.id}`, as: admin, body: { state: 'disabled' } })
    expect((await retry(admin)).json().error.code).toBe('ENDPOINT_DISABLED')
    expect((await deliveries(waiting.id)).map((row) => row.outcome)).toEqual(['failed', 'cancelled'])
  })

  test('the deliveries list is newest first, filters by outcome, and is 404 for another tenant', async () => {
    const listed = await endpoint('m.hooks.example')
    answers.set('m.hooks.example', () => ({ kind: 'response', status: 500 }))
    await event(acme.id)
    await run()
    const url = `/v1/webhook-endpoints/${listed.id}/deliveries`

    const all = await call(app, { method: 'GET', url, as: admin })
    expect(all.json().data.map((row: { attempt: number; outcome: string }) => [row.attempt, row.outcome])).toEqual([[2, 'scheduled'], [1, 'failed']])
    expect(all.json().data[1]).toMatchObject({ status: 500, error: 'HTTP_STATUS', event: { type: SNAPSHOT_READY }, duration_ms: expect.any(Number) })
    expect((await call(app, { method: 'GET', url: `${url}?outcome=failed`, as: admin })).json().data).toHaveLength(1)
    expect((await call(app, { method: 'GET', url: `${url}?limit=1`, as: admin })).json().meta.next_cursor).toEqual(expect.any(String))
    expect((await call(app, { method: 'GET', url, as: globexAdmin })).statusCode).toBe(404)
    const endpointView = await call(app, { method: 'GET', url: `/v1/webhook-endpoints/${listed.id}`, as: admin })
    expect(endpointView.json().data.last_delivery).toMatchObject({ outcome: 'failed' })
  })
})

describe('webhook.test and the job', () => {
  test('a test event goes to its own endpoint only, with data {endpoint_id}', async () => {
    const target = await endpoint('n.hooks.example')
    await endpoint('o.hooks.example')
    const queued = await call(app, { method: 'POST', url: `/v1/webhook-endpoints/${target.id}/test`, as: admin, body: {}, idempotencyKey: true })
    sent.length = 0

    await run()

    expect(sent.map((entry) => entry.host)).toEqual(['n.hooks.example'])
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ id: queued.json().data.event_id, type: 'webhook.test', data: { endpoint_id: target.id } })
  })

  test('attempts start only within the window after the claim; the rest stay leased past it and are not sent twice', async () => {
    const slow = await endpoint('p.hooks.example')
    for (let i = 0; i < 6; i += 1) await event(acme.id)
    // Each send takes longer than the whole start window.
    answers.set('p.hooks.example', () => {
      vi.setSystemTime(Date.now() + 121_000)
      return { kind: 'response', status: 200 }
    })
    sent.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
    let first: { attempts: number }
    let second: { attempts: number }
    try {
      first = await run()
      second = await run()
    } finally {
      vi.useRealTimers()
    }

    expect([first.attempts, second.attempts]).toEqual([4, 0])
    expect(sent).toHaveLength(4)
    expect((await deliveries(slow.id)).map((row) => row.outcome).sort()).toEqual(['delivered', 'delivered', 'delivered', 'delivered', 'scheduled', 'scheduled'])
    const [leased] = await ownerRows<{ count: number }>(
      `SELECT count(*)::int AS count FROM webhook_delivery WHERE endpoint_id = $1 AND outcome = 'scheduled' AND claimed_until > now() + interval '120 seconds'`,
      [slow.id],
    )
    expect(leased!.count).toBe(2)
  })

  test('the module registers the dispatcher as a system job every minute', () => {
    const [job] = createIntModule({ transport, resolver }).jobs!
    expect(job).toMatchObject({ scope: 'system', name: DISPATCH_JOB_NAME, cron: '* * * * *' })
  })
})
