// PLAN B1 section 1.9: recordApproval and eligibleApprovers (FR-IAM-004, D-B1-03).
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { eligibleApprovers, recordApproval, withTenant, type ApprovalInput, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, count } from './support.js'

const PERMISSION = 'settings.approve'
const HOUR_MS = 3_600_000

let tenantId: string
let marketId: string
let otherMarketId: string
// Named so the expected order (display_name, email) reads off the names.
const users: Record<string, string> = {}

closePoolsAfterAll()

async function user(name: string, options: { tenant?: string; state?: string; mfa?: boolean } = {}): Promise<string> {
  const id = (await createUser({ tenantId: options.tenant ?? tenantId, state: options.state ?? 'active' })).id
  await getOwnerPool().query('UPDATE user_account SET display_name = $2, mfa_enrolled = $3 WHERE id = $1', [
    id, name, options.mfa ?? false,
  ])
  users[name] = id
  return id
}

async function role(tenant: string, permissions: string[], mfaRequired: boolean): Promise<string> {
  const { rows } = await getOwnerPool().query<{ id: string }>(
    `INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, $2, $3, false, $4) RETURNING id`,
    [tenant, `role-${randomUUID()}`, permissions, mfaRequired],
  )
  return rows[0]!.id
}

async function assign(userId: string, roleId: string, grant: { markets?: string[]; from?: Date; to?: Date } = {}) {
  const { rows } = await getOwnerPool().query<{ tenant_id: string }>('SELECT tenant_id FROM user_account WHERE id = $1', [
    userId,
  ])
  await getOwnerPool().query(
    `INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from, valid_to)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [rows[0]!.tenant_id, userId, roleId, grant.markets ?? null, grant.from ?? new Date(Date.now() - HOUR_MS), grant.to ?? null],
  )
}

beforeAll(async () => {
  await resetTestDb()
  tenantId = (await createTenant()).id
  const otherTenantId = (await createTenant()).id
  const market = (code: string) =>
    getOwnerPool().query<{ id: string }>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES ($1, $2, 'GBP', 2, 'Europe/London', '{en}', 'gb-1', 'draft') RETURNING id`,
      [tenantId, code],
    )
  marketId = (await market('GB')).rows[0]!.id
  otherMarketId = (await market('IE')).rows[0]!.id
  const approver = await role(tenantId, [PERMISSION], false)
  const strongApprover = await role(tenantId, [PERMISSION], true)
  const other = await role(tenantId, ['audit.read'], false)
  const now = Date.now()
  await assign(await user('A preparer'), approver)
  await assign(await user('B contributor'), approver)
  await assign(await user('C excluded'), approver)
  await assign(await user('D all markets'), approver)
  await assign(await user('E this market'), approver, { markets: [marketId] })
  await assign(await user('F enrolled', { mfa: true }), strongApprover)
  await user('G no assignment')
  await assign(await user('H other permission'), other)
  await assign(await user('I other market'), approver, { markets: [otherMarketId] })
  await assign(await user('J expired'), approver, { from: new Date(now - 2 * HOUR_MS), to: new Date(now - HOUR_MS) })
  await assign(await user('K not yet'), approver, { from: new Date(now + HOUR_MS) })
  await assign(await user('L not enrolled'), strongApprover)
  await assign(await user('M locked', { state: 'locked' }), approver)
  await assign(await user('N other tenant', { tenant: otherTenantId }), await role(otherTenantId, [PERMISSION], false))
})

const asUser = <T>(name: string, fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant({ tenantId, userId: users[name]! }, fn)

function input(overrides: Partial<ApprovalInput> = {}): ApprovalInput {
  return {
    objectType: 'setting_change_request', objectId: randomUUID(), preparerId: users['A preparer']!,
    contributorIds: [users['B contributor']!], excludedIds: [users['C excluded']!], decision: 'approved', reason: 'ok',
    factorVerifiedAt: null, approverPermission: PERMISSION, marketId, ...overrides,
  }
}

const names = (list: readonly { user_id: string }[]) =>
  list.map((entry) => Object.keys(users).find((name) => users[name] === entry.user_id))

describe('eligibleApprovers', () => {
  test('lists active users holding the permission now, over the market, with MFA where the role needs it', async () => {
    const eligible = await asUser('A preparer', (tx) =>
      eligibleApprovers(tx, { permission: PERMISSION, marketId, excludeUserIds: [users['C excluded']!] }),
    )

    expect(names(eligible)).toEqual(['A preparer', 'B contributor', 'D all markets', 'E this market', 'F enrolled'])
  })

  test('without a market, a market-scoped grant counts', async () => {
    const eligible = await asUser('A preparer', (tx) =>
      eligibleApprovers(tx, { permission: PERMISSION, marketId: null, excludeUserIds: [] }),
    )

    expect(names(eligible)).toContain('I other market')
  })

  test('is empty when nobody may approve', async () => {
    const eligible = await asUser('A preparer', (tx) =>
      eligibleApprovers(tx, { permission: 'market.signoff', marketId, excludeUserIds: [] }),
    )

    expect(eligible).toEqual([])
  })
})

describe('recordApproval', () => {
  test.each(['A preparer', 'B contributor', 'C excluded'])('refuses %s with SOD-01 and records nothing', async (name) => {
    const outcome = await asUser(name, (tx) => recordApproval(tx, input()))

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'SOD-01' })
    expect(outcome.ok === false && names(outcome.eligibleApprovers)).toEqual(['D all markets', 'E this market', 'F enrolled'])
    expect(await asUser(name, (tx) => count(tx, 'approval'))).toBe(0)
  })

  test('a refusal with nobody eligible carries an empty list', async () => {
    const outcome = await asUser('A preparer', (tx) => recordApproval(tx, input({ approverPermission: 'market.signoff' })))

    expect(outcome).toEqual({ ok: false, reasonCode: 'SOD-01', eligibleApprovers: [] })
  })

  test('an independent approver records exactly one approval, given by the acting user', async () => {
    const decision = input({ decision: 'rejected', factorVerifiedAt: new Date() })
    const outcome = await asUser('D all markets', (tx) => recordApproval(tx, decision))
    const { rows } = await getOwnerPool().query(
      'SELECT object_type, object_id, preparer_id, approver_id, decision, reason, created_by FROM approval',
    )

    expect(outcome).toMatchObject({ ok: true })
    expect(rows).toEqual([{
      object_type: 'setting_change_request', object_id: decision.objectId, preparer_id: users['A preparer'],
      approver_id: users['D all markets'], decision: 'rejected', reason: 'ok', created_by: users['D all markets'],
    }])
  })
})
