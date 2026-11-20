import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestUser,
} from '../../../test/helpers/index.js'
import { taxModule } from './index.js'

// D-B5-13 / AC-DIST6-2 / T-B5-23: the payee's own tax profile through the portal.

let app: FastifyInstance
let tenantId: string
let market: string

closePoolsAfterAll()

async function payee(tenant: string, marketId: string, stepUp = true): Promise<{ id: string; user: TestUser }> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, contact, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $4, '2025-01-01', '00000000-0000-0000-0000-000000000000', 'system') RETURNING id`,
    [tenant, `TAX-${randomUUID().slice(0, 8)}`, marketId, { email: `tax-${randomUUID().slice(0, 8)}@example.test` }],
  )
  return { id: row!.id, user: await createPortalUser({ tenantId: tenant, participantId: row!.id, stepUp }) }
}

const put = (as: TestUser, body: unknown) => call(app, { method: 'PUT', url: '/v1/me/tax-profile', as, body, idempotencyKey: true })
const get = (as: TestUser) => call(app, { method: 'GET', url: '/v1/me/tax-profile', as })

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  market = await createMarket(tenantId, 'GB')
  app = await buildTestApp({ modules: [taxModule] })
})

afterAll(async () => {
  await app.close()
})

describe('PUT/GET /v1/me/tax-profile', () => {
  test('saves a masked version, closes the previous at the same instant and notifies (mandatory)', async () => {
    const p = await payee(tenantId, market)
    const first = await put(p.user, { residency: 'GB', entity_type: 'individual', tax_id: 'ab 123 456 789' })
    expect(first.statusCode).toBe(201)
    expect(first.json().data).toMatchObject({ residency: 'GB', entity_type: 'individual', tax_id_masked: '•••• 6789', valid_to: null })
    const second = await put(p.user, { residency: 'IE', entity_type: 'individual' })
    expect(second.json().data).toMatchObject({ residency: 'IE', tax_id_masked: '•••• 6789' })

    const read = await get(p.user)
    expect(read.json().data.current).toMatchObject({ residency: 'IE', tax_id_masked: '•••• 6789' })
    expect(read.json().data.history).toEqual([expect.objectContaining({ residency: 'GB', valid_to: read.json().data.current.valid_from })])
    expect(read.body).not.toMatch(/sealed|AB123456789/)
    expect(await ownerRows(
      `SELECT 1 FROM notification WHERE recipient_participant_id = $1 AND template = 'tax_profile.changed' AND channel = 'in_app'`, [p.id])).toHaveLength(2)
    expect(await ownerRows(
      `SELECT 1 FROM notification WHERE recipient_participant_id = $1 AND template = 'tax_profile.changed' AND params::text LIKE '%AB123%'`, [p.id])).toHaveLength(0)
    expect(await auditActions(tenantId)).toContain('TAX_PROFILE.CHANGED')
  })

  test('re-authentication, format and required fields are checked before anything is written', async () => {
    const p = await payee(tenantId, market, false)
    expect((await put(p.user, { residency: 'GB', entity_type: 'individual' })).json().error.code).toBe('STEP_UP_REQUIRED')
    const fresh = await payee(tenantId, market)
    expect((await put(fresh.user, { residency: 'GB', entity_type: 'individual', tax_id: '!!' })).json().error.code).toBe('TAX_ID_FORMAT')
    expect((await put(fresh.user, { residency: 'GB' })).json().error.code).toBe('VALIDATION_FAILED')
    expect(await ownerRows('SELECT 1 FROM tax_profile WHERE participant_id IN ($1, $2)', [p.id, fresh.id])).toHaveLength(0)
  })

  test('only the payee itself: another participant or tenant sees nothing; staff sessions are refused', async () => {
    const p = await payee(tenantId, market)
    await put(p.user, { residency: 'GB', entity_type: 'company' })
    expect((await get((await payee(tenantId, market)).user)).json().data).toEqual({ current: null, history: [], format: null })
    const other = (await createTenant()).id
    expect((await get((await payee(other, await createMarket(other))).user)).json().data).toEqual({ current: null, history: [], format: null })
    const staff = await createSignedInUser({ tenantId, roles: ['Finance approver'], stepUp: true })
    expect((await get(staff)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await put(staff, { residency: 'GB', entity_type: 'company' })).json().error.code).toBe('REALM_FORBIDDEN')
  })
})
