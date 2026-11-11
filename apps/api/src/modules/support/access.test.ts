import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope } from '../../lib/http.js'
import type { ApiModule } from '../../lib/module.js'
import { audModule } from '../aud/index.js'
import { SUPPORT_SESSION_HEADER, supportModule } from './index.js'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let admin: TestUser
let engineer: TestUser
let otherEngineer: TestUser

// Two tenant reads: one that writes an audit event (as an export download does), and one during which the tenant
// presses "End session now" after the hook admitted the request and before the handler's transaction.
const probe: ApiModule = {
  name: 'probe',
  register(scope) {
    const guard = { preHandler: [requireRealm('tenant')] }
    scope.get('/v1/probe/audited-read', guard, async (request) =>
      envelope(await inTenant(request, (tx) => recordAudit(tx, { action: 'TEST.AUDITED_READ' }))))
    scope.get('/v1/probe/ended-mid-request', guard, async (request) => {
      await call(app, { method: 'POST', url: `/v1/support-sessions/${currentAuth(request).supportSessionId}/end`, as: admin })
      return envelope(await inTenant(request, async () => 'served'))
    })
  },
}

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  const globexUser = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  engineer = await createSignedInUser({ tenantId: null })
  otherEngineer = await createSignedInUser({ tenantId: null })
  await ownerRows(`UPDATE user_account SET work_region = 'eu' WHERE id = ANY ($1)`, [[engineer.id, otherEngineer.id]])
  await withTenant({ tenantId: globex.id, userId: globexUser.id }, (tx) => recordAudit(tx, { action: 'TEST.GLOBEX_ONLY' }))
  app = await buildTestApp({ modules: [supportModule, audModule, probe] })
})

afterAll(async () => {
  await app.close()
})

async function session(permissions: string[], approve = true, as: TestUser = engineer): Promise<string> {
  const body = { tenant: acme.id, reason: 'Ticket 7', scope: { permissions }, minutes: 60 }
  const filed = await call(app, { method: 'POST', url: '/v1/support-sessions', as, body, idempotencyKey: true })
  const id = filed.json().data.id as string
  if (approve) {
    const decision = { approved: true, minutes: 30 }
    await call(app, { method: 'POST', url: `/v1/support-sessions/${id}/decision`, as: admin, body: decision, idempotencyKey: true })
  }
  return id
}

const inSession = (id: string, method: 'GET' | 'POST', url: string, as: TestUser = engineer, body?: unknown) =>
  call(app, { method, url, as, headers: { [SUPPORT_SESSION_HEADER]: id }, ...(body === undefined ? {} : { body, idempotencyKey: true }) })

type Log = 'audit.audit_event' | 'audit.vendor_event'

const eventsAbout = (id: string, table: Log) =>
  ownerRows<{ action: string; actor_type: string; actor_id: string; support_session_id: string | null }>(
    `SELECT action, actor_type, actor_id, support_session_id FROM ${table}
     WHERE support_session_id = $1 OR object_id = $1 ORDER BY seq`,
    [id],
  )

const afterOf = async (id: string, table: Log, action: string) =>
  (await ownerRows<{ after_ref: string }>(
    `SELECT after_ref FROM ${table} WHERE (support_session_id = $1 OR object_id = $1) AND action = $2 ORDER BY seq`,
    [id, action],
  )).map((row) => JSON.parse(row.after_ref).after as Record<string, unknown>)

const refusals = async (id: string, table: Log) =>
  (await afterOf(id, table, 'SUPPORT_SESSION.ACCESS_REFUSED')).map((after) => after.refusal)

describe('a vendor user inside an approved support session (AC-29.1, TS-37)', () => {
  test('reads the tenant\'s data, and only that tenant\'s; every request and its query is in the tenant-visible log', async () => {
    const id = await session(['audit.read'])

    const events = await inSession(id, 'GET', '/v1/audit-events?limit=200')
    const stored = await ownerRows<{ state: string }>('SELECT state FROM support_session WHERE id = $1', [id])
    const log = await eventsAbout(id, 'audit.audit_event')
    const actions = events.json().data.map((event: { action: string }) => event.action)

    expect(events.statusCode).toBe(200)
    expect(actions).toContain('SUPPORT_SESSION.ACCESSED')
    expect(actions).not.toContain('TEST.GLOBEX_ONLY')
    expect(stored).toEqual([{ state: 'active' }])
    expect(log.slice(-2)).toEqual([
      { action: 'SUPPORT_SESSION.STARTED', actor_type: 'vendor_user', actor_id: engineer.id, support_session_id: id },
      { action: 'SUPPORT_SESSION.ACCESSED', actor_type: 'vendor_user', actor_id: engineer.id, support_session_id: id },
    ])
    expect(await afterOf(id, 'audit.audit_event', 'SUPPORT_SESSION.ACCESSED')).toEqual([
      { method: 'GET', route: '/v1/audit-events', params: {}, query: { limit: '200' } },
    ])
  })

  test('handlers write their audit events as the vendor user, in the session', async () => {
    const id = await session(['audit.read'])

    const response = await inSession(id, 'GET', '/v1/probe/audited-read')
    const events = await ownerRows(
      `SELECT actor_type, actor_id, support_session_id FROM audit.audit_event WHERE action = 'TEST.AUDITED_READ'`,
    )

    expect(response.statusCode).toBe(200)
    expect(events).toEqual([{ actor_type: 'vendor_user', actor_id: engineer.id, support_session_id: id }])
  })

  test('cannot write: refused and logged in the vendor log and the tenant log', async () => {
    const id = await session(['audit.read'])

    const response = await inSession(id, 'POST', '/v1/audit-exports', engineer, { filters: {} })

    expect(response.json().error.code).toBe('SUPPORT_SESSION_READ_ONLY')
    expect(await refusals(id, 'audit.vendor_event')).toEqual(['SUPPORT_SESSION_READ_ONLY'])
    expect(await refusals(id, 'audit.audit_event')).toEqual(['SUPPORT_SESSION_READ_ONLY'])
    expect(await ownerRows('SELECT id FROM export_job WHERE tenant_id = $1', [acme.id])).toEqual([])
  })

  test('reaches only what the scope grants; an attempt outside it is blocked and logged in both logs', async () => {
    const id = await session(['compliance.read'])

    const response = await inSession(id, 'GET', '/v1/audit-events?action=USER.INVITED')

    expect(response.json().error.code).toBe('PERMISSION_DENIED')
    expect(await afterOf(id, 'audit.audit_event', 'SUPPORT_SESSION.ACCESS_REFUSED')).toEqual([
      { method: 'GET', route: '/v1/audit-events', params: {}, query: { action: 'USER.INVITED' }, refusal: 'PERMISSION_DENIED' },
    ])
    expect(await refusals(id, 'audit.vendor_event')).toEqual(['PERMISSION_DENIED'])
  })

  test('a session the tenant ends while a request is in flight serves nothing more (QA E-SEC-04)', async () => {
    const id = await session(['audit.read'])

    const response = await inSession(id, 'GET', '/v1/probe/ended-mid-request')
    const stored = await ownerRows<{ state: string }>('SELECT state FROM support_session WHERE id = $1', [id])

    expect(response.json().error.code).toBe('SUPPORT_SESSION_INACTIVE')
    expect(stored).toEqual([{ state: 'ended' }])
    expect(await refusals(id, 'audit.audit_event')).toEqual(['SUPPORT_SESSION_INACTIVE'])
    expect(await refusals(id, 'audit.vendor_event')).toEqual(['SUPPORT_SESSION_INACTIVE'])
  })
})

describe('a vendor user without an open session (AC-29.3, AC-57.1)', () => {
  test('gets no tenant data without the session header; the refusal is in the vendor log', async () => {
    const response = await call(app, { method: 'GET', url: '/v1/audit-events?action=USER.INVITED', as: engineer })
    const requestId = response.headers['x-request-id']
    const vendorLog = await ownerRows<{ actor_type: string; actor_id: string; action: string; after_ref: string }>(
      'SELECT actor_type, actor_id, action, after_ref FROM audit.vendor_event WHERE request_id = $1', [requestId])

    expect(response.json().error.code).toBe('REALM_FORBIDDEN')
    expect(vendorLog.map(({ after_ref, ...event }) => ({ ...event, after: JSON.parse(after_ref).after }))).toEqual([{
      actor_type: 'vendor_user', actor_id: engineer.id, action: 'SUPPORT_SESSION.ACCESS_REFUSED',
      after: { method: 'GET', route: '/v1/audit-events', params: {}, query: { action: 'USER.INVITED' }, refusal: 'NO_SESSION' },
    }])
    expect(await ownerRows('SELECT seq FROM audit.audit_event WHERE request_id = $1', [requestId])).toEqual([])
  })

  test('is refused for an undecided request, an expired window and another engineer\'s session, logged in both logs', async () => {
    const undecided = await session(['audit.read'], false)
    const expired = await session(['audit.read'])
    const foreign = await session(['audit.read'], true, otherEngineer)
    await ownerRows(
      `UPDATE support_session SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' WHERE id = $1`,
      [expired],
    )

    for (const id of [undecided, expired, foreign]) {
      const response = await inSession(id, 'GET', '/v1/audit-events')
      expect(response.json().error.code).toBe('SUPPORT_SESSION_INACTIVE')
      expect(await refusals(id, 'audit.vendor_event')).toEqual(['SUPPORT_SESSION_INACTIVE'])
      expect(await refusals(id, 'audit.audit_event')).toEqual(['SUPPORT_SESSION_INACTIVE'])
    }
  })

  test('an unknown session is refused and logged in the vendor log; a malformed id is 400', async () => {
    const unknown = randomUUID()

    const response = await inSession(unknown, 'GET', '/v1/audit-events')
    const malformed = await inSession('not-a-uuid', 'GET', '/v1/audit-events')

    expect(response.json().error.code).toBe('SUPPORT_SESSION_INACTIVE')
    expect((await eventsAbout(unknown, 'audit.vendor_event')).map((event) => event.action)).toEqual(['SUPPORT_SESSION.ACCESS_REFUSED'])
    expect(malformed.statusCode).toBe(400)
  })
})

describe('tenant users', () => {
  test('are unaffected by the header: their own realm and permissions apply', async () => {
    const id = await session(['audit.read'])

    const response = await inSession(id, 'GET', '/v1/audit-events?action=TEST.GLOBEX_ONLY', admin)

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([])
  })
})
