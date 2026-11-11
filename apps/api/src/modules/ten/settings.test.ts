import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { getEffectiveSettings, getSetting } from './index.js'

const CONTACTS = [{ name: 'Dana Protect', role: 'DPO', email: 'dpo@acme.example', phone: '+44 20 7946 0000' }]

let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let compliance: TestUser
let analystWithoutCompliance: TestUser
let globexAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analystWithoutCompliance = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const read = (as: TestUser, key: string) => call(app, { method: 'GET', url: `/v1/settings/${key}`, as })
const write = (as: TestUser, key: string, value: unknown, ifMatch: string | null, extra: Record<string, unknown> = {}) =>
  call(app, {
    method: 'PUT', url: `/v1/settings/${key}`, as, body: { value, reason: 'policy', ...extra },
    ...(ifMatch === null ? {} : { headers: { 'if-match': ifMatch } }),
  })
const latestVersion = async (as: TestUser) => (await read(as, 'compliance.late_order_day')).json().meta.latest_version as number

describe('GET /v1/settings/:key', () => {
  test('an unset key is null (no defaults, DEC-14) with ETag "0"; unknown keys are 404', async () => {
    const tenant = await createTenant()
    const fresh = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })

    const unset = await read(fresh, 'compliance.active_pv_minor')
    const unknown = await read(fresh, 'compliance.no_such_key')

    expect(unset.json()).toEqual({ data: { key: 'compliance.active_pv_minor', value: null, version: null, effective_from: null }, meta: { latest_version: 0 } })
    expect(unset.headers.etag).toBe('"0"')
    expect(unknown.statusCode).toBe(404)
  })

  test('compliance keys are readable with compliance.read; breach contacts need settings.manage', async () => {
    expect((await read(compliance, 'compliance.late_order_day')).statusCode).toBe(200)
    expect((await read(compliance, 'privacy.breach_contacts')).statusCode).toBe(403)
    expect((await read(analystWithoutCompliance, 'compliance.late_order_day')).statusCode).toBe(403)
  })
})

describe('PUT /v1/settings/:key', () => {
  test('writes append versions; each version keeps the other keys (optimistic concurrency by If-Match)', async () => {
    const start = await latestVersion(admin)

    const first = await write(admin, 'compliance.active_pv_minor', '10000', `"${start}"`)
    const second = await write(admin, 'compliance.late_order_day', 25, `"${start + 1}"`)
    const stale = await write(admin, 'compliance.late_order_day', 26, `"${start}"`)
    const effective = await withTenant({ tenantId: acme.id, userId: admin.id }, getEffectiveSettings)
    const versions = await ownerRows('SELECT version FROM tenant_setting_version WHERE tenant_id = $1', [acme.id])

    expect(first.statusCode).toBe(200)
    expect(second.headers.etag).toBe(`"${start + 2}"`)
    expect(stale.statusCode).toBe(412)
    expect(stale.json().error).toMatchObject({ code: 'PRECONDITION_FAILED', details: { latest_version: start + 2 } })
    expect(effective?.values).toMatchObject({ 'compliance.active_pv_minor': '10000', 'compliance.late_order_day': 25 })
    expect(versions).toHaveLength(start + 2)
    expect(await auditActions(acme.id)).toContain('SETTINGS.VERSION_CREATED')
  })

  test('If-Match is required', async () => {
    const response = await write(admin, 'compliance.late_order_day', 20, null)

    expect(response.statusCode).toBe(428)
  })

  test('values are validated per key: bigint strings, day 1..31, exact ratios', async () => {
    const version = `"${await latestVersion(admin)}"`
    const invalid = [
      ['compliance.active_pv_minor', 100.5],
      ['compliance.active_pv_minor', '-1'],
      ['compliance.late_order_day', 32],
      ['compliance.personal_share_flag', { numerator: '3', denominator: '2' }],
      ['compliance.rank_thresholds_pv_minor', {}],
      ['privacy.breach_contacts', []],
    ] as const

    for (const [key, value] of invalid) {
      const response = await write(admin, key, value, version)
      expect([key, response.statusCode]).toEqual([key, 400])
    }
  })

  test('breach contacts are security-relevant: writing needs a fresh second factor', async () => {
    const staleAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
    const version = `"${await latestVersion(admin)}"`

    const refused = await write(staleAdmin, 'privacy.breach_contacts', CONTACTS, version)
    const saved = await write(admin, 'privacy.breach_contacts', CONTACTS, version)
    const [event] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'SETTINGS.VERSION_CREATED' ORDER BY seq DESC LIMIT 1`,
      [acme.id],
    )

    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(saved.statusCode).toBe(200)
    expect(event!.after_ref).not.toContain('dpo@acme.example') // the audit event references the version, not the values
  })

  test('a future version is not in force yet, and nothing may start before it', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const nextYear = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString()

    const scheduled = await write(owner, 'compliance.late_order_day', 15, '"0"', { effective_from: nextYear })
    const now = await read(owner, 'compliance.late_order_day')
    const before = await write(owner, 'compliance.late_order_day', 16, '"1"')
    const past = await write(owner, 'compliance.late_order_day', 16, '"1"', { effective_from: '2020-01-01T00:00:00Z' })

    expect(scheduled.statusCode).toBe(200)
    expect(now.json().data.value).toBeNull()
    expect(now.json().meta.latest_version).toBe(1)
    expect(before.json().error.code).toBe('SETTING_EFFECTIVE_FROM_INVALID')
    expect(past.json().error.code).toBe('SETTING_EFFECTIVE_FROM_INVALID')
  })

  test('needs settings.manage: compliance officers may read thresholds but not change them', async () => {
    const response = await write(compliance, 'compliance.late_order_day', 20, '"1"')

    expect(response.statusCode).toBe(403)
  })

  test('tenants are isolated: another tenant neither sees nor bumps this tenant\'s versions', async () => {
    const own = await read(admin, 'compliance.active_pv_minor')
    const foreign = await read(globexAdmin, 'compliance.active_pv_minor')
    const foreignWrite = await write(globexAdmin, 'compliance.active_pv_minor', '1', '"0"')

    expect(own.json().data.value).toBe('10000')
    expect(foreign.json().data.value).toBeNull()
    expect(foreignWrite.statusCode).toBe(200)
    expect((await read(admin, 'compliance.active_pv_minor')).json().data.value).toBe('10000')
  })
})

describe('settings facade', () => {
  test('getSetting returns the value in force, or null', async () => {
    const tenant = await createTenant()
    const user = await createSignedInUser({ tenantId: tenant.id })
    const ctx = { tenantId: tenant.id, userId: user.id }

    const unset = await withTenant(ctx, (tx) => getSetting(tx, 'compliance.personal_share_flag'))
    const acmeValue = await withTenant({ tenantId: acme.id, userId: admin.id }, (tx) => getSetting(tx, 'compliance.late_order_day'))

    expect(unset).toBeNull()
    expect(acmeValue).toBe(25)
  })
})
