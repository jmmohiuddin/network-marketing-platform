// Referential checks bypass RLS, so the keys themselves must keep a row inside its tenant.
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { inOneHour, seedTenantRows, seedVendorRows, type TenantSeed, type VendorSeed } from './seed.js'
import { closePoolsAfterAll, FOREIGN_KEY_VIOLATION, insertRow } from './support.js'

const ROLE_NOT_IN_TENANT = /role_id must be a base role or a role of the same tenant/

let a: TenantContext
let b: TenantContext
let secondUserA: string
let vendorUserId: string
let seedA: TenantSeed
let seedB: TenantSeed
let vendorSeed: VendorSeed

closePoolsAfterAll()

beforeAll(async () => {
  await resetTestDb()
  const [tenantA, tenantB] = [await createTenant(), await createTenant()]
  a = { tenantId: tenantA.id, userId: (await createUser({ tenantId: tenantA.id })).id }
  b = { tenantId: tenantB.id, userId: (await createUser({ tenantId: tenantB.id })).id }
  secondUserA = (await createUser({ tenantId: a.tenantId })).id
  vendorUserId = (await createUser({ tenantId: null })).id
  seedA = await seedTenantRows(a, secondUserA)
  seedB = await seedTenantRows(b, (await createUser({ tenantId: b.tenantId })).id)
  vendorSeed = await seedVendorRows(vendorUserId, a.tenantId)
})

/** Tenant A grants a role to userId, as nmp_app in its own context. */
function assignRole(userId: string, roleId: string): Promise<string> {
  return withTenant(a, (tx) =>
    insertRow(tx, 'role_assignment', { tenant_id: a.tenantId, user_id: userId, role_id: roleId, valid_from: new Date() }),
  )
}

// nmp_app opens sessions only through auth_open_session (0041), which inserts as the owner: the keys must hold
// for the owner role, so these inserts run as the owner.
async function insertSession(row: { user_id: string; tenant_id: string | null; realm: string; token_hash?: Buffer }) {
  const owner = await getOwnerPool().connect()
  try {
    return await insertRow(owner, 'session', { token_hash: randomBytes(32), assurance_level: 'aal2', expires_at: inOneHour(), ...row })
  } finally {
    owner.release()
  }
}

/** The parts of a rejection that a caller could tell apart; ids in the detail text are left out. */
async function rejection(attempt: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  const error = await attempt.then(
    () => undefined,
    (reason: unknown) => reason as { code?: string; constraint?: string },
  )
  if (error === undefined) throw new Error('expected the statement to be rejected')
  return { code: error.code, constraint: error.constraint }
}

describe('references from tenant A to rows it cannot see', () => {
  test('tenant A cannot see the rows it tries to reference', async () => {
    const visible = await withTenant(a, async (tx) => {
      const users = await tx.query('SELECT 1 FROM user_account WHERE id = ANY($1)', [[b.userId, vendorUserId]])
      const roles = await tx.query('SELECT 1 FROM role WHERE id = ANY($1)', [[seedB.roleId, vendorSeed.vendorRoleId]])
      const markets = await tx.query('SELECT 1 FROM market WHERE id = $1', [seedB.marketId])
      return [users.rowCount, roles.rowCount, markets.rowCount]
    })

    expect(visible).toEqual([0, 0, 0])
  })

  test('a role assignment cannot name a user of another tenant, and fails as for an unknown user', async () => {
    const foreign = await rejection(assignRole(b.userId, seedA.roleId))
    const unknown = await rejection(assignRole(randomUUID(), seedA.roleId))

    expect(foreign).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint: 'role_assignment_tenant_id_user_id_fkey' })
    expect(unknown).toEqual(foreign)
  })

  test('a role assignment takes a base role or a role of its own tenant, nothing else', async () => {
    const allowed = [await assignRole(a.userId, seedA.roleId), await assignRole(a.userId, vendorSeed.baseRoleId)]

    expect(allowed).toHaveLength(2)
    await expect(assignRole(a.userId, seedB.roleId)).rejects.toThrow(ROLE_NOT_IN_TENANT)
    await expect(assignRole(a.userId, vendorSeed.vendorRoleId)).rejects.toThrow(ROLE_NOT_IN_TENANT)
    await expect(assignRole(a.userId, randomUUID())).rejects.toThrow(ROLE_NOT_IN_TENANT)
    await expect(
      withTenant(a, (tx) => tx.query('UPDATE role_assignment SET role_id = $1', [seedB.roleId])),
    ).rejects.toThrow(ROLE_NOT_IN_TENANT)
  })

  test('an approval cannot be prepared or given by a vendor user or a user of another tenant', async () => {
    const approve = (preparerId: string, approverId: string) =>
      withTenant(a, (tx) =>
        insertRow(tx, 'approval', {
          tenant_id: a.tenantId, object_type: 'role_assignment', object_id: randomUUID(), preparer_id: preparerId,
          approver_id: approverId, decision: 'approved', decided_at: new Date(),
        }),
      )
    const badApprover = { code: FOREIGN_KEY_VIOLATION, constraint: 'approval_tenant_id_approver_id_fkey' }

    await expect(approve(a.userId, vendorUserId)).rejects.toMatchObject(badApprover)
    await expect(approve(a.userId, b.userId)).rejects.toMatchObject(badApprover)
    await expect(approve(b.userId, secondUserA)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'approval_tenant_id_preparer_id_fkey',
    })
  })

  test('an import batch cannot use a market, mapping or predecessor of another tenant', async () => {
    const batch = (overrides: Record<string, unknown>) =>
      withTenant(a, (tx) =>
        insertRow(tx, 'import_batch', {
          tenant_id: a.tenantId, market_id: seedA.marketId, kind: 'overlay', period_from: '2026-02-01',
          period_to: '2026-02-28', state: 'uploaded', uploaded_by: a.userId, ...overrides,
        }),
      )
    const violates = (constraint: string) => ({ code: FOREIGN_KEY_VIOLATION, constraint })

    await expect(batch({ market_id: seedB.marketId })).rejects.toMatchObject(violates('import_batch_tenant_id_market_id_fkey'))
    await expect(batch({ mapping_id: seedB.mappingId })).rejects.toMatchObject(violates('import_batch_tenant_id_mapping_id_fkey'))
    // Deferred key: refused at commit.
    await expect(batch({ superseded_by: seedB.batchId })).rejects.toMatchObject(
      violates('import_batch_tenant_id_superseded_by_fkey'),
    )
  })
})

describe('sessions', () => {
  test('a tenant session cannot pair the tenant with a user of another tenant', async () => {
    const tokenHash = randomBytes(32)
    const pair = (userId: string) => insertSession({ user_id: userId, tenant_id: a.tenantId, realm: 'tenant', token_hash: tokenHash })

    const foreign = await rejection(pair(b.userId))
    const unknown = await rejection(pair(randomUUID()))
    const found = await withSystem((tx) => tx.query('SELECT 1 FROM auth_find_session($1)', [tokenHash]))

    expect(foreign).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint: 'session_tenant_id_user_id_fkey' })
    expect(unknown).toEqual(foreign)
    expect(found.rowCount).toBe(0)
  })

  test('the session realm must be the realm of its user', async () => {
    const realmMismatch = { code: FOREIGN_KEY_VIOLATION, constraint: 'session_user_id_realm_fkey' }

    await expect(insertSession({ user_id: a.userId, tenant_id: null, realm: 'vendor' })).rejects.toMatchObject(realmMismatch)
    await expect(insertSession({ user_id: a.userId, tenant_id: a.tenantId, realm: 'portal' })).rejects.toMatchObject(realmMismatch)
  })
})
