import { beforeAll, describe, expect, test } from 'vitest'
import { withTenant, withVendor, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, FOREIGN_KEY_VIOLATION, insertRow, RLS_VIOLATION } from './support.js'

const VENDOR_MAY_ONLY_END = /vendor realm may only end an active support session/
const REQUESTED_MINUTES = 30
const MINUTE_MS = 60_000
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * MINUTE_MS

let admin: TenantContext
let otherTenant: TenantContext
let vendorUserId: string
let otherVendorUserId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  const [tenant, other] = [await createTenant(), await createTenant()]
  admin = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  otherTenant = { tenantId: other.id, userId: (await createUser({ tenantId: other.id })).id }
  vendorUserId = (await createUser({ tenantId: null })).id
  otherVendorUserId = (await createUser({ tenantId: null })).id
})

/** The vendor files a request for the tenant; overrides replace or add columns. */
function request(overrides: Record<string, unknown> = {}): Promise<string> {
  return withVendor({ userId: vendorUserId }, (tx) =>
    insertRow(tx, 'support_session', {
      tenant_id: admin.tenantId, requester_id: vendorUserId, reason: 'ticket 1', scope: { modules: ['import'] },
      requested_minutes: REQUESTED_MINUTES, state: 'requested', ...overrides,
    }),
  )
}

function asVendor(id: string, assignments: string, params: unknown[] = []) {
  return withVendor({ userId: vendorUserId }, (tx) =>
    tx.query(`UPDATE support_session SET ${assignments} WHERE id = $1`, [id, ...params]),
  )
}

function asTenant(ctx: TenantContext, id: string, assignments: string, params: unknown[] = []) {
  return withTenant(ctx, (tx) => tx.query(`UPDATE support_session SET ${assignments} WHERE id = $1`, [id, ...params]))
}

/** A request the tenant admin approved and started for the requested minutes. */
async function activeSession(): Promise<string> {
  const id = await request()
  await asTenant(admin, id, `state = 'approved', decided_by = $2`, [admin.userId])
  await asTenant(admin, id, `state = 'active', starts_at = now(), ends_at = now() + interval '30 minutes'`)
  return id
}

async function stored(id: string) {
  const { rows } = await getOwnerPool().query<{ state: string; decided_by: string | null }>(
    'SELECT state, decided_by FROM support_session WHERE id = $1',
    [id],
  )
  return rows[0]
}

describe('vendor realm', () => {
  test.each([
    ['active and approved by the vendor user for ten years', () => ({
      state: 'active', decided_by: vendorUserId, starts_at: new Date(), ends_at: new Date(Date.now() + TEN_YEARS_MS),
    })],
    ['approved in the name of a tenant user', () => ({ state: 'approved', decided_by: admin.userId })],
    ['requested but already decided', () => ({ decided_by: admin.userId })],
    ['requested with a window', () => ({ starts_at: new Date(), ends_at: new Date(Date.now() + MINUTE_MS) })],
    ['requested in the name of a tenant user', () => ({ requester_id: admin.userId })],
  ])('cannot create a session that is %s', async (_case, overrides) => {
    await expect(request(overrides())).rejects.toThrow(RLS_VIOLATION)
  })

  test('cannot approve, start or deny its own request', async () => {
    const id = await request()

    const attempts = [
      await asVendor(id, `state = 'approved', decided_by = requester_id`),
      await asVendor(id, `state = 'approved', decided_by = $2`, [admin.userId]),
      await asVendor(id, `state = 'active', decided_by = $2, starts_at = now(), ends_at = now() + interval '1 hour'`, [
        admin.userId,
      ]),
      await asVendor(id, `state = 'denied'`),
    ]

    expect(attempts.map((attempt) => attempt.rowCount)).toEqual([0, 0, 0, 0])
    expect(await stored(id)).toEqual({ state: 'requested', decided_by: null })
  })

  test('ends an active session but cannot change anything else about it', async () => {
    const id = await activeSession()

    await expect(asVendor(id, `state = 'ended', scope = '{"modules":["payout"]}'`)).rejects.toThrow(VENDOR_MAY_ONLY_END)
    await expect(asVendor(id, `state = 'ended', ends_at = ends_at + interval '1 day'`)).rejects.toThrow(VENDOR_MAY_ONLY_END)
    await expect(asVendor(id, `state = 'ended', ends_at = NULL`)).rejects.toThrow(VENDOR_MAY_ONLY_END)
    await expect(asVendor(id, `ends_at = ends_at - interval '1 minute'`)).rejects.toThrow(VENDOR_MAY_ONLY_END)
    await expect(asVendor(id, `state = 'expired'`)).rejects.toThrow(VENDOR_MAY_ONLY_END)
    const ended = await asVendor(id, `state = 'ended', ends_at = now()`)
    const reopened = await asVendor(id, `state = 'active'`)

    expect([ended.rowCount, reopened.rowCount]).toEqual([1, 0])
    expect(await stored(id)).toEqual({ state: 'ended', decided_by: admin.userId })
  })
})

describe('tenant decision', () => {
  test('a tenant user approves and starts the session; another tenant cannot touch it', async () => {
    const id = await activeSession()

    const byOtherTenant = await asTenant(otherTenant, id, `state = 'ended'`)

    expect(byOtherTenant.rowCount).toBe(0)
    expect(await stored(id)).toEqual({ state: 'active', decided_by: admin.userId })
  })

  test('the decider must be a user of the tenant, never the requester or another vendor user', async () => {
    const id = await request()
    const decideAs = (userId: string) => asTenant(admin, id, `state = 'approved', decided_by = $2`, [userId])
    const wrongDecider = { code: FOREIGN_KEY_VIOLATION, constraint: 'support_session_tenant_id_decided_by_fkey' }

    await expect(decideAs(vendorUserId)).rejects.toThrow(/support_session_decider_is_not_requester/)
    await expect(decideAs(otherVendorUserId)).rejects.toMatchObject(wrongDecider)
    await expect(decideAs(otherTenant.userId)).rejects.toMatchObject(wrongDecider)
    expect(await stored(id)).toEqual({ state: 'requested', decided_by: null })
  })

  test('access needs a decision, and an active session a window within the requested minutes', async () => {
    const id = await request()

    await expect(asTenant(admin, id, `state = 'approved'`)).rejects.toThrow(/support_session_access_needs_decision/)
    await expect(asTenant(admin, id, `state = 'active', decided_by = $2`, [admin.userId])).rejects.toThrow(
      /support_session_active_has_window/,
    )
    await expect(
      asTenant(admin, id, `state = 'active', decided_by = $2, starts_at = now(), ends_at = now() + interval '31 minutes'`, [
        admin.userId,
      ]),
    ).rejects.toThrow(/support_session_window_within_request/)
  })
})
