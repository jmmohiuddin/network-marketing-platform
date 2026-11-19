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
  test('ledger opens with ledger.read, payouts and reconciliation with payout.read, cases with the B4 case types', async () => {
    expect(await keys(['Payout officer'])).toEqual(expect.arrayContaining(['ledger', 'payouts', 'reconciliation', 'cases']))
    expect(await keys(['Commission analyst'])).toEqual(expect.arrayContaining(['ledger', 'cases']))
    expect(await keys(['Commission analyst'])).not.toContain('payouts')
    expect(await keys(['Finance approver'])).toEqual(expect.arrayContaining(['ledger', 'payouts', 'reconciliation', 'cases']))
    expect(await keys(['Support agent'])).not.toContain('ledger')
    expect(await keys(['Plan administrator'])).not.toContain('ledger')
  })
})
