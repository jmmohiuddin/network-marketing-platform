import type { Tx } from '@nmp/db'
import { createUser } from '@nmp/db/testing'
import { beforeAll, describe, expect, test } from 'vitest'
import { closePoolsAfterAll, createTenant, ownerRows, resetApiDb } from '../../../test/helpers/index.js'
import { runInVendor } from '../../lib/db.js'
import { enterTenant } from './vendor-tx.js'

// Migration 0011 (E-ADR-21): the support_session guard follows the vendor actor into the tenant realm, where
// inVendorThenTenant and the access hook run. These run as nmp_app, exactly as the API does.
const MAY_ONLY_END = /vendor realm may only end an active support session it requested, or start an approved one/
const MAY_ONLY_REQUEST = /a vendor user may only request a support session/
const WINDOW = `starts_at = now(), ends_at = now() + interval '60 minutes'`

let tenantId: string
let adminId: string
let engineerId: string
let otherEngineerId: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  adminId = (await createUser({ tenantId })).id
  engineerId = (await createUser({ tenantId: null })).id
  otherEngineerId = (await createUser({ tenantId: null })).id
})

/** A transaction of the vendor user that has entered the tenant's realm, as inVendorThenTenant leaves it. */
function asVendorInTenant<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const actor = { actorType: 'vendor_user' as const, requestId: null, supportSessionId: null }
  return runInVendor(userId, actor, async (tx) => {
    await enterTenant(tx, tenantId)
    return fn(tx)
  })
}

/** A session of engineerId in this state, arranged as the owner (no guard applies). */
async function sessionIn(state: 'requested' | 'approved' | 'active'): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO support_session (tenant_id, requester_id, reason, scope, requested_minutes, state)
     VALUES ($1, $2, 'ticket', '{}', 60, 'requested') RETURNING id`,
    [tenantId, engineerId],
  )
  if (state !== 'requested') {
    await ownerRows(`UPDATE support_session SET state = $2, decided_by = $3, ${WINDOW} WHERE id = $1`, [row!.id, state, adminId])
  }
  return row!.id
}

const update = (userId: string, id: string, assignments: string, params: unknown[] = []) =>
  asVendorInTenant(userId, (tx) => tx.query(`UPDATE support_session SET ${assignments} WHERE id = $1`, [id, ...params]))

const stateOf = async (id: string) => (await ownerRows<{ state: string }>('SELECT state FROM support_session WHERE id = $1', [id]))[0]?.state

describe('a vendor actor in the tenant realm', () => {
  test('cannot approve or activate its own request with a tenant admin as decider (the review\'s reproduction)', async () => {
    const id = await sessionIn('requested')

    await expect(update(engineerId, id, `state = 'approved', decided_by = $2, ${WINDOW}`, [adminId])).rejects.toThrow(MAY_ONLY_END)
    await expect(update(engineerId, id, `state = 'active', decided_by = $2, ${WINDOW}`, [adminId])).rejects.toThrow(MAY_ONLY_END)
    await expect(update(engineerId, id, `state = 'denied'`)).rejects.toThrow(MAY_ONLY_END)
    expect(await stateOf(id)).toBe('requested')
  })

  test('cannot insert a decided session or another user\'s request; may insert its own request', async () => {
    const insert = (requester: string, state: string, decidedBy: string | null = null) =>
      asVendorInTenant(engineerId, (tx) => tx.query(
        `INSERT INTO support_session (tenant_id, requester_id, reason, scope, requested_minutes, state, decided_by)
         VALUES ($1, $2, 'ticket', '{}', 60, $3, $4)`,
        [tenantId, requester, state, decidedBy],
      ))

    await expect(insert(engineerId, 'approved', adminId)).rejects.toThrow(MAY_ONLY_REQUEST)
    await expect(insert(otherEngineerId, 'requested')).rejects.toThrow(MAY_ONLY_REQUEST)
    expect((await insert(engineerId, 'requested')).rowCount).toBe(1)
  })

  test('starts an approved session it requested, and changes nothing else on the way', async () => {
    const id = await sessionIn('approved')

    await expect(update(otherEngineerId, id, `state = 'active'`)).rejects.toThrow(MAY_ONLY_END)
    await expect(update(engineerId, id, `state = 'active', ends_at = ends_at + interval '1 day'`)).rejects.toThrow(MAY_ONLY_END)
    expect((await update(engineerId, id, `state = 'active'`)).rowCount).toBe(1)
    expect(await stateOf(id)).toBe('active')
  })

  test('ends only an active session it requested, in either realm', async () => {
    const id = await sessionIn('active')
    const endInVendorRealm = (userId: string) => runInVendor(userId, { actorType: 'vendor_user', requestId: null, supportSessionId: null },
      (tx) => tx.query(`UPDATE support_session SET state = 'ended', ends_at = now() WHERE id = $1`, [id]))

    await expect(endInVendorRealm(otherEngineerId)).rejects.toThrow(MAY_ONLY_END)
    await expect(update(otherEngineerId, id, `state = 'ended', ends_at = now()`)).rejects.toThrow(MAY_ONLY_END)
    expect((await update(engineerId, id, `state = 'ended', ends_at = now()`)).rowCount).toBe(1)
    expect(await stateOf(id)).toBe('ended')
  })
})
