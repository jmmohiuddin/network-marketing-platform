import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, closePoolsAfterAll, ownerRows, resetApiDb } from '../../../test/helpers/index.js'
import { cplModule } from '../cpl/index.js'
import { plnModule } from './index.js'
import { newPlan, personal, putRule, UNILEVEL, world, type World } from './test-support.js'

// PLAN V1-A section 2.4 (D-V1A-03): a pay rule may pay in a credit type; the compiled rule carries award {creditType}, so
// content_hash covers it.

let app: FastifyInstance
let w: World
closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [plnModule, cplModule] })
  w = await world()
  await ownerRows(
    `INSERT INTO credit_type (tenant_id, code, name, taxable, active, created_by, updated_by)
     VALUES ($1, 'PRODUCT_CREDIT', 'Product credit', false, true, $2, $2), ($1, 'OLD_CREDIT', 'Old credit', true, false, $2, $2)`,
    [w.tenantId, w.finance.id])
}, 120_000)

afterAll(async () => {
  await app.close()
})

const versionOf = async (planId: string) =>
  (await ownerRows<{ compiled: Record<string, { bonuses: { key: string; award?: unknown }[] }>; hash: string }>(
    `SELECT compiled, encode(content_hash, 'hex') AS hash FROM plan_version WHERE plan_id = $1 AND version = 1`, [planId]))[0]!

describe('PUT rule credit_type_code (D-V1A-03)', () => {
  test('a pay rule pays in an active credit type: the view shows the code, the compiled rule the award, the hash changes', async () => {
    const { planId, calendarA } = await newPlan(app, w)
    expect((await putRule(app, w.planadmin, planId, 'pv', { kind: 'volume.personal', params: personal() })).statusCode).toBe(200)
    expect((await putRule(app, w.planadmin, planId, 'unilevel', UNILEVEL)).statusCode).toBe(200)
    const cash = await versionOf(planId)
    const saved = await putRule(app, w.planadmin, planId, 'unilevel', { ...UNILEVEL, credit_type_code: 'PRODUCT_CREDIT' })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json().data.rule).toMatchObject({ credit_type_code: 'PRODUCT_CREDIT', params: UNILEVEL.params })
    expect(saved.json().data.rule.rendering).toMatch(/paid in credits PRODUCT_CREDIT/)
    const credits = await versionOf(planId)
    expect(credits.compiled[calendarA]!.bonuses.find((b) => b.key === 'unilevel')!.award).toEqual({ creditType: 'PRODUCT_CREDIT' })
    expect(credits.hash).not.toBe(cash.hash)
    const back = await putRule(app, w.planadmin, planId, 'unilevel', { ...UNILEVEL, credit_type_code: null })
    expect(back.json().data.rule.credit_type_code).toBeNull()
    expect((await versionOf(planId)).hash).toBe(cash.hash)
  })

  test('unknown or inactive credit types, non-pay kinds and a direct award are refused; nothing is stored', async () => {
    const { planId } = await newPlan(app, w)
    const refused = async (body: Record<string, unknown>) => {
      const response = await putRule(app, w.planadmin, planId, 'rule', body)
      return [response.statusCode, response.json().error.code]
    }
    expect(await refused({ ...UNILEVEL, credit_type_code: 'NO_SUCH' })).toEqual([422, 'CREDIT_TYPE_UNKNOWN'])
    expect(await refused({ ...UNILEVEL, credit_type_code: 'OLD_CREDIT' })).toEqual([422, 'CREDIT_TYPE_INACTIVE'])
    expect(await refused({ kind: 'volume.personal', params: personal(), credit_type_code: 'PRODUCT_CREDIT' })).toEqual([422, 'VALIDATION_FAILED'])
    expect(await refused({ ...UNILEVEL, params: { ...UNILEVEL.params, award: { creditType: 'PRODUCT_CREDIT' } } })).toEqual([422, 'VALIDATION_FAILED'])
    expect(await refused({ ...UNILEVEL, credit_type_code: 'lower_case' })).toEqual([400, 'VALIDATION_FAILED'])
    expect(await ownerRows('SELECT 1 FROM plan_rule r JOIN plan_version v ON v.id = r.plan_version_id WHERE v.plan_id = $1', [planId])).toEqual([])
  })

  test('a credit type of another tenant is unknown here', async () => {
    const other = await world()
    const { planId } = await newPlan(app, other)
    const response = await putRule(app, other.planadmin, planId, 'unilevel', { ...UNILEVEL, credit_type_code: 'PRODUCT_CREDIT' })
    expect([response.statusCode, response.json().error.code]).toEqual([422, 'CREDIT_TYPE_UNKNOWN'])
  })
})
