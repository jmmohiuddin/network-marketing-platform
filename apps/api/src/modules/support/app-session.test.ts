import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { SUPPORT_SESSION_HEADER } from './index.js'

// The real app: buildApp() with the default modules and the support-session hook it installs (FR-IAM-005,
// FR-OPS-001, FR-TEN-001, FR-PRV-004 reachable end to end).
let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let engineer: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  engineer = await createSignedInUser({ tenantId: null })
  await ownerRows(`UPDATE user_account SET work_region = 'eu' WHERE id = $1`, [engineer.id])
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

describe('the default app', () => {
  test('serves the vendor console, and tenant data to a vendor only inside an approved session', async () => {
    const tenants = await call(app, { method: 'GET', url: '/v1/tenants?limit=200', as: engineer })
    const contacts = await call(app, { method: 'GET', url: `/v1/tenants/${acme.id}/breach-contacts`, as: engineer })
    const body = { tenant: acme.id, reason: 'Ticket 9', scope: { permissions: ['audit.read'] }, minutes: 60 }
    const filed = await call(app, { method: 'POST', url: '/v1/support-sessions', as: engineer, body, idempotencyKey: true })
    const id = filed.json().data.id as string
    const withoutSession = await call(app, { method: 'GET', url: '/v1/audit-events', as: engineer })
    await call(app, {
      method: 'POST', url: `/v1/support-sessions/${id}/decision`, as: admin, body: { approved: true, minutes: 30 }, idempotencyKey: true,
    })

    const inSession = await call(app, { method: 'GET', url: '/v1/audit-events', as: engineer, headers: { [SUPPORT_SESSION_HEADER]: id } })

    expect(tenants.json().data.map((tenant: { id: string }) => tenant.id)).toContain(acme.id)
    expect(contacts.json().data).toEqual({ contacts: null })
    expect(withoutSession.json().error.code).toBe('REALM_FORBIDDEN')
    expect(inSession.statusCode).toBe(200)
    expect(inSession.json().data.map((event: { action: string }) => event.action)).toEqual(
      expect.arrayContaining(['SUPPORT_SESSION.REQUESTED', 'SUPPORT_SESSION.APPROVED', 'SUPPORT_SESSION.ACCESSED']),
    )
  })
})
