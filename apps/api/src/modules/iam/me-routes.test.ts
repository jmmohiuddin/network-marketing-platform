import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, resetApiDb, type TestTenant } from '../../../test/helpers/index.js'
import type { BaseRoleName } from '../../lib/permissions.js'

let app: FastifyInstance
let tenant: TestTenant
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenant = await createTenant()
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const keys = async (roles: BaseRoleName[]) => {
  const user = await createSignedInUser({ tenantId: tenant.id, roles })
  return (await call(app, { method: 'GET', url: '/v1/me', as: user })).json().data.navigation.map((entry: { key: string }) => entry.key) as string[]
}

describe('GET /v1/me navigation (PLAN B4 section 2.6)', () => {
  test('ledger opens with ledger.read, credit.read or fx.*, payouts and reconciliation with payout.read, cases with the B4 case types', async () => {
    expect(await keys(['Payout officer'])).toEqual(expect.arrayContaining(['ledger', 'payouts', 'reconciliation', 'cases']))
    expect(await keys(['Commission analyst'])).toEqual(expect.arrayContaining(['ledger', 'cases']))
    expect(await keys(['Commission analyst'])).not.toContain('payouts')
    expect(await keys(['Finance approver'])).toEqual(expect.arrayContaining(['ledger', 'payouts', 'reconciliation', 'cases']))
    expect(await keys(['Support agent'])).toContain('ledger') // V1-A credit.read: the Credits tab
    expect(await keys(['Plan administrator'])).not.toContain('ledger')
  })

  test('B5: privacy requests and cases (privacy type) open for the DPO, not for read-only roles', async () => {
    expect(await keys(['DPO'])).toEqual(expect.arrayContaining(['privacy', 'cases']))
    expect(await keys(['Executive read-only'])).not.toContain('privacy')
    expect(await keys(['Executive read-only'])).not.toContain('cases')
  })

  test('V1-A: the Compliance officer reaches the legal-holds tab of privacy through legal_hold.manage', async () => {
    expect(await keys(['Compliance officer'])).toContain('privacy')
  })

  test('B6: the overview opens with dashboard.exec, migration with migration.manage or migration.signoff', async () => {
    expect(await keys(['Implementation consultant'])).toEqual(expect.arrayContaining(['imports', 'migration']))
    expect(await keys(['Finance approver'])).toContain('migration')
    expect(await keys(['Executive read-only'])).toContain('overview')
    expect(await keys(['Commission analyst'])).not.toContain('migration')
    expect(await keys(['Commission analyst'])).not.toContain('overview')
    expect(await keys(['Support agent'])).not.toContain('migration')
  })

  test('B-MKT: tax opens with tax.read (Finance approver, Compliance officer); grievance holders keep the Cases nav', async () => {
    expect(await keys(['Finance approver'])).toContain('tax')
    expect(await keys(['Compliance officer'])).toEqual(expect.arrayContaining(['tax', 'cases']))
    expect(await keys(['Support agent'])).toContain('cases')
    expect(await keys(['Support agent'])).not.toContain('tax')
    expect(await keys(['Commission analyst'])).not.toContain('tax')
  })
})
