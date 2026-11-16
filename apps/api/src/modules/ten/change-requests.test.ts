import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { getEffectiveSettings, tenModule } from './index.js'
import { committedPeriod } from './test-support.js'

let app: FastifyInstance
let acme: TestTenant
let preparer: TestUser
let finance: TestUser
let staleFinance: TestUser
let admin: TestUser
let globexFinance: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  // Holds settings.manage and settings.approve: only separation of duties stops it approving its own request.
  preparer = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Finance approver'], stepUp: true })
  finance = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'], stepUp: true })
  staleFinance = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'] })
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  globexFinance = await createSignedInUser({ tenantId: globex.id, roles: ['Finance approver'], stepUp: true })
  app = await buildTestApp({ modules: [tenModule] })
})

afterAll(async () => {
  await app.close()
})

const inDays = (days: number) => new Date(Date.now() + days * 24 * 3_600_000).toISOString()
const etag = async (as: TestUser) => (await call(app, { method: 'GET', url: '/v1/settings', as })).headers.etag as string
const requestChange = async (as: TestUser, key: string, value: unknown, effectiveFrom?: string) =>
  call(app, {
    method: 'PUT', url: `/v1/settings/${key}`, as, headers: { 'if-match': await etag(as) },
    body: { value, reason: 'policy change', ...(effectiveFrom === undefined ? {} : { effective_from: effectiveFrom }) },
  })
const decide = (as: TestUser, id: string, decision: 'approve' | 'reject', key: true | string = true) =>
  call(app, { method: 'POST', url: `/v1/setting-change-requests/${id}/decision`, as, body: { decision, reason: 'checked' }, idempotencyKey: key })
const withdraw = (as: TestUser, id: string) =>
  call(app, { method: 'POST', url: `/v1/setting-change-requests/${id}/withdraw`, as, body: { reason: 'not needed' } })
const versionCount = async () => (await ownerRows('SELECT 1 FROM tenant_setting_version WHERE tenant_id = $1', [acme.id])).length

describe('PUT /v1/settings/:key on a money-affecting key (AC-TEN3-1)', () => {
  test('202 with a pending change request and no version; a second request for the key is 409 CHANGE_PENDING', async () => {
    const before = await versionCount()

    const created = await requestChange(preparer, 'money.rounding_mode', 'half_even', inDays(10))
    const second = await requestChange(preparer, 'money.rounding_mode', 'half_up', inDays(11))
    const list = await call(app, { method: 'GET', url: '/v1/setting-change-requests', as: finance })

    expect(created.statusCode).toBe(202)
    expect(created.json().data.change_request).toMatchObject({
      key: 'money.rounding_mode', value: 'half_even', state: 'pending', requested_by: { id: preparer.id }, version: null,
    })
    expect(created.json().data.change_request.eligible_approvers.map((user: { user_id: string }) => user.user_id).sort())
      .toEqual([finance.id, staleFinance.id].sort())
    expect(second.json().error.code).toBe('CHANGE_PENDING')
    expect(await versionCount()).toBe(before)
    expect(list.json().data.map((row: { key: string }) => row.key)).toContain('money.rounding_mode')
    expect(await auditActions(acme.id)).toContain('SETTINGS.CHANGE_REQUESTED')
    await withdraw(preparer, created.json().data.change_request.id)
  })

  test('a money key needs an effective date; a past date is refused (AC-TEN3-3)', async () => {
    const missing = await requestChange(admin, 'money.clawback_policy', { default: 'order_line' })
    const past = await requestChange(admin, 'money.clawback_policy', { default: 'order_line' }, '2020-01-01T00:00:00Z')

    expect(missing.statusCode).toBe(400)
    expect(past.json().error.code).toBe('SETTING_EFFECTIVE_FROM_INVALID')
  })
})

describe('POST /v1/setting-change-requests/:id/decision (AC-TEN3-2, TS-42 settings part)', () => {
  test('the requester is refused SOD-01 with the eligible approvers; the refusal is audited and survives the 422', async () => {
    const created = await requestChange(preparer, 'money.clawback_policy', { default: 'restatement' }, inDays(20))
    const id = created.json().data.change_request.id as string

    const refused = await decide(preparer, id, 'approve')
    const [event] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'APPROVAL.REFUSED' AND object_id = $2`, [acme.id, id])
    const state = await ownerRows<{ state: string }>('SELECT state FROM setting_change_request WHERE id = $1', [id])

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01', no_eligible_approver: false } })
    expect(refused.json().error.details.eligible_approvers.map((user: { user_id: string }) => user.user_id)).not.toContain(preparer.id)
    expect(JSON.parse(event!.after_ref).after).toEqual({ object_type: 'setting_change_request', object_id: id, reason_code: 'SOD-01' })
    expect(state).toEqual([{ state: 'pending' }])

    const key = `decision-${id}`
    const approved = await decide(finance, id, 'approve', key)
    const replay = await decide(finance, id, 'approve', key)
    const version = approved.json().data.version as number
    const history = await call(app, { method: 'GET', url: `/v1/settings/versions/${version}`, as: finance })

    expect(approved.statusCode).toBe(200)
    expect(approved.json().data.change_request).toMatchObject({ state: 'approved', decided_by: { id: finance.id }, version })
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(history.json().data).toMatchObject({ approval: { approver: { id: finance.id } }, changes: [{ key: 'money.clawback_policy', after: { default: 'restatement' } }] })
    expect(await auditActions(acme.id)).toContain('SETTINGS.CHANGE_APPROVED')
  })

  test('reject closes the request without a version; a decided request is 409 CHANGE_NOT_PENDING', async () => {
    const created = await requestChange(admin, 'money.rounding_mode', 'half_up', inDays(30))
    const id = created.json().data.change_request.id as string
    const before = await versionCount()

    const rejected = await decide(finance, id, 'reject')
    const again = await decide(finance, id, 'approve')

    expect(rejected.json().data).toMatchObject({ change_request: { state: 'rejected', decided_by: { id: finance.id } }, version: null })
    expect(await versionCount()).toBe(before)
    expect(again.json().error.code).toBe('CHANGE_NOT_PENDING')
  })

  test('needs settings.approve and a fresh second factor; another tenant sees 404', async () => {
    const created = await requestChange(admin, 'money.rounding_mode', 'half_even', inDays(40))
    const id = created.json().data.change_request.id as string

    expect((await decide(admin, id, 'approve')).statusCode).toBe(403)
    expect((await decide(staleFinance, id, 'approve')).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await decide(globexFinance, id, 'approve')).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/setting-change-requests', as: globexFinance })).json().data).toEqual([])
    await withdraw(admin, id)
  })

  test('AC-TEN3-3: a request whose date has passed is refused at approval and stays pending', async () => {
    const [request] = await ownerRows<{ id: string }>(
      `INSERT INTO setting_change_request (tenant_id, key, value, effective_from, reason, base_version, state, requested_by)
       VALUES ($1, 'plan.activation_notice_days', '7', now() - interval '1 hour', 'FIXTURE: date passed while pending', 0, 'pending', $2)
       RETURNING id`,
      [acme.id, admin.id],
    )

    const response = await decide(finance, request!.id, 'approve')
    const state = await ownerRows<{ state: string }>('SELECT state FROM setting_change_request WHERE id = $1', [request!.id])

    expect(response.json().error.code).toBe('SETTING_EFFECTIVE_FROM_INVALID')
    expect(state).toEqual([{ state: 'pending' }])
  })
})

describe('AC-37.1 / TS-59: committed periods and the next boundary', () => {
  test('a rounding change inside a committed period is refused; at the next boundary it is requested, approved and versioned', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const approver = await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'], stepUp: true })
    const market = await createMarket(tenant.id, 'GB')
    const end = new Date(Date.now() + 5 * 24 * 3_600_000)
    await committedPeriod(tenant.id, market, new Date(Date.now() - 24 * 3_600_000), end)

    const inside = await requestChange(owner, 'money.rounding_mode', 'half_even', new Date(Date.now() + 3_600_000).toISOString())
    const boundary = await requestChange(owner, 'money.rounding_mode', 'half_even', end.toISOString())
    const approved = await decide(approver, boundary.json().data.change_request.id, 'approve')
    const inForce = await withTenant({ tenantId: tenant.id, userId: owner.id }, (tx) => getEffectiveSettings(tx, new Date(end.getTime() + 1000)))
    const before = await withTenant({ tenantId: tenant.id, userId: owner.id }, (tx) => getEffectiveSettings(tx))

    expect(inside.json().error.code).toBe('EFFECTIVE_IN_COMMITTED_PERIOD')
    expect(boundary.statusCode).toBe(202)
    expect(approved.statusCode).toBe(200)
    expect(inForce?.values['money.rounding_mode']).toBe('half_even')
    expect(before).toBeNull()
  })
})

describe('POST /v1/setting-change-requests/:id/withdraw (T-B1-06)', () => {
  test('only the requester withdraws; decided_by stays NULL; others see 404', async () => {
    const created = await requestChange(admin, 'money.clawback_policy', { default: 'order_line' }, inDays(50))
    const id = created.json().data.change_request.id as string

    const foreign = await withdraw(preparer, id)
    const withdrawn = await withdraw(admin, id)
    const again = await withdraw(admin, id)
    const [row] = await ownerRows<{ decided_by: string | null; decision_reason: string }>(
      'SELECT decided_by, decision_reason FROM setting_change_request WHERE id = $1', [id])

    expect(foreign.statusCode).toBe(404)
    expect(withdrawn.json().data).toMatchObject({ state: 'withdrawn', decided_by: null, decision_reason: 'not needed' })
    expect(again.json().error.code).toBe('CHANGE_NOT_PENDING')
    expect(row).toEqual({ decided_by: null, decision_reason: 'not needed' })
    expect((await withdraw(finance, id)).statusCode).toBe(403)
  })
})

describe('database backstop (T-B1-08)', () => {
  test('a version that changes a money key without an approval is refused at commit', async () => {
    const attempt = withTenant({ tenantId: acme.id, userId: admin.id }, (tx) =>
      tx.query(
        `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
         SELECT app_tenant_id(), max(version) + 1, now(), '{"money.rounding_mode": "half_up"}', 'direct', $1 FROM tenant_setting_version`,
        [admin.id],
      ))

    await expect(attempt).rejects.toMatchObject({ code: '42501' })
  })

  test('the database money-key list matches the registry', async () => {
    const [row] = await ownerRows<{ keys: string[] }>('SELECT money_setting_keys() AS keys')
    const { SETTINGS } = await import('./settings.js')
    const registry = Object.entries(SETTINGS).filter(([, definition]) => definition.moneyAffecting).map(([key]) => key)

    expect(row!.keys.sort()).toEqual(registry.sort())
  })
})

describe('version history of an approved change', () => {
  test('the requester is the author (BUG-049); its rebase keeps author and approval and diffs against its new predecessor (BUG-050)', async () => {
    const tenant = await createTenant()
    const requester = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'], stepUp: true })
    const approver = await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'], stepUp: true })
    const other = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'], stepUp: true })
    const created = await requestChange(requester, 'money.rounding_mode', 'half_even', inDays(10))
    const approved = await decide(approver, created.json().data.change_request.id, 'approve')
    const saved = await requestChange(other, 'compliance.late_order_day', 5)
    const scheduled = approved.json().data.version as number
    const rebased = saved.json().data.rebased[0].version as number

    const original = await call(app, { method: 'GET', url: `/v1/settings/versions/${scheduled}`, as: requester })
    const onTop = await call(app, { method: 'GET', url: `/v1/settings/versions/${rebased}`, as: requester })

    expect(original.json().data).toMatchObject({ created_by: { id: requester.id }, approval: { approver: { id: approver.id } } })
    expect(onTop.json().data).toMatchObject({
      created_by: { id: requester.id }, approval: { approver: { id: approver.id } },
      changed: [{ key: 'money.rounding_mode' }], changes: [{ key: 'money.rounding_mode', after: 'half_even' }],
    })
    expect(onTop.json().data.changes).toHaveLength(1)
  })
})

describe('settings are tenant-wide: approving and requesting need all-markets scope', () => {
  test('a Finance approver limited to one market is not eligible and cannot decide; a scoped admin cannot request', async () => {
    const gb = await createMarket(acme.id, 'GB')
    const scopedFinance = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'], marketIds: [gb], stepUp: true })
    const scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [gb], stepUp: true })
    const before = await versionCount()

    const created = await requestChange(preparer, 'money.rounding_mode', 'half_even', inDays(12))
    const id = created.json().data.change_request.id as string
    const decided = await decide(scopedFinance, id, 'approve')
    const scopedRequest = await requestChange(scopedAdmin, 'money.rounding_mode', 'half_up', inDays(13))

    expect(created.json().data.change_request.eligible_approvers.map((user: { user_id: string }) => user.user_id)).not.toContain(scopedFinance.id)
    expect(decided.statusCode).toBe(403)
    expect(decided.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'settings.approve' } })
    expect(scopedRequest.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'settings.manage' } })
    expect(await versionCount()).toBe(before)
    expect((await ownerRows<{ state: string }>('SELECT state FROM setting_change_request WHERE id = $1', [id]))[0]!.state).toBe('pending')
    await withdraw(preparer, id)
  })
})

describe('only the requester can withdraw a tenant-wide change request', () => {
  test('an admin limited to one market gets 404; the request stays pending', async () => {
    const wm = await createMarket(acme.id, 'WM')
    const scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [wm] })
    const id = (await requestChange(preparer, 'money.rounding_mode', 'half_up', inDays(20))).json().data.change_request.id as string

    const withdrawn = await withdraw(scopedAdmin, id)

    expect(withdrawn.statusCode).toBe(404)
    expect((await ownerRows('SELECT state FROM setting_change_request WHERE id = $1', [id]))[0]).toMatchObject({ state: 'pending' })
    await withdraw(preparer, id)
  })
})
