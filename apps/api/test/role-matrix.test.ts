import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { BASE_ROLES, type BaseRoleName, type Permission } from '../src/lib/permissions.js'
import { buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, resetApiDb, type TestUser } from './helpers/index.js'

// TS-36: every base role against one endpoint per permission this module set guards. The expected outcome is
// derived from the catalogue (pinned separately in permissions.test.ts), so the routes must agree with it.
interface Probe {
  readonly label: string
  readonly needs: (permissions: ReadonlySet<Permission>) => boolean
  readonly request: (as: TestUser) => Parameters<typeof call>[1]
}

const PROBES: readonly Probe[] = [
  { label: 'GET /v1/users', needs: (p) => p.has('user.manage'), request: (as) => ({ method: 'GET', url: '/v1/users', as }) },
  { label: 'GET /v1/roles', needs: (p) => p.has('user.manage'), request: (as) => ({ method: 'GET', url: '/v1/roles', as }) },
  { label: 'GET /v1/role-grant-requests', needs: (p) => p.has('user.manage'), request: (as) => ({ method: 'GET', url: '/v1/role-grant-requests', as }) },
  { label: 'GET /v1/audit-events', needs: (p) => p.has('audit.read'), request: (as) => ({ method: 'GET', url: '/v1/audit-events', as }) },
  { label: 'GET /v1/audit-chain/verification', needs: (p) => p.has('audit.read'), request: (as) => ({ method: 'GET', url: '/v1/audit-chain/verification', as }) },
  {
    label: 'POST /v1/audit-exports',
    needs: (p) => p.has('audit.read') && p.has('export'),
    request: (as) => ({ method: 'POST', url: '/v1/audit-exports', as, body: { filters: {} }, idempotencyKey: true }),
  },
  {
    label: 'GET /v1/settings/privacy.breach_contacts',
    needs: (p) => p.has('settings.manage'),
    request: (as) => ({ method: 'GET', url: '/v1/settings/privacy.breach_contacts', as }),
  },
  {
    label: 'GET /v1/settings/compliance.late_order_day',
    needs: (p) => p.has('settings.manage') || p.has('compliance.read'),
    request: (as) => ({ method: 'GET', url: '/v1/settings/compliance.late_order_day', as }),
  },
]

let app: FastifyInstance
const users = new Map<BaseRoleName, TestUser>()

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const tenantId = (await createTenant()).id
  for (const role of BASE_ROLES) users.set(role.name, await createSignedInUser({ tenantId, roles: [role.name], stepUp: true }))
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('TS-36 role matrix over the routes', () => {
  test.each(BASE_ROLES.map((role) => [role.name, role] as const))('%s can do exactly what the matrix states', async (_name, role) => {
    const held = new Set<Permission>(role.permissions)
    const outcomes: string[] = []
    const expected: string[] = []
    for (const probe of PROBES) {
      const response = await call(app, probe.request(users.get(role.name)!))
      outcomes.push(`${probe.label}: ${response.statusCode === 403 ? 'denied' : response.statusCode < 300 ? 'allowed' : response.statusCode}`)
      expected.push(`${probe.label}: ${probe.needs(held) ? 'allowed' : 'denied'}`)
    }

    expect(outcomes).toEqual(expected)
  })
})
