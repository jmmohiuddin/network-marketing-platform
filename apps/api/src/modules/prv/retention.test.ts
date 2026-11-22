import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { prvModule } from './index.js'
import { member } from './test-support.js'

const SYSTEM = '00000000-0000-0000-0000-000000000000'

let app: FastifyInstance
let tenantId: string
let gbLeaver: { id: string; ref: string }
let deLeaver: { id: string; ref: string }
let scheduleId: string
let allMarketsDpo: TestUser
let gbDpo: TestUser

closePoolsAfterAll()

/** A participant of the market whose only position was terminated long ago: due under any short schedule. */
async function leaver(marketId: string) {
  const participant = await member(tenantId, marketId)
  const [position] = await ownerRows<{ id: string }>(
    `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
     VALUES ($1, $2, $3, 'terminated', '2025-09-01', $4, 'system') RETURNING id`,
    [tenantId, `pos-${randomUUID().slice(0, 8)}`, marketId, SYSTEM],
  )
  await ownerRows(
    `INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
     VALUES ($1, $2, $3, '2020-01-01', $4, 'system')`,
    [tenantId, position!.id, participant.id, SYSTEM],
  )
  return participant
}

beforeAll(async () => {
  await resetApiDb()
  const tenant = await createTenant()
  tenantId = tenant.id
  const gb = await createMarket(tenantId, 'GB')
  const de = await createMarket(tenantId, 'DE')
  gbLeaver = await leaver(gb)
  deLeaver = await leaver(de)
  allMarketsDpo = await createSignedInUser({ tenantId, roles: ['DPO'], stepUp: true })
  gbDpo = await createSignedInUser({ tenantId, roles: ['DPO'], marketIds: [gb], stepUp: true })
  app = await buildTestApp({ modules: [prvModule] })

  const proposed = await call(app, {
    method: 'POST', url: '/v1/retention/schedules', as: allMarketsDpo, idempotencyKey: true,
    body: { data_class: 'terminated_participant', market_id: null, retain_days: 30, basis: 'Statute', effective_from: new Date().toISOString().slice(0, 10) },
  })
  scheduleId = proposed.json().data.id
})

afterAll(async () => {
  await app.close()
})

const preview = (as: TestUser) => call(app, { method: 'GET', url: `/v1/retention/schedules/${scheduleId}/preview`, as })

describe('GET /v1/retention/schedules/:id/preview (FR-PRV-003, D-V1A-09)', () => {
  test('a holder over all markets sees the due items of every market', async () => {
    const response = await preview(allMarketsDpo)

    expect(response.statusCode).toBe(200)
    expect(response.json().data.due).toBe(2)
    expect(response.json().data.sample.map((item: { object_id: string }) => item.object_id).sort())
      .toEqual([gbLeaver.id, deLeaver.id].sort())
  })

  test('a holder over one market sees only that market: no ids, refs or counts of the others', async () => {
    const response = await preview(gbDpo)

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({
      due: 1, held: 0, sample: [{ object_type: 'participant', object_id: gbLeaver.id, ref: gbLeaver.ref }],
    })
    expect(response.body).not.toContain(deLeaver.id)
    expect(response.body).not.toContain(deLeaver.ref)
  })
})
