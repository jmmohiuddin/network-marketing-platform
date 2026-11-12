import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { BASE_ROLES, PERMISSIONS } from '../../src/lib/permissions.js'
import { SUPPORT_SESSION_HEADER } from '../../src/modules/support/index.js'
import { multipartBody, tinyFiles } from '../../src/modules/imp/test-support.js'
import {
  baseRoleId, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, ownerRows, resetApiDb, type TestUser,
} from '../helpers/index.js'
import { caseOf, ROUTE_CASES, type CaseRequest, type RouteCase } from './cases.js'
import { routesOf } from './route-registry.js'
import { ALL_ROLES, BREACH_CONTACT, canariesOf, fingerprintOf, PASSWORD, phantomOf, seedTenants, type Seeded, type Targets } from './seed.js'

// TS-21 / SEC-28 / NFR-SEC-01: generated from the routes buildApp() registers, so a new route fails this suite until
// it has a case in cases.ts. Per route: no session, a tenant-B user holding every permission, a vendor user without
// a support session, and the vendor inside tenant A's approved (read-only) support session.
vi.mock('fastify', async (original) => (await import('./route-registry.js')).collecting(await original()))

const uploadDir = await mkdtemp(join(tmpdir(), 'nmp-isolation-'))
vi.stubEnv('UPLOAD_DIR', uploadDir)
const app = await buildTestApp({ env: { API_RATE_LIMIT_PER_MINUTE: '100000', SIGN_IN_RATE_LIMIT_PER_MINUTE: '100000' } })
const routes = routesOf(app)
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

let seeded: Seeded
let targets: Targets
let phantom: Targets
let canaries: readonly string[]
/** What vendor users may see without a session: tenant metadata, support sessions, breach contacts (FR-PRV-004). */
let businessCanaries: readonly string[]

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  seeded = await seedTenants(app)
  targets = seeded.targets
  phantom = phantomOf(targets)
  const found = await canariesOf(seeded.a)
  canaries = [...[...found.values()].flat(), BREACH_CONTACT.email]
  const vendorVisible = new Set(['tenant', 'public.market', 'public.support_session'])
  businessCanaries = [...found].filter(([table]) => !vendorVisible.has(table)).flatMap(([, values]) => values)
    .filter((value) => value !== seeded.owner.id) // the decider of the support session, shown on it
})

afterAll(async () => {
  await app.close()
  vi.unstubAllEnvs()
  await rm(uploadDir, { recursive: true, force: true })
})

const send = (as: TestUser | undefined, request: CaseRequest) => call(app, { ...request, ...(as === undefined ? {} : { as }) })

function caseFor(route: string): RouteCase {
  const found = caseOf(route)
  if (found === undefined) throw new Error(`${route} has no isolation case in test/isolation/cases.ts`)
  return found
}

function errorOf(response: LightMyRequestResponse): { code: string; message: string; details: unknown } | null {
  try {
    const error = (JSON.parse(response.body) as { error?: { code: string; message: string; details: unknown } }).error
    return error === undefined ? null : { code: error.code, message: error.message, details: error.details }
  } catch {
    return null
  }
}

/** `status CODE`; HEAD responses carry no body, so only their status. */
const outcome = (response: LightMyRequestResponse) => `${response.statusCode} ${errorOf(response)?.code ?? ''}`.trim()
const refusal = (request: CaseRequest, status: number, code: string) => (request.method === 'HEAD' ? String(status) : `${status} ${code}`)

/** Values of the given set that the response shows although the request did not send them. */
function leaked(response: LightMyRequestResponse, request: CaseRequest, values: readonly string[]): string[] {
  const body = request.body === undefined ? '' : Buffer.isBuffer(request.body) ? request.body.toString('latin1') : JSON.stringify(request.body)
  const sent = `${request.url} ${body}`
  return values.filter((value) => response.body.includes(value) && !sent.includes(value))
}

/** The same request with ids that exist nowhere: the response must be identical (existence is not revealed). */
async function asPhantom(as: TestUser | undefined, routeCase: RouteCase) {
  const response = await send(as, routeCase.request(phantom))
  return { status: response.statusCode, error: errorOf(response) }
}

/** Values no vendor user named in a refused request (the vendor log keeps their params and query, E-ADR-22). */
async function notNamedInRefusals(values: readonly string[]): Promise<string[]> {
  const [refused] = await ownerRows<{ text: string }>(
    `SELECT coalesce(string_agg(after_ref, ' '), '') AS text FROM audit.vendor_event WHERE action = 'SUPPORT_SESSION.ACCESS_REFUSED'`,
  )
  return values.filter((value) => !refused!.text.includes(value))
}

const logged = (table: 'audit.audit_event' | 'audit.vendor_event', requestId: string, action: string) =>
  ownerRows<{ after_ref: string | null }>(`SELECT after_ref FROM ${table} WHERE request_id = $1 AND action = $2 ORDER BY seq`, [requestId, action])
const refusalsLogged = async (table: 'audit.audit_event' | 'audit.vendor_event', requestId: string) =>
  (await logged(table, requestId, 'SUPPORT_SESSION.ACCESS_REFUSED'))
    .map((row) => (JSON.parse(row.after_ref!) as { after: { refusal: string } }).after.refusal)

describe('coverage (SEC-28: the build fails if a route is not covered)', () => {
  test('every route buildApp() registers has an isolation case, and every case a route', () => {
    const uncovered = routes.filter((route) => caseOf(route) === undefined)
    const stale = Object.keys(ROUTE_CASES).filter((route) => !routes.includes(route))

    expect(routes.length).toBeGreaterThan(0)
    expect(uncovered).toEqual([])
    expect(stale).toEqual([])
  })

  test('the tenant-B caller holds every permission of the catalogue', () => {
    const held = new Set(BASE_ROLES.filter((role) => ALL_ROLES.includes(role.name)).flatMap((role) => role.permissions))

    expect([...held].sort()).toEqual([...PERMISSIONS].sort())
  })
})

describe('without a session', () => {
  test.each(routes)('%s', async (route) => {
    const routeCase = caseFor(route)
    const request = routeCase.request(targets)

    const response = await send(undefined, request)

    expect(leaked(response, request, canaries)).toEqual([])
    if (routeCase.access !== 'public') {
      expect(outcome(response)).toBe(refusal(request, 401, 'UNAUTHENTICATED'))
      return
    }
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect({ status: response.statusCode, error: errorOf(response) }).toEqual(await asPhantom(undefined, routeCase))
  })

  test('tenant A\'s credentials do open tenant A (so their refusal at tenant B is the isolation, not a typo)', async () => {
    const body = { tenant: seeded.a.slug, email: targets.email, password: PASSWORD }

    const response = await call(app, { method: 'POST', url: '/v1/auth/sessions', body })

    expect(response.statusCode).toBe(201)
  })
})

describe('tenant B user holding every permission (E-SEC-01: denied without revealing existence)', () => {
  let before: Record<string, string>

  beforeAll(async () => {
    before = await fingerprintOf(seeded.a.id, ['public', 'audit'])
  })

  test('sees its own version counters, not tenant A\'s (ETag and meta.latest_version)', async () => {
    const as = await createSignedInUser({ tenantId: seeded.b.id, roles: ALL_ROLES, stepUp: true })
    const [counts] = await ownerRows<{ settings: number; mappings: number }>(
      `SELECT (SELECT max(version) FROM tenant_setting_version WHERE tenant_id = $1) AS settings,
              (SELECT max(version) FROM import_mapping WHERE tenant_id = $1) AS mappings`,
      [seeded.a.id],
    )

    const settings = await send(as, { method: 'GET', url: '/v1/settings/privacy.breach_contacts' })
    const mappings = await send(as, { method: 'GET', url: '/v1/import-mappings' })

    expect(counts).toEqual({ settings: 5, mappings: 1 })
    expect([settings.headers.etag, settings.json().meta.latest_version, settings.json().data.value]).toEqual(['"0"', 0, null])
    expect([mappings.headers.etag, mappings.json().meta.latest_version, mappings.json().data]).toEqual(['"0"', 0, []])
  })

  test.each(routes)('%s', async (route) => {
    const routeCase = caseFor(route)
    const request = routeCase.request(targets)
    const as = await createSignedInUser({ tenantId: seeded.b.id, roles: ALL_ROLES, stepUp: true })

    const response = await send(as, request)

    expect(leaked(response, request, canaries)).toEqual([])
    if (routeCase.access === 'vendor') {
      expect(outcome(response)).toBe(refusal(request, 403, 'REALM_FORBIDDEN'))
    } else if (routeCase.shape === 'collection') {
      expect(response.statusCode).toBe(200)
    } else if (routeCase.shape === 'own') {
      expect(response.statusCode).toBe(routeCase.own)
    } else if (routeCase.access !== 'public') {
      expect(outcome(response)).toBe(refusal(request, 404, 'NOT_FOUND'))
    }
    if (routeCase.shape === 'object') {
      expect({ status: response.statusCode, error: errorOf(response) }).toEqual(await asPhantom(as, routeCase))
    }
  })

  test('cannot grant its own user tenant A\'s role, or a role over tenant A\'s market: answered as for ones that do not exist', async () => {
    const as = await createSignedInUser({ tenantId: seeded.b.id, roles: ALL_ROLES, stepUp: true })
    const [market] = await ownerRows<{ id: string }>('SELECT id FROM market WHERE tenant_id = $1', [seeded.a.id])
    const executive = await baseRoleId('Executive read-only')
    const grant = (body: Record<string, unknown>) =>
      send(as, { method: 'POST', url: `/v1/users/${as.id}/role-assignments`, body, idempotencyKey: true })

    const foreignRole = await grant({ role_id: targets.role })
    const unknownRole = await grant({ role_id: phantom.role })
    const foreignMarket = await grant({ role_id: executive, market_ids: [market!.id] })
    const unknownMarket = await grant({ role_id: executive, market_ids: [randomUUID()] })

    expect(outcome(foreignRole)).toBe('422 ROLE_UNKNOWN')
    expect(errorOf(foreignRole)).toEqual(errorOf(unknownRole))
    expect(outcome(foreignMarket)).toBe('422 MARKET_UNKNOWN')
    expect(errorOf(foreignMarket)).toEqual(errorOf(unknownMarket))
  })

  test('cannot attach tenant A\'s mapping to its own batch: answered as for a mapping that does not exist', async () => {
    const as = await createSignedInUser({ tenantId: seeded.b.id, roles: ALL_ROLES, stepUp: true })
    await createMarket(seeded.b.id, 'ZZ')
    const { payload, contentType } = multipartBody({ market: 'ZZ', period_from: '2025-01', period_to: '2025-01' }, tinyFiles())
    const headers = { 'content-type': contentType }
    const uploaded = await send(as, { method: 'POST', url: '/v1/imports', body: payload, headers, idempotencyKey: true })
    const attach = (mappingId: string) =>
      send(as, { method: 'POST', url: `/v1/imports/${uploaded.json().data.id}/mapping`, body: { mapping_id: mappingId } })

    const foreign = await attach(targets.mapping)
    const unknown = await attach(phantom.mapping)

    expect(uploaded.statusCode).toBe(201)
    expect(outcome(foreign)).toBe('422 MAPPING_UNKNOWN')
    expect(errorOf(foreign)).toEqual(errorOf(unknown))
  })

  test('changed nothing of tenant A (every row of every tenant table, audit included)', async () => {
    expect(await fingerprintOf(seeded.a.id, ['public', 'audit'])).toEqual(before)
  })
})

describe('Idempotency-Key (TR-API-13)', () => {
  test('a key tenant A used replays nothing for tenant B: B gets its own new object', async () => {
    const key = `isolation-${phantom.user}`
    const exportWith = (as: TestUser) => send(as, { method: 'POST', url: '/v1/audit-exports', body: { filters: {} }, idempotencyKey: key })
    const other = await createSignedInUser({ tenantId: seeded.b.id, roles: ALL_ROLES, stepUp: true })

    const first = await exportWith(seeded.owner)
    const foreign = await exportWith(other)

    expect([first.statusCode, foreign.statusCode]).toEqual([201, 201])
    expect(foreign.headers['idempotent-replayed']).toBeUndefined()
    expect(foreign.json().data.id).not.toBe(first.json().data.id)
    expect(leaked(foreign, { method: 'POST', url: '/v1/audit-exports' }, canaries)).toEqual([])
  })
})

describe('vendor user inside tenant A\'s approved support session (FR-IAM-005: read-only, every access logged)', () => {
  let before: Record<string, string>
  let otherTenant: readonly string[]

  // The session's own state (approved -> active) and the logs change by design; business data must not.
  const businessFingerprint = async () => {
    const { 'public.support_session': _session, ...rest } = await fingerprintOf(seeded.a.id, ['public'])
    return rest
  }

  beforeAll(async () => {
    before = await businessFingerprint()
    // Tenant B was given some of tenant A's values on purpose (an email, a role name): those are not B's to leak.
    otherTenant = [...(await canariesOf(seeded.b)).values()].flat().filter((value) => !canaries.includes(value))
  })

  const inSession = (request: CaseRequest) =>
    send(seeded.vendor, { ...request, headers: { ...request.headers, [SUPPORT_SESSION_HEADER]: targets.supportSession } })

  test.each(routes)('%s', async (route) => {
    const routeCase = caseFor(route)
    const request = routeCase.request(targets)

    const response = await inSession(request)
    const requestId = response.headers['x-request-id'] as string

    expect(leaked(response, request, otherTenant)).toEqual([])
    if (UNSAFE.has(request.method as string)) {
      expect(outcome(response)).toBe('403 SUPPORT_SESSION_READ_ONLY')
      expect(await refusalsLogged('audit.vendor_event', requestId)).toEqual(['SUPPORT_SESSION_READ_ONLY'])
      expect(await refusalsLogged('audit.audit_event', requestId)).toEqual(['SUPPORT_SESSION_READ_ONLY'])
    } else if (routeCase.access === 'vendor') {
      expect(outcome(response)).toBe(refusal(request, 403, 'REALM_FORBIDDEN'))
      expect(await refusalsLogged('audit.audit_event', requestId)).toEqual(['REALM_FORBIDDEN'])
    } else {
      expect(response.statusCode).toBe(routeCase.inSession ?? 200)
      expect(await logged('audit.audit_event', requestId, 'SUPPORT_SESSION.ACCESSED')).toHaveLength(1)
    }
  })

  test('does read tenant A\'s data (the canaries are live)', async () => {
    const request: CaseRequest = { method: 'GET', url: '/v1/users?limit=200' }

    const response = await inSession(request)

    expect(response.statusCode).toBe(200)
    expect(leaked(response, request, canaries)).toContain(targets.user)
  })

  test('reaches no other tenant: tenant B\'s user is answered as an unknown id', async () => {
    const [otherUser] = await ownerRows<{ id: string }>('SELECT id FROM user_account WHERE tenant_id = $1 LIMIT 1', [seeded.b.id])

    const foreign = await inSession({ method: 'GET', url: `/v1/users/${otherUser!.id}` })
    const unknown = await inSession({ method: 'GET', url: `/v1/users/${phantom.user}` })

    expect(outcome(foreign)).toBe('404 NOT_FOUND')
    expect(errorOf(foreign)).toEqual(errorOf(unknown))
  })

  test('changed no business data of tenant A', async () => {
    expect(await businessFingerprint()).toEqual(before)
  })
})

describe('vendor user without a support session (AC-29.3, E-ADR-22: no business data)', () => {
  test.each(routes)('%s', async (route) => {
    const routeCase = caseFor(route)
    const request = routeCase.request(targets)
    const as = await createSignedInUser({ tenantId: null })

    const response = await send(as, request)
    const shown = routeCase.echoesRefusedRequests === true ? await notNamedInRefusals(businessCanaries) : businessCanaries

    expect(leaked(response, request, shown)).toEqual([])
    expect(response.statusCode).toBeLessThan(500)
    if (routeCase.access !== 'tenant') return
    expect(outcome(response)).toBe(refusal(request, 403, 'REALM_FORBIDDEN'))
    expect(await refusalsLogged('audit.vendor_event', response.headers['x-request-id'] as string)).toEqual(['NO_SESSION'])
  })
})
