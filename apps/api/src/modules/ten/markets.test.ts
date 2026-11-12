import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { marketName, tenModule } from './index.js'

let app: FastifyInstance
let markets: { gb: string; in: string; fr: string }
let reader: TestUser
let globexReader: TestUser
let vendor: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  markets = { in: await createMarket(acme.id, 'IN'), gb: await createMarket(acme.id, 'GB'), fr: await createMarket(globex.id, 'FR') }
  reader = await createSignedInUser({ tenantId: acme.id })
  globexReader = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  vendor = await createSignedInUser({ tenantId: null })
  app = await buildTestApp({ modules: [tenModule] })
})

afterAll(async () => {
  await app.close()
})

const list = (as?: TestUser) => call(app, { method: 'GET', url: '/v1/markets', ...(as === undefined ? {} : { as }) })

describe('GET /v1/markets', () => {
  test('any signed-in tenant user, even without a role, lists its tenant\'s markets by code, named, with currency', async () => {
    const response = await list(reader)

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([
      { id: markets.gb, code: 'GB', name: 'United Kingdom', currency: 'GBP' },
      { id: markets.in, code: 'IN', name: 'India', currency: 'GBP' },
    ])
  })

  test('another tenant sees only its own markets; vendor users and anonymous callers are refused', async () => {
    const foreign = await list(globexReader)

    expect(foreign.json().data).toEqual([{ id: markets.fr, code: 'FR', name: 'France', currency: 'GBP' }])
    expect(foreign.body).not.toContain(markets.gb)
    expect((await list(vendor)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await list()).statusCode).toBe(401)
  })

  test('a code that is not an ISO region code is named by the code itself', () => {
    expect([marketName('DE'), marketName('M2'), marketName('TINY')]).toEqual(['Germany', 'M2', 'TINY'])
  })
})
