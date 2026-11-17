import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { getEffectiveSettings, getSetting } from './index.js'
import { committedPeriod } from './test-support.js'

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

    expect(unset.json()).toEqual({
      data: { key: 'compliance.active_pv_minor', value: null, version: null, effective_from: null, value_since: null },
      meta: { latest_version: 0 },
    })
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

  test('AC-TEN3-4/6: a change now keeps a scheduled version, which is rebased; ETag is the highest version after it', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const nextYear = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString()

    const scheduled = await write(owner, 'compliance.late_order_day', 15, '"0"', { effective_from: nextYear })
    const now = await read(owner, 'compliance.late_order_day')
    const immediate = await write(owner, 'compliance.active_pv_minor', '500', '"1"')
    const followUp = await write(owner, 'compliance.active_pv_minor', '600', immediate.headers.etag as string)
    const past = await write(owner, 'compliance.late_order_day', 16, followUp.headers.etag as string, { effective_from: '2020-01-01T00:00:00Z' })
    const atNextYear = await withTenant({ tenantId: tenant.id, userId: owner.id }, (tx) => getEffectiveSettings(tx, new Date(Date.parse(nextYear) + 1000)))

    expect(scheduled.statusCode).toBe(200)
    expect(now.json().data.value).toBeNull()
    expect(now.json().meta.latest_version).toBe(1)
    expect(immediate.statusCode).toBe(200)
    expect(immediate.json().data).toMatchObject({ version: 2, rebased: [{ version: 3 }] })
    expect(immediate.json().data.rebased[0].effective_from).toBe(new Date(nextYear).toISOString())
    const [event] = await ownerRows<{ payload: { rebased: { id: string; version: number }[] } }>(
      `SELECT payload FROM outbox_event WHERE tenant_id = $1 AND topic = 'settings.version.created' AND payload ->> 'version' = '2'`, [tenant.id])
    expect(event!.payload.rebased).toEqual([expect.objectContaining({ id: immediate.json().data.rebased[0].id, version: 3 })])
    expect(immediate.headers.etag).toBe('"3"')
    expect(immediate.json().meta.latest_version).toBe(3)
    expect(followUp.statusCode).toBe(200)
    expect(atNextYear?.values).toMatchObject({ 'compliance.late_order_day': 15, 'compliance.active_pv_minor': '600' })
    expect(past.json().error.code).toBe('SETTING_EFFECTIVE_FROM_INVALID')
  })

  test('AC-37.1: a date inside a committed period is refused before the back-dating check', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const market = await createMarket(tenant.id, 'GB')
    const start = new Date(Date.now() - 24 * 3_600_000)
    const end = new Date(Date.now() + 7 * 24 * 3_600_000)
    await committedPeriod(tenant.id, market, start, end)

    const inside = await write(owner, 'compliance.late_order_day', 20, '"0"', { effective_from: new Date(Date.now() + 3_600_000).toISOString() })
    const pastInside = await write(owner, 'compliance.late_order_day', 20, '"0"', { effective_from: new Date(Date.now() - 3_600_000).toISOString() })
    const boundary = await write(owner, 'compliance.late_order_day', 20, '"0"', { effective_from: end.toISOString() })

    expect(inside.json().error.code).toBe('EFFECTIVE_IN_COMMITTED_PERIOD')
    expect(pastInside.json().error.code).toBe('EFFECTIVE_IN_COMMITTED_PERIOD')
    expect(boundary.statusCode).toBe(200)
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

describe('GET /v1/settings and value_since (BUG-025, T-B1-07)', () => {
  test('value_since is the start of the run of the current value; a follow-up save with the returned ETag succeeds', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'], stepUp: true })

    await write(owner, 'compliance.late_order_day', 20, '"0"')
    await write(owner, 'compliance.active_pv_minor', '100', '"1"')
    const third = await write(owner, 'compliance.active_pv_minor', '200', '"2"')
    const all = await call(app, { method: 'GET', url: '/v1/settings', as: owner })
    const one = await read(owner, 'compliance.late_order_day')
    const followUp = await write(owner, 'compliance.late_order_day', 21, all.headers.etag as string)

    expect(third.statusCode).toBe(200)
    expect(all.json().data.version).toBe(3)
    expect(all.json().data.values['compliance.late_order_day']).toMatchObject({ value: 20, value_since: { version: 1 } })
    expect(all.json().data.values['compliance.active_pv_minor']).toMatchObject({ value: '200', value_since: { version: 3 } })
    expect(all.json().data.values['money.rounding_mode']).toEqual({ value: null, value_since: null })
    expect(Object.keys(all.json().data.values)).not.toContain('structure')
    expect(one.json().data.value_since.version).toBe(1)
    expect(all.headers.etag).toBe('"3"')
    expect(followUp.statusCode).toBe(200)
  })

  test('a settings approver reads the money, plan, compliance and (as an order reader) order keys; others are refused', async () => {
    const finance = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'] })

    const response = await call(app, { method: 'GET', url: '/v1/settings', as: finance })
    const refused = await call(app, { method: 'GET', url: '/v1/settings', as: compliance })
    const structure = await read(admin, 'structure')

    expect(Object.keys(response.json().data.values).sort()).toEqual([
      'compliance.active_pv_minor', 'compliance.late_order_day', 'compliance.personal_share_flag',
      'compliance.rank_thresholds_pv_minor', 'money.clawback_policy', 'money.rounding_mode', 'orders.attribution_precedence',
      'orders.crediting_event', 'orders.new_buyer_type', 'orders.purpose_required', 'orders.restocking_fee_volume_effect',
      'plan.activation_notice_days',
    ])
    expect(refused.statusCode).toBe(403)
    expect(structure.statusCode).toBe(404)
  })

  test('plan.activation_notice_days is validated (0..365) and written directly (not money-affecting)', async () => {
    const version = `"${await latestVersion(admin)}"`

    const invalid = await write(admin, 'plan.activation_notice_days', 400, version)
    const saved = await write(admin, 'plan.activation_notice_days', 30, version)

    expect(invalid.statusCode).toBe(400)
    expect(saved.statusCode).toBe(200)
  })
})

describe('GET /v1/settings/versions(/:version)', () => {
  test('lists versions newest first with author, changed keys and supersession; detail redacts breach contacts', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'], stepUp: true })
    const finance = await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'] })
    const future = new Date(Date.now() + 30 * 24 * 3_600_000).toISOString()
    await write(owner, 'privacy.breach_contacts', CONTACTS, '"0"')
    await write(owner, 'compliance.late_order_day', 10, '"1"', { effective_from: future })
    await write(owner, 'compliance.late_order_day', 11, '"2"', { effective_from: future })

    const list = await call(app, { method: 'GET', url: '/v1/settings/versions?limit=2', as: owner })
    const next = await call(app, { method: 'GET', url: `/v1/settings/versions?cursor=${list.json().meta.next_cursor}`, as: owner })
    const detail = await call(app, { method: 'GET', url: '/v1/settings/versions/1', as: owner })
    const redacted = await call(app, { method: 'GET', url: '/v1/settings/versions/1', as: finance })
    const missing = await call(app, { method: 'GET', url: '/v1/settings/versions/99', as: owner })
    const foreign = await call(app, { method: 'GET', url: '/v1/settings/versions/1', as: globexAdmin })

    expect(list.json().data.map((row: { version: number }) => row.version)).toEqual([3, 2])
    expect(list.json().data[0]).toMatchObject({ changed: [{ key: 'compliance.late_order_day' }], superseded_by_version: null, approval: null, created_by: { id: owner.id } })
    expect(list.json().data[1].superseded_by_version).toBe(3)
    expect(next.json().data.map((row: { version: number }) => row.version)).toEqual([1])
    expect(detail.json().data.changes).toEqual([{ key: 'privacy.breach_contacts', before: null, after: CONTACTS }])
    expect(redacted.json().data.changes).toEqual([{ key: 'privacy.breach_contacts', redacted: true }])
    expect(missing.statusCode).toBe(404)
    expect(foreign.body).not.toContain('dpo@acme.example')
    expect((await call(app, { method: 'GET', url: '/v1/settings/versions', as: compliance })).statusCode).toBe(403)
  })

  test('a version diffs against the chain row in force at its date, also when a rebase left a later-dated row in place', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()
    await write(owner, 'compliance.late_order_day', 5, '"0"')
    await write(owner, 'compliance.active_pv_minor', '500', '"1"', { effective_from: inHours(1) })
    const resave = await write(owner, 'compliance.late_order_day', 5, '"2"') // unchanged on top: v2 is not rebased
    await write(owner, 'compliance.late_order_day', 6, '"3"', { effective_from: inHours(2) })

    const detail = await call(app, { method: 'GET', url: '/v1/settings/versions/4', as: owner })

    expect(resave.json().data.rebased).toEqual([])
    expect(detail.json().data.changes).toEqual([{ key: 'compliance.late_order_day', before: 5, after: 6 }])
    expect(detail.json().data.changed).toEqual([{ key: 'compliance.late_order_day' }])
  })
})

describe('B2 setting schemas (PLAN B2 section 2.1)', () => {
  test('refuse duplicates, impossible match counts and inverted sync thresholds', async () => {
    const { SETTINGS } = await import('./settings.js')
    const valid = (key: keyof typeof SETTINGS, value: unknown) => SETTINGS[key].schema.safeParse(value).success

    expect(valid('participants.duplicate_matching', { signals: ['identity_ref'], min_matches: 1, hold_activation: true })).toBe(true)
    expect(valid('participants.duplicate_matching', { signals: ['identity_ref'], min_matches: 2, hold_activation: true })).toBe(false)
    expect(valid('participants.duplicate_matching', { signals: ['address', 'address'], min_matches: 1, hold_activation: false })).toBe(false)
    expect(valid('orders.attribution_precedence', ['link', 'servicing'])).toBe(true)
    expect(valid('orders.attribution_precedence', ['link', 'link'])).toBe(false)
    expect(valid('integrations.sync_health', { behind_after_minutes: 60, failing_after_minutes: 240 })).toBe(true)
    expect(valid('integrations.sync_health', { behind_after_minutes: 60, failing_after_minutes: 60 })).toBe(false)
    expect(valid('customers.reassignment_rule', { rule: 'sponsor', notice_days: 91 })).toBe(false)
    expect(valid('genealogy.placement_width', 1)).toBe(false)
    expect(SETTINGS['genealogy.visibility_policy'].approverPermission).toBe('privacy.manage')
  })
})
