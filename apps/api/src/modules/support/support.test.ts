import { randomUUID } from 'node:crypto'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, testConfig,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { PERMISSIONS } from '../../lib/permissions.js'
import { expireSupportSessionsJob } from './expiry.js'
import { supportModule } from './index.js'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let admin: TestUser
let adminWithoutStepUp: TestUser
let analyst: TestUser
let globexAdmin: TestUser
let engineer: TestUser
let otherEngineer: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  adminWithoutStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  engineer = await createSignedInUser({ tenantId: null })
  otherEngineer = await createSignedInUser({ tenantId: null })
  await ownerRows(`UPDATE user_account SET work_region = 'eu' WHERE id = ANY ($1)`, [[engineer.id, otherEngineer.id]])
  app = await buildTestApp({ modules: [supportModule] })
})

afterAll(async () => {
  await app.close()
})

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  tenant: acme.id, reason: 'Ticket 42: an import fails', scope: { permissions: ['audit.read'] }, minutes: 60, ...overrides,
})
const fileRequest = (overrides: Record<string, unknown> = {}, as: TestUser = engineer, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: '/v1/support-sessions', as, body: requestBody(overrides), idempotencyKey })
const decide = (id: string, body: Record<string, unknown>, as: TestUser = admin) =>
  call(app, { method: 'POST', url: `/v1/support-sessions/${id}/decision`, as, body, idempotencyKey: true })
const end = (id: string, as: TestUser) => call(app, { method: 'POST', url: `/v1/support-sessions/${id}/end`, as })

async function requested(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await fileRequest(overrides)
  expect(response.statusCode).toBe(201)
  return response.json().data.id as string
}

async function approved(minutes = 60): Promise<string> {
  const id = await requested()
  expect((await decide(id, { approved: true, minutes })).statusCode).toBe(200)
  return id
}

const vendorActions = async (objectId: string) =>
  (await ownerRows<{ action: string }>('SELECT action FROM audit.vendor_event WHERE object_id = $1 ORDER BY seq', [objectId]))
    .map((row) => row.action)
const tenantActionsFor = async (objectId: string) =>
  (await ownerRows<{ action: string }>('SELECT action FROM audit.audit_event WHERE object_id = $1 ORDER BY seq', [objectId]))
    .map((row) => row.action)

describe('GET /v1/support-sessions/limits', () => {
  test('gives vendor users what a request may ask for, the limits the request is checked against; tenant users are refused', async () => {
    const limits = await call(app, { method: 'GET', url: '/v1/support-sessions/limits', as: engineer })
    const { max_minutes: maxMinutes, scopes } = limits.json().data as { max_minutes: number; scopes: string[] }
    const longest = await fileRequest({ minutes: maxMinutes, scope: { permissions: scopes.slice(0, 20) } })
    const tooLong = await fileRequest({ minutes: maxMinutes + 1 })
    const outOfScope = await fileRequest({ scope: { permissions: ['participant.unmask'] } })

    expect(limits.json().data).toEqual({ max_minutes: 480, scopes: PERMISSIONS.filter((permission) => permission !== 'participant.unmask') })
    expect(longest.statusCode).toBe(201)
    expect([tooLong.statusCode, outOfScope.statusCode]).toEqual([400, 400])
    expect((await call(app, { method: 'GET', url: '/v1/support-sessions/limits', as: admin })).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await call(app, { method: 'GET', url: '/v1/support-sessions/limits' })).statusCode).toBe(401)
  })
})

describe('POST /v1/support-sessions (vendor request)', () => {
  test('files a request, logs it in both logs and notifies the tenant', async () => {
    const response = await fileRequest()
    const session = response.json().data
    const outbox = await ownerRows('SELECT topic FROM outbox_event WHERE tenant_id = $1 AND key = $2', [acme.id, session.id])

    expect(response.statusCode).toBe(201)
    expect(session).toMatchObject({
      tenant_id: acme.id, tenant_slug: acme.slug, requester_id: engineer.id, state: 'requested', requested_minutes: 60,
      scope: { permissions: ['audit.read'], requester_region: 'eu' }, decided_by: null, starts_at: null, ends_at: null,
    })
    expect(await vendorActions(session.id)).toEqual(['SUPPORT_SESSION.REQUESTED'])
    expect(await tenantActionsFor(session.id)).toEqual(['SUPPORT_SESSION.REQUESTED'])
    expect(outbox).toEqual([{ topic: 'support_session.requested' }])
  })

  test('replays the same request under the same key; another request under that key is refused', async () => {
    const key = randomUUID()
    const first = await fileRequest({}, engineer, key)
    const again = await fileRequest({}, engineer, key)
    const different = await fileRequest({ minutes: 30 }, engineer, key)
    const sameKeyOtherVendor = await fileRequest({}, otherEngineer, key)
    const missingKey = await call(app, { method: 'POST', url: '/v1/support-sessions', as: engineer, body: requestBody() })

    expect(again.statusCode).toBe(201)
    expect(again.headers['idempotent-replayed']).toBe('true')
    expect(again.json().data.id).toBe(first.json().data.id)
    expect(different.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(sameKeyOtherVendor.json().data.id).not.toBe(first.json().data.id)
    expect(missingKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(await vendorActions(first.json().data.id)).toEqual(['SUPPORT_SESSION.REQUESTED'])
  })

  test('validates the request: scope, duration, tenant state, a decider in the tenant', async () => {
    const provisioning = await createTenant({ state: 'provisioning' })
    const withoutAdmin = await createTenant()

    const unmask = await fileRequest({ scope: { permissions: ['participant.unmask'] } })
    const tooLong = await fileRequest({ minutes: 481 })
    const unknownTenant = await fileRequest({ tenant: randomUUID() })
    const notReady = await fileRequest({ tenant: provisioning.id })
    const noDecider = await fileRequest({ tenant: withoutAdmin.id })

    expect([unmask.statusCode, tooLong.statusCode]).toEqual([400, 400])
    expect(unknownTenant.json().error.code).toBe('NOT_FOUND')
    expect(notReady.json().error.code).toBe('TENANT_NOT_AVAILABLE')
    expect(noDecider.json().error.code).toBe('TENANT_HAS_NO_ADMIN')
    expect(await ownerRows('SELECT id FROM support_session WHERE tenant_id = $1', [withoutAdmin.id])).toEqual([])
  })

  test('is for vendor users only', async () => {
    const response = await fileRequest({}, admin)

    expect(response.json().error.code).toBe('REALM_FORBIDDEN')
  })
})

describe('POST /v1/support-sessions/:id/decision', () => {
  test('approval opens a window of the approved minutes, recorded with the second factor', async () => {
    const id = await requested({ minutes: 120 })

    const response = await decide(id, { approved: true, minutes: 45, reason: 'Go ahead' })
    const session = response.json().data
    const [event] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE object_id = $1 AND action = 'SUPPORT_SESSION.APPROVED'`, [id])

    expect(response.statusCode).toBe(200)
    expect(session).toMatchObject({ state: 'approved', decided_by: admin.id })
    expect(Date.parse(session.ends_at) - Date.parse(session.starts_at)).toBe(45 * 60_000)
    expect(JSON.parse(event!.after_ref)).toMatchObject({ after: { minutes: 45, region_approved: false }, reason: 'Go ahead' })
    expect(JSON.parse(event!.after_ref).after.factor_verified_at).not.toBeNull()
    expect((await decide(id, { approved: false })).json().error.code).toBe('REQUEST_ALREADY_DECIDED')
  })

  test('denial records the decider and opens nothing', async () => {
    const id = await requested()

    const session = (await decide(id, { approved: false })).json().data

    expect(session).toMatchObject({ state: 'denied', decided_by: admin.id, starts_at: null, ends_at: null })
    expect(await tenantActionsFor(id)).toEqual(['SUPPORT_SESSION.REQUESTED', 'SUPPORT_SESSION.DENIED'])
  })

  test('refuses a longer window, unheld scope and an expired request', async () => {
    const id = await requested({ minutes: 30 })
    const exportScope = await requested({ scope: { permissions: ['audit.read', 'export'] } })
    const stale = await requested()
    await ownerRows(`UPDATE support_session SET created_at = now() - interval '25 hours' WHERE id = $1`, [stale])

    const longer = await decide(id, { approved: true, minutes: 31 })
    const noMinutes = await decide(id, { approved: true })
    const unheld = await decide(exportScope, { approved: true, minutes: 30 })
    const expired = await decide(stale, { approved: true, minutes: 30 })

    expect(longer.json().error.code).toBe('SUPPORT_SESSION_DURATION_INVALID')
    expect(noMinutes.json().error.code).toBe('VALIDATION_FAILED')
    expect(unheld.json().error.code).toBe('SUPPORT_SCOPE_NOT_HELD')
    expect(expired.json().error.code).toBe('SUPPORT_REQUEST_EXPIRED')
  })

  test('the requester region is the one recorded for the vendor user, never the request\'s (AC-31.1, TS-57)', async () => {
    const remote = await createSignedInUser({ tenantId: null })
    const unknown = await createSignedInUser({ tenantId: null })
    await ownerRows(`UPDATE user_account SET work_region = 'ap-south-1' WHERE id = $1`, [remote.id])

    const claimed = await fileRequest({ region: 'eu' }, remote)
    const fromRemote = (await fileRequest({}, remote)).json().data
    const fromUnknown = (await fileRequest({}, unknown)).json().data
    const remoteDecision = await decide(fromRemote.id, { approved: true, minutes: 30 })
    const unknownDecision = await decide(fromUnknown.id, { approved: true, minutes: 30 })
    const regionApproved = await decide(fromRemote.id, { approved: true, minutes: 30, region_approved: true })

    expect(claimed.json().error.code).toBe('VALIDATION_FAILED')
    expect(fromRemote.scope.requester_region).toBe('ap-south-1')
    expect(remoteDecision.json().error).toMatchObject({ code: 'REGION_APPROVAL_REQUIRED', details: { requester_region: 'ap-south-1', tenant_region: 'eu' } })
    expect(unknownDecision.json().error).toMatchObject({ code: 'REGION_APPROVAL_REQUIRED', details: { requester_region: null, tenant_region: 'eu' } })
    expect(regionApproved.json().data.state).toBe('approved')
  })

  test('needs vendor_access.decide, a fresh second factor and the tenant realm; another tenant gets 404', async () => {
    const id = await requested()

    const byAnalyst = await decide(id, { approved: false }, analyst)
    const withoutStepUp = await decide(id, { approved: false }, adminWithoutStepUp)
    const byVendor = await decide(id, { approved: false }, engineer)
    const byOtherTenant = await decide(id, { approved: false }, globexAdmin)

    expect(byAnalyst.json().error.code).toBe('PERMISSION_DENIED')
    expect(withoutStepUp.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(byVendor.json().error.code).toBe('REALM_FORBIDDEN')
    expect(byOtherTenant.statusCode).toBe(404)
    expect((await ownerRows('SELECT state FROM support_session WHERE id = $1', [id]))[0]).toEqual({ state: 'requested' })
  })
})

describe('GET /v1/support-sessions', () => {
  test('the vendor sees every tenant, a tenant its own; pages by cursor', async () => {
    const globexSession = await requested({ tenant: globex.id })
    const page1 = await call(app, { method: 'GET', url: '/v1/support-sessions?limit=1', as: engineer })
    const page2 = await call(app, { method: 'GET', url: `/v1/support-sessions?limit=1&cursor=${page1.json().meta.next_cursor}`, as: engineer })
    const vendorAll = await call(app, { method: 'GET', url: '/v1/support-sessions?limit=200', as: engineer })
    const acmeAll = await call(app, { method: 'GET', url: '/v1/support-sessions?limit=200&state=requested', as: admin })
    const ids = (response: typeof page1) => response.json().data.map((row: { id: string }) => row.id)

    expect(ids(page1)).toEqual([globexSession])
    expect(ids(page2)).toHaveLength(1)
    expect(ids(page2)).not.toEqual(ids(page1))
    expect(ids(vendorAll)).toContain(globexSession)
    expect(ids(acmeAll)).not.toContain(globexSession)
    expect(acmeAll.json().data.every((row: { tenant_id: string; state: string }) => row.tenant_id === acme.id && row.state === 'requested')).toBe(true)
  })

  test('one session: 404 for another tenant, 403 without vendor_access.decide', async () => {
    const id = await requested()

    expect((await call(app, { method: 'GET', url: `/v1/support-sessions/${id}`, as: admin })).json().data.id).toBe(id)
    expect((await call(app, { method: 'GET', url: `/v1/support-sessions/${id}`, as: engineer })).json().data.id).toBe(id)
    expect((await call(app, { method: 'GET', url: `/v1/support-sessions/${id}`, as: globexAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/support-sessions', as: analyst })).json().error.code).toBe('PERMISSION_DENIED')
  })
})

describe('POST /v1/support-sessions/:id/end', () => {
  test('the vendor ends its active session, logged in both logs', async () => {
    const id = await approved()
    await ownerRows(`UPDATE support_session SET state = 'active' WHERE id = $1`, [id])

    const response = await end(id, engineer)

    expect(response.json().data.state).toBe('ended')
    expect(Date.parse(response.json().data.ends_at)).toBeLessThanOrEqual(Date.now())
    expect(await vendorActions(id)).toEqual(['SUPPORT_SESSION.REQUESTED', 'SUPPORT_SESSION.ENDED'])
    expect((await tenantActionsFor(id)).at(-1)).toBe('SUPPORT_SESSION.ENDED')
  })

  test('only the requester ends it in the vendor realm', async () => {
    const id = await approved()
    await ownerRows(`UPDATE support_session SET state = 'active' WHERE id = $1`, [id])

    const byOtherEngineer = await end(id, otherEngineer)

    expect(byOtherEngineer.json().error.code).toBe('PERMISSION_DENIED')
    expect(await ownerRows('SELECT state FROM support_session WHERE id = $1', [id])).toEqual([{ state: 'active' }])
    expect(await vendorActions(id)).toEqual(['SUPPORT_SESSION.REQUESTED'])
  })

  test('the tenant ends an approved session at once; the vendor cannot end one it never used', async () => {
    const id = await approved()

    const byVendor = await end(id, engineer)
    const byOtherTenant = await end(id, globexAdmin)
    const byAnalyst = await end(id, analyst)
    const byAdmin = await end(id, adminWithoutStepUp)

    expect(byVendor.json().error.code).toBe('SUPPORT_SESSION_NOT_OPEN')
    expect(byOtherTenant.statusCode).toBe(404)
    expect(byAnalyst.json().error.code).toBe('PERMISSION_DENIED')
    expect(byAdmin.json().data.state).toBe('ended')
    expect((await end(id, admin)).json().error.code).toBe('SUPPORT_SESSION_NOT_OPEN')
    expect((await end(randomUUID(), engineer)).statusCode).toBe(404)
  })
})

describe('GET /v1/support-sessions/:id/log', () => {
  test('the tenant reads everything about the session; nobody else does', async () => {
    const id = await approved()

    const log = await call(app, { method: 'GET', url: `/v1/support-sessions/${id}/log`, as: admin })

    expect(log.json().data.map((event: { action: string }) => event.action)).toEqual(['SUPPORT_SESSION.APPROVED', 'SUPPORT_SESSION.REQUESTED'])
    expect(log.json().data[1]).toMatchObject({ actor_type: 'vendor_user', actor_id: engineer.id, reason: 'Ticket 42: an import fails' })
    expect((await call(app, { method: 'GET', url: `/v1/support-sessions/${id}/log`, as: globexAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/support-sessions/${id}/log`, as: analyst })).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/support-sessions/${id}/log`, as: engineer })).json().error.code).toBe('REALM_FORBIDDEN')
  })
})

describe('auto-expiry job', () => {
  test('expires run-out windows and auto-denies stale requests, audited with a session report', async () => {
    const active = await approved()
    const unused = await approved()
    const stale = await requested()
    const fresh = await requested()
    const window = `starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour'`
    await ownerRows(`UPDATE support_session SET state = 'active', ${window} WHERE id = $1`, [active])
    await ownerRows(`UPDATE support_session SET ${window} WHERE id = $1`, [unused])
    await ownerRows(`UPDATE support_session SET created_at = now() - interval '25 hours' WHERE id = $1`, [stale])

    await expireSupportSessionsJob.run({ jobId: randomUUID(), log: fastify({ logger: false }).log, config: testConfig() })
    const states = await ownerRows<{ id: string; state: string; decided_by: string | null }>(
      'SELECT id, state, decided_by FROM support_session WHERE id = ANY ($1)', [[active, unused, stale, fresh]])
    const byId = new Map(states.map((row) => [row.id, row]))

    expect(byId.get(active)?.state).toBe('expired')
    expect(byId.get(unused)?.state).toBe('expired')
    expect(byId.get(stale)).toMatchObject({ state: 'denied', decided_by: null })
    expect(byId.get(fresh)?.state).toBe('requested')
    expect((await tenantActionsFor(active)).at(-1)).toBe('SUPPORT_SESSION.EXPIRED')
    expect((await tenantActionsFor(stale)).at(-1)).toBe('SUPPORT_SESSION.AUTO_DENIED')
    expect(await ownerRows(`SELECT topic FROM outbox_event WHERE key = $1 AND topic = 'support_session.closed'`, [stale])).toHaveLength(1)
    expect(await auditActions(acme.id)).toContain('SUPPORT_SESSION.EXPIRED')
  })
})
