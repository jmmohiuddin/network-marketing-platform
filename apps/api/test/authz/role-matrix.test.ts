import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { BASE_ROLES, isPrivileged, type BaseRoleName, type Permission } from '../../src/lib/permissions.js'
import type { SettingKey } from '../../src/modules/ten/settings.js'
import { multipartBody, tinyFiles } from '../../src/modules/imp/test-support.js'
import {
  baseRoleId, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, ownerRows, resetApiDb, type TestUser,
} from '../helpers/index.js'
import type { CaseRequest } from '../isolation/cases.js'
import { routesOf } from '../isolation/route-registry.js'
import { MARKET_CODE, seedTenants, type Seeded } from '../isolation/seed.js'

// TS-36 (AC-36.1, AC-36.2, BR-SEC-05, E-SEC-02): every base role against every route buildApp() registers. A probe is
// side-effect free (an id that exists nowhere, or a body that fails validation), so "allowed" is any answer past the
// authorisation checks (404, 400, 428...) and "denied" is 403 PERMISSION_DENIED or REALM_FORBIDDEN. Expected outcomes
// come from the catalogue (BASE_ROLES) and the permission each route needs per SECURITY_IAM_TENANCY 4.3 and API.md.
vi.mock('fastify', async (original) => (await import('../isolation/route-registry.js')).collecting(await original()))

const uploadDir = await mkdtemp(join(tmpdir(), 'nmp-authz-'))
vi.stubEnv('UPLOAD_DIR', uploadDir)
const app = await buildTestApp({ env: { API_RATE_LIMIT_PER_MINUTE: '100000', SIGN_IN_RATE_LIMIT_PER_MINUTE: '100000' } })
const routes = routesOf(app)

type Needs = (held: ReadonlySet<Permission>) => boolean

interface Probe {
  readonly needs: Needs
  readonly request: CaseRequest
  /** Ends the caller's session (sign-out): runs with a session of its own. */
  readonly fresh?: true
}

const all = (...permissions: Permission[]): Needs => (held) => permissions.every((permission) => held.has(permission))
const any = (...permissions: Permission[]): Needs => (held) => permissions.some((permission) => held.has(permission))
const everyone: Needs = () => true
/** Vendor realm only: no tenant role reaches it. */
const nobody: Needs = () => false

const NOWHERE = randomUUID()
const probe = (needs: Needs, method: CaseRequest['method'], url: string, body?: unknown): Probe =>
  ({ needs, request: { method, url, idempotencyKey: true, ...(body === undefined ? {} : { body }) } })
const read = (needs: Needs, url: string): Probe => ({ needs, request: { method: 'GET', url } })

// Settings: thresholds are read by whoever reads the reports; breach contacts only by settings managers (FR-PRV-004).
const SETTING_READERS: Readonly<Record<SettingKey, Needs>> = {
  'compliance.active_pv_minor': any('settings.manage', 'compliance.read'),
  'compliance.rank_thresholds_pv_minor': any('settings.manage', 'compliance.read'),
  'compliance.late_order_day': any('settings.manage', 'compliance.read'),
  'compliance.personal_share_flag': any('settings.manage', 'compliance.read'),
  'privacy.breach_contacts': all('settings.manage'),
}
const SETTING_KEYS = Object.keys(SETTING_READERS) as SettingKey[]
const MAPPING_READERS = any('import.manage', 'mapping.edit', 'mapping.approve')
const ROWS = `/v1/compliance/snapshots/${NOWHERE}/figures/R1.2025-01.customer_share_pct/rows`

const PROBES: Readonly<Record<string, readonly Probe[]>> = {
  'POST /v1/auth/sessions': [probe(everyone, 'POST', '/v1/auth/sessions', {})],
  'POST /v1/auth/vendor-sessions': [probe(everyone, 'POST', '/v1/auth/vendor-sessions', {})],
  'POST /v1/auth/invitations/accept': [probe(everyone, 'POST', '/v1/auth/invitations/accept', {})],
  'DELETE /v1/auth/sessions/current': [{ ...probe(everyone, 'DELETE', '/v1/auth/sessions/current'), fresh: true }],
  'POST /v1/auth/mfa/totp': [probe(everyone, 'POST', '/v1/auth/mfa/totp')],
  'POST /v1/auth/mfa/totp/confirm': [probe(everyone, 'POST', '/v1/auth/mfa/totp/confirm', {})],
  'POST /v1/auth/sessions/current/mfa': [probe(everyone, 'POST', '/v1/auth/sessions/current/mfa', {})],
  'POST /v1/auth/sessions/current/step-up': [probe(everyone, 'POST', '/v1/auth/sessions/current/step-up', {})],
  'GET /v1/me': [read(everyone, '/v1/me')],
  'GET /v1/users': [read(all('user.manage'), '/v1/users')],
  'GET /v1/users/:id': [read(all('user.manage'), `/v1/users/${NOWHERE}`)],
  'POST /v1/users': [probe(all('user.manage'), 'POST', '/v1/users', {})],
  'POST /v1/users/:id/invitation': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/invitation`)],
  'POST /v1/users/:id/deactivate': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/deactivate`)],
  'GET /v1/roles': [read(all('user.manage'), '/v1/roles')],
  'POST /v1/roles': [probe(all('user.manage'), 'POST', '/v1/roles', {})],
  'POST /v1/users/:id/role-assignments': [probe(all('user.manage'), 'POST', `/v1/users/${NOWHERE}/role-assignments`, {})],
  'POST /v1/role-assignments/:id/revoke': [probe(all('user.manage'), 'POST', `/v1/role-assignments/${NOWHERE}/revoke`)],
  'GET /v1/role-grant-requests': [read(all('user.manage'), '/v1/role-grant-requests')],
  'POST /v1/role-grant-requests/:id/decision': [probe(all('user.manage'), 'POST', `/v1/role-grant-requests/${NOWHERE}/decision`, {})],
  'GET /v1/settings/:key': SETTING_KEYS.map((key) => read(SETTING_READERS[key], `/v1/settings/${key}`)),
  // No If-Match: 428 once past the permission and step-up checks.
  'PUT /v1/settings/:key': SETTING_KEYS.map((key) => probe(all('settings.manage'), 'PUT', `/v1/settings/${key}`, {})),
  'GET /v1/audit-events': [read(all('audit.read'), '/v1/audit-events')],
  'GET /v1/audit-chain/verification': [read(all('audit.read'), '/v1/audit-chain/verification')],
  'POST /v1/audit-exports': [probe(all('audit.read', 'export'), 'POST', '/v1/audit-exports', { unknown: true })],
  'GET /v1/audit-exports/:id/download': [read(all('audit.read', 'export'), `/v1/audit-exports/${NOWHERE}/download`)],
  'POST /v1/support-sessions': [probe(nobody, 'POST', '/v1/support-sessions', {})],
  'GET /v1/support-sessions': [read(all('vendor_access.decide'), '/v1/support-sessions')],
  'GET /v1/support-sessions/:id': [read(all('vendor_access.decide'), `/v1/support-sessions/${NOWHERE}`)],
  'POST /v1/support-sessions/:id/decision': [probe(all('vendor_access.decide'), 'POST', `/v1/support-sessions/${NOWHERE}/decision`, {})],
  'POST /v1/support-sessions/:id/end': [probe(all('vendor_access.decide'), 'POST', `/v1/support-sessions/${NOWHERE}/end`)],
  'GET /v1/support-sessions/:id/log': [read(all('vendor_access.decide'), `/v1/support-sessions/${NOWHERE}/log`)],
  'GET /v1/tenants/:id/breach-contacts': [read(nobody, `/v1/tenants/${NOWHERE}/breach-contacts`)],
  'GET /v1/tenants': [read(nobody, '/v1/tenants')],
  'GET /v1/tenants/:id': [read(nobody, `/v1/tenants/${NOWHERE}`)],
  'POST /v1/tenants': [probe(nobody, 'POST', '/v1/tenants', {})],
  'POST /v1/tenants/:id/approve': [probe(nobody, 'POST', `/v1/tenants/${NOWHERE}/approve`)],
  'POST /v1/tenants/:id/go-live': [probe(nobody, 'POST', `/v1/tenants/${NOWHERE}/go-live`)],
  'POST /v1/imports': [probe(all('import.manage'), 'POST', '/v1/imports', {})],
  'GET /v1/imports': [read(all('import.manage'), '/v1/imports')],
  'GET /v1/imports/:id': [read(all('import.manage'), `/v1/imports/${NOWHERE}`)],
  'GET /v1/imports/:id/errors': [read(all('import.manage'), `/v1/imports/${NOWHERE}/errors`)],
  'GET /v1/imports/:id/source-values': [read(MAPPING_READERS, `/v1/imports/${NOWHERE}/source-values`)],
  'POST /v1/imports/:id/mapping': [probe(all('import.manage'), 'POST', `/v1/imports/${NOWHERE}/mapping`, {})],
  'POST /v1/imports/:id/load': [probe(all('import.manage'), 'POST', `/v1/imports/${NOWHERE}/load`)],
  'GET /v1/import-mappings': [read(MAPPING_READERS, '/v1/import-mappings')],
  'GET /v1/import-mappings/:id': [read(MAPPING_READERS, `/v1/import-mappings/${NOWHERE}`)],
  'PUT /v1/import-mappings': [probe(all('mapping.edit'), 'PUT', '/v1/import-mappings', {})],
  'POST /v1/import-mappings/:id/approve': [probe(all('mapping.approve'), 'POST', `/v1/import-mappings/${NOWHERE}/approve`)],
  'POST /v1/compliance/snapshots': [probe(all('snapshot.create'), 'POST', '/v1/compliance/snapshots', {})],
  'GET /v1/compliance/snapshots': [read(all('compliance.read'), '/v1/compliance/snapshots')],
  'GET /v1/compliance/snapshots/:id': [read(all('compliance.read'), `/v1/compliance/snapshots/${NOWHERE}`)],
  'GET /v1/compliance/snapshots/:id/figures/:figure/rows': [
    read(all('compliance.read'), ROWS),
    read(all('compliance.read', 'export'), `${ROWS}?export=true`),
  ],
}

/** Fastify's HEAD routes run their GET handler: they take the GET probes with method HEAD. */
function probesOf(route: string): readonly Probe[] | undefined {
  if (!route.startsWith('HEAD ')) return PROBES[route]
  return PROBES[`GET ${route.slice('HEAD '.length)}`]?.map((found) => ({ ...found, request: { ...found.request, method: 'HEAD' } }))
}

const DENIALS = new Set(['PERMISSION_DENIED', 'REALM_FORBIDDEN'])

function classify(response: LightMyRequestResponse, method: CaseRequest['method']): string {
  if (response.statusCode === 401 || response.statusCode >= 500) return `failed ${response.statusCode}`
  if (response.statusCode !== 403) return 'allowed'
  if (method === 'HEAD') return 'denied' // no body: the GET twin shows the code
  const code = (JSON.parse(response.body) as { error: { code: string } }).error.code
  return DENIALS.has(code) ? 'denied' : `403 ${code}`
}

const label = (found: Probe) => `${found.request.method} ${found.request.url}`

let seeded: Seeded
const users = new Map<BaseRoleName, TestUser>()

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  seeded = await seedTenants(app)
  for (const role of BASE_ROLES) users.set(role.name, await createSignedInUser({ tenantId: seeded.a.id, roles: [role.name], stepUp: true }))
})

afterAll(async () => {
  await app.close()
  vi.unstubAllEnvs()
  await rm(uploadDir, { recursive: true, force: true })
})

describe('TS-36 role matrix over every route', () => {
  test('every route buildApp() registers has a probe, and every probe a route', () => {
    expect(routes.filter((route) => probesOf(route) === undefined)).toEqual([])
    expect(Object.keys(PROBES).filter((route) => !routes.includes(route))).toEqual([])
  })

  test.each(BASE_ROLES.map((role) => [role.name, role] as const))('%s can do exactly what the catalogue grants', async (name, role) => {
    const held = new Set<Permission>(role.permissions)
    const outcomes: string[] = []
    const expected: string[] = []
    for (const found of routes.flatMap((route) => probesOf(route) ?? [])) {
      const as = found.fresh === true ? await createSignedInUser({ tenantId: seeded.a.id, roles: [name], stepUp: true }) : users.get(name)!
      const response = await call(app, { ...found.request, as })
      outcomes.push(`${label(found)}: ${classify(response, found.request.method)}`)
      expected.push(`${label(found)}: ${found.needs(held) ? 'allowed' : 'denied'}`)
    }

    expect(outcomes).toEqual(expected)
  })
})

describe('SEC-27 / BR-SEC-05: a Tenant admin grants each base role', () => {
  const cases = BASE_ROLES.map((role) => [role.name, role] as const)
  test.each(cases)('%s: at once only if not privileged and held, else a request for a second admin', async (name, role) => {
    const admin = users.get('Tenant admin')!
    const adminHolds = new Set(BASE_ROLES.find((candidate) => candidate.name === 'Tenant admin')!.permissions)
    const grantee = await createSignedInUser({ tenantId: seeded.a.id })
    const immediate = !isPrivileged(role.permissions) && role.permissions.every((permission) => adminHolds.has(permission))

    const response = await call(app, {
      method: 'POST', url: `/v1/users/${grantee.id}/role-assignments`, as: admin, body: { role_id: await baseRoleId(name) }, idempotencyKey: true,
    })
    const assigned = await ownerRows('SELECT id FROM role_assignment WHERE user_id = $1', [grantee.id])

    expect(response.statusCode).toBe(immediate ? 201 : 202)
    expect(assigned).toHaveLength(immediate ? 1 : 0)
  })
})

describe('AC-36.2 / E-SEC-02: a role scoped to another market sees nothing of this one', () => {
  let other: string
  let consultant: TestUser
  let officer: TestUser

  beforeAll(async () => {
    other = await createMarket(seeded.a.id, 'OTHER')
    consultant = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Implementation consultant'], marketIds: [other] })
    officer = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Compliance officer'], marketIds: [other], stepUp: true })
  })

  const status = async (as: TestUser, method: CaseRequest['method'], url: string, body?: unknown) =>
    (await call(app, { method, url, as, ...(body === undefined ? {} : { body }) })).statusCode

  test('imports: the batches of the market are neither listed nor reachable by id', async () => {
    const { batch, rejectedBatch, mapping } = seeded.targets
    const listed = (await call(app, { method: 'GET', url: '/v1/imports?limit=200', as: consultant })).json().data as { id: string }[]
    const ownersView = (await call(app, { method: 'GET', url: '/v1/imports?limit=200', as: seeded.owner })).json().data as { id: string }[]

    expect(ownersView.map((row) => row.id)).toContain(batch)
    expect(listed).toEqual([])
    expect(await status(consultant, 'GET', `/v1/imports/${batch}`)).toBe(404)
    expect(await status(consultant, 'GET', `/v1/imports/${rejectedBatch}/errors`)).toBe(404)
    expect(await status(consultant, 'GET', `/v1/imports/${batch}/source-values`)).toBe(404)
    expect(await status(consultant, 'POST', `/v1/imports/${batch}/mapping`, { mapping_id: mapping })).toBe(404)
    expect(await status(consultant, 'POST', `/v1/imports/${batch}/load`)).toBe(404)
  })

  test('imports: uploading for the market is answered as for a market that does not exist', async () => {
    const uploadFor = async (market: string) => {
      const { payload, contentType } = multipartBody({ market, period_from: '2025-01', period_to: '2025-01' }, tinyFiles())
      const headers = { 'content-type': contentType }
      const response = await call(app, { method: 'POST', url: '/v1/imports', as: consultant, body: payload, headers, idempotencyKey: true })
      return { status: response.statusCode, code: response.json().error?.code }
    }

    expect(await uploadFor(MARKET_CODE)).toEqual({ status: 422, code: 'MARKET_UNKNOWN' })
    expect(await uploadFor('NOWHERE')).toEqual({ status: 422, code: 'MARKET_UNKNOWN' })
  })

  test('compliance: the snapshot is neither listed nor reachable, and none can be requested for the market', async () => {
    const { snapshot, figure } = seeded.targets
    const listed = (await call(app, { method: 'GET', url: '/v1/compliance/snapshots?limit=200', as: officer })).json().data
    const request = (market: string) => call(app, {
      method: 'POST', url: '/v1/compliance/snapshots', as: officer, idempotencyKey: true,
      body: { market, period_from: '2025-01', period_to: '2025-01' },
    })
    const scoped = await request(MARKET_CODE)
    const unknown = await request('NOWHERE')

    expect(listed).toEqual([])
    expect(await status(officer, 'GET', `/v1/compliance/snapshots/${snapshot}`)).toBe(404)
    expect(await status(officer, 'GET', `/v1/compliance/snapshots/${snapshot}/figures/${encodeURIComponent(figure)}/rows`)).toBe(404)
    expect(scoped.statusCode).toBe(422)
    expect(scoped.json().error).toEqual({ ...unknown.json().error, request_id: scoped.json().error.request_id })
  })
})

// Known defects (engineering/BUG_REGISTER.md), kept here as the TS-36 regression tests: test.fails passes while the
// defect is present; when it is fixed, change test.fails to test.
describe('a Tenant admin scoped to one market against all-markets admins', () => {
  let scopedAdmin: TestUser

  beforeAll(async () => {
    const market = await createMarket(seeded.a.id, 'M2')
    scopedAdmin = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Tenant admin'], marketIds: [market], stepUp: true })
  })

  const activeAssignments = (userId: string) =>
    ownerRows('SELECT id FROM role_assignment WHERE user_id = $1 AND (valid_to IS NULL OR valid_to > now())', [userId])

  // BUG-006: the approver of a privileged grant is not checked against the grant's market scope.
  test.fails('cannot approve an all-markets privileged grant (BUG-006)', async () => {
    const grantee = await createSignedInUser({ tenantId: seeded.a.id })
    const requested = await call(app, {
      method: 'POST', url: `/v1/users/${grantee.id}/role-assignments`, as: seeded.owner,
      body: { role_id: await baseRoleId('Tenant admin') }, idempotencyKey: true,
    })

    const decided = await call(app, {
      method: 'POST', url: `/v1/role-grant-requests/${requested.json().data.request.id}/decision`, as: scopedAdmin,
      body: { decision: 'approved' }, idempotencyKey: true,
    })

    expect(requested.statusCode).toBe(202)
    expect([403, 422]).toContain(decided.statusCode)
    expect(await activeAssignments(grantee.id)).toEqual([])
  })

  // BUG-007: revoke checks only user.manage (no market scope, no step-up, no second admin for privileged roles).
  test.fails('cannot revoke an all-markets admin\'s assignment (BUG-007)', async () => {
    const admin = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Tenant admin'] })
    const [assignment] = await activeAssignments(admin.id)

    const response = await call(app, { method: 'POST', url: `/v1/role-assignments/${(assignment as { id: string }).id}/revoke`, as: scopedAdmin })

    expect([403, 422]).toContain(response.statusCode)
    expect(await activeAssignments(admin.id)).toHaveLength(1)
  })

  // BUG-007: deactivation has the same gap.
  test.fails('cannot deactivate an all-markets admin (BUG-007)', async () => {
    const admin = await createSignedInUser({ tenantId: seeded.a.id, roles: ['Tenant admin'] })

    const response = await call(app, { method: 'POST', url: `/v1/users/${admin.id}/deactivate`, as: scopedAdmin })
    const [stored] = await ownerRows<{ state: string }>('SELECT state FROM user_account WHERE id = $1', [admin.id])

    expect([403, 422]).toContain(response.statusCode)
    expect(stored).toEqual({ state: 'active' })
  })
})
