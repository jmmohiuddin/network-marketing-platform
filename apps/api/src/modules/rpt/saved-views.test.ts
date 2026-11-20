import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  baseRoleId, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { rptModule } from './index.js'
import { SAVED_VIEWS_PER_USER_LIST } from './saved-views.js'

// T-B6-30 (FR-RPT-002, D-B6-08, PLAN B6 2.4): saved views CRUD, one default per user and list, registry validation,
// sharing within a role, owner-only writes and the shared_role_id guard.

let app: FastifyInstance
let tenantId: string
let otherTenantId: string
let gb: string
let owner: TestUser
let colleague: TestUser
let support: TestUser
let finance: TestUser
let planAdmin: TestUser
let twoRoles: TestUser
let globex: TestUser
let analystRole: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  otherTenantId = (await createTenant()).id
  gb = await createMarket(tenantId, 'GB')
  ;[owner, colleague, support, finance, planAdmin, twoRoles, globex] = await Promise.all([
    createSignedInUser({ tenantId, roles: ['Commission analyst'] }), createSignedInUser({ tenantId, roles: ['Commission analyst'] }),
    createSignedInUser({ tenantId, roles: ['Support agent'] }), createSignedInUser({ tenantId, roles: ['Finance approver'] }),
    createSignedInUser({ tenantId, roles: ['Plan administrator'] }), createSignedInUser({ tenantId, roles: ['Commission analyst', 'Plan administrator'] }),
    createSignedInUser({ tenantId: otherTenantId, roles: ['Commission analyst'] }),
  ])
  analystRole = await baseRoleId('Commission analyst')
  app = await buildTestApp({ modules: [rptModule] })
})

afterAll(async () => {
  await app.close()
})

const view = (overrides: Record<string, unknown> = {}) => ({
  list: 'orders', name: `View ${randomUUID().slice(0, 8)}`, filters: { market_id: gb, purpose: 'customer' }, columns: ['source_order_id', 'amount'],
  sort: 'amount_desc', ...overrides,
})
const create = (as: TestUser, body: Record<string, unknown>) => call(app, { method: 'POST', url: '/v1/saved-views', as, body, idempotencyKey: true })
const list = (as: TestUser, name = 'orders') => call(app, { method: 'GET', url: `/v1/saved-views?list=${name}`, as })
const auditOf = async (action: string, id: string) => (await ownerRows<{ after: Record<string, unknown> }>(
  `SELECT after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE action = $1 AND object_id = $2 ORDER BY seq`, [action, id])).map((row) => row.after)

describe('saved views CRUD (T-B6-30, AC-RPT2-1)', () => {
  test('a saved orders view is listed with its filters, columns, sort and owner; created audited', async () => {
    const created = await create(owner, view({ name: 'Customer orders' }))
    const listed = (await list(owner)).json().data

    expect(created.statusCode, created.body).toBe(201)
    expect(created.json().data).toEqual({
      id: expect.any(String), list: 'orders', name: 'Customer orders', filters: { market_id: gb, purpose: 'customer' }, columns: ['source_order_id', 'amount'],
      sort: 'amount_desc', is_default: false, shared_role: null, owner: expect.objectContaining({ id: owner.id }), mine: true,
    })
    expect(listed.map((v: { id: string }) => v.id)).toContain(created.json().data.id)
    expect(await auditOf('SAVED_VIEW.CREATED', created.json().data.id)).toEqual([{ list: 'orders', name: 'Customer orders', shared_role_id: null }])
    expect((await create(owner, view({ name: 'Customer orders' }))).json().error.code).toBe('VIEW_NAME_TAKEN')
  })

  test('is_default keeps one default per user and list; the replaced default is audited', async () => {
    const first = (await create(owner, view({ is_default: true }))).json().data
    const second = (await create(owner, view({ is_default: true }))).json().data
    const defaults = (await list(owner)).json().data.filter((v: { is_default: boolean }) => v.is_default)

    expect(defaults.map((v: { id: string }) => v.id)).toEqual([second.id])
    expect(await auditOf('SAVED_VIEW.UPDATED', first.id)).toEqual([{ list: 'orders', name: first.name, shared_role_id: null, is_default: false }])
  })

  test('an invalid filter, unknown or repeated column, or unknown sort is 422 VALIDATION_FAILED with the path', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ filters: { purpose: 'wholesale' } }, 'filters.purpose'], [{ filters: { colour: 'red' } }, 'filters'],
      [{ columns: ['amount', 'display_name'] }, 'columns.1'], [{ columns: ['amount', 'amount'] }, 'columns.1'], [{ sort: 'posted_at_desc' }, 'sort'],
    ]
    for (const [overrides, path] of cases) {
      const response = await create(owner, view(overrides))
      expect([response.statusCode, response.json().error.code, response.json().error.details]).toEqual([422, 'VALIDATION_FAILED', { path }])
    }
    expect((await create(owner, view({ list: 'payouts' }))).statusCode).toBe(400)
  })

  test('PUT changes the owner\'s view (not its list); DELETE removes it; both audited', async () => {
    const id = (await create(owner, view())).json().data.id
    const updated = await call(app, { method: 'PUT', url: `/v1/saved-views/${id}`, as: owner, body: view({ name: 'Renamed', sort: 'credited_at_asc' }) })
    const moved = await call(app, { method: 'PUT', url: `/v1/saved-views/${id}`, as: owner, body: view({ list: 'ledger_entries', sort: 'posted_at_desc', columns: ['posted_at'], filters: {} }) })
    const deleted = await call(app, { method: 'DELETE', url: `/v1/saved-views/${id}`, as: owner })

    expect([updated.statusCode, updated.json().data.name, updated.json().data.sort]).toEqual([200, 'Renamed', 'credited_at_asc'])
    expect([moved.statusCode, moved.json().error.details]).toEqual([422, { path: 'list' }])
    expect(deleted.statusCode).toBe(204)
    expect((await list(owner)).json().data.map((v: { id: string }) => v.id)).not.toContain(id)
    expect(await auditOf('SAVED_VIEW.UPDATED', id)).toEqual([{ list: 'orders', name: 'Renamed', shared_role_id: null }])
    expect(await auditOf('SAVED_VIEW.DELETED', id)).toEqual([{ list: 'orders', name: 'Renamed', shared_role_id: null }])
  })

  test('at most SAVED_VIEWS_PER_USER_LIST views per user and list: 422 VIEW_LIMIT', async () => {
    await ownerRows(
      `INSERT INTO saved_view (tenant_id, user_id, list, name, filters, columns, sort)
       SELECT $1, $2, 'orders', 'Bulk ' || i, '{}', '{amount}', 'amount_desc' FROM generate_series(1, $3) i`, [tenantId, colleague.id, SAVED_VIEWS_PER_USER_LIST])
    const refused = await create(colleague, view())

    expect([refused.statusCode, refused.json().error.code]).toEqual([422, 'VIEW_LIMIT'])
    expect((await create(colleague, view({ list: 'ledger_entries', sort: 'posted_at_desc', columns: ['posted_at', 'debit_total'], filters: { origin_type: 'migration' } }))).statusCode).toBe(201)
    await ownerRows(`DELETE FROM saved_view WHERE user_id = $1 AND name LIKE 'Bulk %'`, [colleague.id])
  })

  test('two concurrent creates at one below the limit: one 201, the other 422 VIEW_LIMIT (not 500)', async () => {
    await ownerRows(
      `INSERT INTO saved_view (tenant_id, user_id, list, name, filters, columns, sort)
       SELECT $1, $2, 'orders', 'Bulk ' || i, '{}', '{amount}', 'amount_desc' FROM generate_series(1, $3) i`, [tenantId, colleague.id, SAVED_VIEWS_PER_USER_LIST - 1])
    const raced = await Promise.all(['Race A', 'Race B'].map((name) => create(colleague, view({ name }))))

    expect(raced.map((r) => [r.statusCode, r.statusCode === 201 ? null : r.json().error.code]).sort()).toEqual([[201, null], [422, 'VIEW_LIMIT']])
    await ownerRows(`DELETE FROM saved_view WHERE user_id = $1 AND list = 'orders'`, [colleague.id])
  })
})

describe('sharing (T-B6-30, AC-RPT2-2)', () => {
  test('a view shared with Commission analyst is listed read-only for another analyst, not for a Support agent', async () => {
    const shared = (await create(owner, view({ name: 'Team view', shared_role_id: analystRole }))).json().data
    const seen = (await list(colleague)).json().data.find((v: { id: string }) => v.id === shared.id)
    const put = await call(app, { method: 'PUT', url: `/v1/saved-views/${shared.id}`, as: colleague, body: view({ shared_role_id: analystRole }) })
    const del = await call(app, { method: 'DELETE', url: `/v1/saved-views/${shared.id}`, as: colleague })

    expect(shared.shared_role).toEqual({ id: analystRole, name: 'Commission analyst' })
    expect(seen).toMatchObject({ name: 'Team view', mine: false, owner: { id: owner.id } })
    expect((await list(support)).json().data.map((v: { id: string }) => v.id)).not.toContain(shared.id)
    expect([put.statusCode, del.statusCode]).toEqual([404, 404])
    expect(await auditOf('SAVED_VIEW.CREATED', shared.id)).toEqual([{ list: 'orders', name: 'Team view', shared_role_id: analystRole }])
  })

  test('sharing to a role the owner does not hold, or whose permissions lack the list\'s read permission: 422 ROLE_NOT_SHAREABLE', async () => {
    const notHeld = await create(owner, view({ shared_role_id: await baseRoleId('Finance approver') }))
    const noRead = await create(twoRoles, view({ shared_role_id: await baseRoleId('Plan administrator') }))

    expect([notHeld.statusCode, notHeld.json().error.code]).toEqual([422, 'ROLE_NOT_SHAREABLE'])
    expect([noRead.statusCode, noRead.json().error.code]).toEqual([422, 'ROLE_NOT_SHAREABLE'])
  })

  test('the shared_role_id guard: a base role is accepted, another tenant\'s role is 23514', async () => {
    const [foreignRole] = await ownerRows<{ id: string }>(
      `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, 'Foreign', '{order.read}', false, false) RETURNING id`, [otherTenantId])
    const insert = (roleId: string) => ownerRows(
      `INSERT INTO saved_view (tenant_id, user_id, list, name, filters, columns, sort, shared_role_id)
       VALUES ($1, $2, 'orders', $3, '{}', '{amount}', 'amount_desc', $4)`, [tenantId, owner.id, `Guard ${randomUUID()}`, roleId])

    await expect(insert(analystRole)).resolves.toEqual([])
    await expect(insert(foreignRole!.id)).rejects.toMatchObject({ code: '23514' })
  })
})

describe('permissions and tenancy', () => {
  test('the list\'s read permission is required; another tenant sees and writes nothing', async () => {
    const mine = (await create(owner, view())).json().data.id
    const ledger = await create(support, view({ list: 'ledger_entries', sort: 'posted_at_desc', columns: ['posted_at'], filters: {} }))

    expect([ledger.statusCode, ledger.json().error.code]).toEqual([403, 'PERMISSION_DENIED'])
    expect((await list(support, 'ledger_entries')).statusCode).toBe(403)
    expect((await list(planAdmin)).statusCode).toBe(403)
    expect((await create(finance, view({ list: 'ledger_entries', sort: 'posted_at_asc', columns: ['entry_id'], filters: {} }))).statusCode).toBe(201)
    expect((await list(globex)).json().data).toEqual([])
    expect((await call(app, { method: 'PUT', url: `/v1/saved-views/${mine}`, as: globex, body: view() })).statusCode).toBe(404)
    expect((await call(app, { method: 'DELETE', url: `/v1/saved-views/${mine}`, as: globex })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/v1/saved-views?list=orders' })).statusCode).toBe(401)
  })
})
