import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { tenModule } from '../ten/index.js'
import { assertBreachContactRecorded, prvModule } from './index.js'

const CONTACTS = [{ name: 'Dana Privacy', role: 'DPO', email: 'dpo@acme.test', phone: '+44 20 7946 0000' }]

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let acmeAdmin: TestUser
let engineer: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  acmeAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  engineer = await createSignedInUser({ tenantId: null })
  app = await buildTestApp({ modules: [tenModule, prvModule] })
})

afterAll(async () => {
  await app.close()
})

const putContacts = () =>
  call(app, {
    method: 'PUT', url: '/v1/settings/privacy.breach_contacts', as: acmeAdmin, headers: { 'if-match': '"0"' },
    body: { value: CONTACTS, reason: 'Breach runbook' },
  })
const readAsVendor = (tenantId: string, as: TestUser = engineer) =>
  call(app, { method: 'GET', url: `/v1/tenants/${tenantId}/breach-contacts`, as })
const recorded = (tenantId: string) =>
  runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: null, supportSessionId: null }, (tx) =>
    assertBreachContactRecorded(tx).then(() => 'recorded', (error: { code?: string }) => error.code))

describe('breach contacts (FR-PRV-004)', () => {
  test('nothing recorded blocks go-live and the first load; a contact in force unblocks them (AC-53.1)', async () => {
    expect(await recorded(acme.id)).toBe('BREACH_CONTACT_REQUIRED')

    expect((await putContacts()).statusCode).toBe(200)

    expect(await recorded(acme.id)).toBe('recorded')
    expect(await recorded(globex.id)).toBe('BREACH_CONTACT_REQUIRED')
  })

  test('a version scheduled for later does not count yet', async () => {
    const later = await createTenant()
    const laterAdmin = await createSignedInUser({ tenantId: later.id, roles: ['Tenant admin'], stepUp: true })
    const nextYear = new Date(Date.now() + 365 * 24 * 3600_000).toISOString()
    const scheduled = await call(app, {
      method: 'PUT', url: '/v1/settings/privacy.breach_contacts', as: laterAdmin, headers: { 'if-match': '"0"' },
      body: { value: CONTACTS, reason: 'From next year', effective_from: nextYear },
    })

    expect(scheduled.statusCode).toBe(200)
    expect(await recorded(later.id)).toBe('BREACH_CONTACT_REQUIRED')
  })
})

describe('GET /v1/tenants/:id/breach-contacts (vendor operations read)', () => {
  test('returns the contacts in force, logged in the vendor log and the tenant log', async () => {
    const acmeView = await readAsVendor(acme.id)
    const globexView = await readAsVendor(globex.id)
    const vendorLog = await ownerRows(`SELECT action FROM audit.vendor_event WHERE object_id = $1`, [acme.id])
    const tenantLog = await ownerRows(`SELECT action, actor_type FROM audit.audit_event WHERE tenant_id = $1 AND action = 'BREACH_CONTACTS.READ'`, [acme.id])

    expect(acmeView.json().data).toEqual({ contacts: CONTACTS })
    expect(globexView.json().data).toEqual({ contacts: null })
    expect(vendorLog).toEqual([{ action: 'BREACH_CONTACTS.READ' }])
    expect(tenantLog).toEqual([{ action: 'BREACH_CONTACTS.READ', actor_type: 'vendor_user' }])
  })

  test('is for MFA-verified vendor users only; tenant users cannot read any tenant through it', async () => {
    const unverified = await createSignedInUser({ tenantId: null, mfa: 'unverified' })

    expect((await readAsVendor(acme.id, acmeAdmin)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await readAsVendor(globex.id, acmeAdmin)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await readAsVendor(acme.id, unverified)).json().error.code).toBe('MFA_VERIFICATION_REQUIRED')
    expect((await readAsVendor(randomUUID())).statusCode).toBe(404)
  })
})
