import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { audModule } from '../aud/index.js'
import { iamModule } from '../iam/index.js'
import { tenModule } from '../ten/index.js'
import { createImpModule, loadedBatches } from './index.js'
import { approvedMappingId, recordBreachContact, SYNTHETIC_MAPPING, TINY_MAPPING, tinyFiles, upload } from './test-support.js'

let app: FastifyInstance
let uploadDir: string
let acme: TestTenant
let demoMarket: string
let spanMarket: string
let consultant: TestUser
let approver: TestUser
let globexConsultant: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  demoMarket = await createMarket(acme.id, 'DEMO')
  await createMarket(acme.id, 'TINY')
  spanMarket = await createMarket(acme.id, 'SPAN')
  consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
  approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  globexConsultant = await createSignedInUser({ tenantId: globex.id, roles: ['Implementation consultant'] })
  uploadDir = await mkdtemp(join(tmpdir(), 'nmp-imp-load-'))
  app = await buildTestApp({ modules: [iamModule, tenModule, audModule, createImpModule({ uploadDir })] })
})

afterAll(async () => {
  await app.close()
})

const attach = (batchId: string, mappingId: string) =>
  call(app, { method: 'POST', url: `/v1/imports/${batchId}/mapping`, as: consultant, body: { mapping_id: mappingId } })
const load = (batchId: string) => call(app, { method: 'POST', url: `/v1/imports/${batchId}/load`, as: consultant })
const batchOf = async (batchId: string) => (await call(app, { method: 'GET', url: `/v1/imports/${batchId}`, as: consultant })).json().data
const uploadTiny = async () => (await upload(app, consultant, { files: tinyFiles(), market: 'TINY', from: '2025-01', to: '2025-01' })).json().data.id as string
/** The tiny export with its orders and payout lines moved to another month. */
const tinyFilesIn = (month: string) => tinyFiles({
  orders: String(tinyFiles().orders).replaceAll('2025-01', month),
  payout_lines: String(tinyFiles().payout_lines).replaceAll('2025-01', month),
})

interface FactTotals {
  participants: number
  end_customers: number
  earners: number
  orders: number
  starter_kits: number
  order_amount: string
  order_refunded: string
  lines: number
  line_amount: string
}

async function factTotals(batchId: string): Promise<FactTotals> {
  const [totals] = await ownerRows<FactTotals & Record<string, unknown>>(
    `SELECT p.*, o.*, l.* FROM
       (SELECT count(*)::int AS participants, count(*) FILTER (WHERE counts_as_end_customer)::int AS end_customers,
               count(*) FILTER (WHERE can_earn)::int AS earners FROM cpl_fact_participant WHERE batch_id = $1) p,
       (SELECT count(*)::int AS orders, count(*) FILTER (WHERE is_starter_kit)::int AS starter_kits,
               coalesce(sum(amount_minor), 0)::text AS order_amount, coalesce(sum(refunded_minor), 0)::text AS order_refunded
        FROM cpl_fact_order WHERE batch_id = $1) o,
       (SELECT count(*)::int AS lines, coalesce(sum(amount_minor), 0)::text AS line_amount FROM cpl_fact_payout_line WHERE batch_id = $1) l`,
    [batchId],
  )
  return totals!
}

describe('the synthetic export end to end (FR-IMP-001..003)', () => {
  let firstId: string
  let mappingId: string

  test('uploads, validates, maps and loads with control totals 1,466 / 4,775 / 7,442', async () => {
    firstId = (await upload(app, consultant)).json().data.id
    mappingId = await approvedMappingId(app, consultant, approver, SYNTHETIC_MAPPING)

    const mapped = await attach(firstId, mappingId)
    const withoutContact = await load(firstId)
    expect(mapped.json().data).toMatchObject({ state: 'mapped', mapping_id: mappingId, mapping_version: 1 })
    expect([withoutContact.statusCode, withoutContact.json().error.code]).toEqual([422, 'BREACH_CONTACT_REQUIRED'])
    expect((await factTotals(firstId)).participants).toBe(0)

    await recordBreachContact(acme.id, consultant.id)
    const loaded = await load(firstId)

    expect(loaded.statusCode).toBe(200)
    expect(loaded.json()).toMatchObject({ data: { state: 'loaded' }, meta: { superseded: [] } })
    expect(loaded.json().data.data_quality).toEqual({
      orders: 4775, orders_unknown_purpose: 177, refunded_orders: 235, refunds_without_month: 0, payout_lines: 7442,
      payout_lines_without_source_order: 94, payout_lines_unknown_source_kind: 0, unmapped: { purposes: [], source_kinds: [] },
    })
    expect(await factTotals(firstId)).toEqual({
      participants: 1466, end_customers: 1017, earners: 449, orders: 4775, starter_kits: 429, order_amount: '53195001',
      order_refunded: '2600070', lines: 7442, line_amount: '9225679',
    })
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['IMPORT.MAPPED', 'IMPORT.LOADED']))
  })

  test('the tenant region is locked from the first load on', async () => {
    await expect(ownerRows(`UPDATE tenant SET region = 'zz-test' WHERE id = $1`, [acme.id])).rejects.toThrow(/region cannot change/)
  })

  test('re-importing the period supersedes the earlier batch, which stays readable (AC-39.2, BR-IMP-04)', async () => {
    const secondId = (await upload(app, consultant)).json().data.id as string
    await attach(secondId, mappingId)
    const loaded = await load(secondId)
    const first = await batchOf(firstId)
    const inForce = await withTenant({ tenantId: acme.id, userId: consultant.id }, (tx) =>
      loadedBatches(tx, demoMarket, '2025-06-01', '2025-06-30'))

    expect(loaded.json().meta.superseded).toEqual([firstId])
    expect(first).toMatchObject({ state: 'superseded', superseded_by: secondId })
    expect((await factTotals(firstId)).orders).toBe(4775)
    expect(inForce).toEqual([{ id: secondId, mappingId, mappingVersion: 1, periodFrom: '2025-01-01', periodTo: '2025-12-31' }])
    expect((await auditActions(acme.id)).slice(-2)).toEqual(['IMPORT.SUPERSEDED', 'IMPORT.LOADED'])
  })
})

describe('periods of loaded batches (BR-IMP-04)', () => {
  test('a load supersedes the loaded batches within its period and is refused when one reaches outside it', async () => {
    const mappingId = await approvedMappingId(app, consultant, approver, TINY_MAPPING)
    const loadSpan = async (from: string, to: string) => {
      const id = (await upload(app, consultant, { files: tinyFilesIn(from), market: 'SPAN', from, to })).json().data.id as string
      await attach(id, mappingId)
      return { id, response: await load(id) }
    }

    const june = await loadSpan('2025-06', '2025-06')
    const year = await loadSpan('2025-01', '2025-12')
    const juneAgain = await loadSpan('2025-06', '2025-06')
    const inForce = await withTenant({ tenantId: acme.id, userId: consultant.id }, (tx) =>
      loadedBatches(tx, spanMarket, '2025-01-01', '2025-12-31'))

    expect(year.response.json().meta.superseded).toEqual([june.id])
    expect(juneAgain.response.statusCode).toBe(409)
    expect(juneAgain.response.json().error).toMatchObject({ code: 'IMPORT_PERIOD_OVERLAP', details: { batch_ids: [year.id] } })
    expect((await batchOf(juneAgain.id)).state).toBe('mapped')
    expect((await factTotals(juneAgain.id)).orders).toBe(0)
    expect(inForce.map((batch) => batch.id)).toEqual([year.id])
  })
})

describe('mapping partner codes', () => {
  test('unmapped purposes and source kinds load as unknown and are reported (FR-IMP-002)', async () => {
    const mappingId = await approvedMappingId(app, consultant, approver, TINY_MAPPING)
    const batchId = await uploadTiny()
    await attach(batchId, mappingId)

    const loaded = await load(batchId)
    const orders = await ownerRows('SELECT order_ref, purpose, is_starter_kit FROM cpl_fact_order WHERE batch_id = $1 ORDER BY order_ref', [batchId])
    const lines = await ownerRows('SELECT line_ref, source_kind, source_order_ref FROM cpl_fact_payout_line WHERE batch_id = $1 ORDER BY line_ref', [batchId])

    expect(loaded.json().data.data_quality).toEqual({
      orders: 2, orders_unknown_purpose: 1, refunded_orders: 1, refunds_without_month: 0, payout_lines: 2,
      payout_lines_without_source_order: 1, payout_lines_unknown_source_kind: 1, unmapped: { purposes: ['own'], source_kinds: ['leader_pool'] },
    })
    expect(orders).toEqual([
      { order_ref: 'O1', purpose: 'customer', is_starter_kit: false }, { order_ref: 'O2', purpose: 'unknown', is_starter_kit: true },
    ])
    expect(lines).toEqual([
      { line_ref: 'L1', source_kind: 'retail_sale', source_order_ref: 'O1' }, { line_ref: 'L2', source_kind: 'unknown', source_order_ref: null },
    ])
  })

  test('starter-kit codes other than the published 0 and 1 must be mapped (FR-IMP-002)', async () => {
    const orders = String(tinyFiles().orders).replace(',own,1,', ',own,Y,')
    const batchId = (await upload(app, consultant, { files: tinyFiles({ orders }), market: 'TINY', from: '2025-01', to: '2025-01' })).json().data.id
    const unmapped = await attach(batchId, await approvedMappingId(app, consultant, approver, TINY_MAPPING))
    await attach(batchId, await approvedMappingId(app, consultant, approver, { ...TINY_MAPPING, starter_kits: { Y: true } }))

    const loaded = await load(batchId)
    const kits = await ownerRows('SELECT order_ref, is_starter_kit FROM cpl_fact_order WHERE batch_id = $1 ORDER BY order_ref', [batchId])

    expect([unmapped.statusCode, unmapped.json().error.code, unmapped.json().error.details]).toEqual([422, 'MAPPING_INCOMPLETE', { starter_kits: ['Y'] }])
    expect(loaded.statusCode).toBe(200)
    expect(kits).toEqual([{ order_ref: 'O1', is_starter_kit: false }, { order_ref: 'O2', is_starter_kit: true }])
  })

  test('only an approved, known mapping that covers every participant type can be attached', async () => {
    const batchId = await uploadTiny()
    const latest = (await call(app, { method: 'GET', url: '/v1/import-mappings', as: consultant })).headers.etag as string
    const draft = (await call(app, { method: 'PUT', url: '/v1/import-mappings', as: consultant, body: { mappings: TINY_MAPPING }, headers: { 'if-match': latest } })).json().data
    const partial = await approvedMappingId(app, consultant, approver, { ...TINY_MAPPING, participant_types: { dist: { counts_as_end_customer: false, can_earn: true } } })
    const foreign = (await call(app, { method: 'PUT', url: '/v1/import-mappings', as: globexConsultant, body: { mappings: TINY_MAPPING }, headers: { 'if-match': '"0"' } })).json().data

    const responses = await Promise.all([attach(batchId, draft.id), attach(batchId, partial), attach(batchId, randomUUID()), attach(batchId, foreign.id)])

    expect(responses.map((response) => response.json().error.code)).toEqual(['MAPPING_NOT_APPROVED', 'MAPPING_INCOMPLETE', 'MAPPING_UNKNOWN', 'MAPPING_UNKNOWN'])
    expect(responses[1]!.json().error.details).toEqual({ participant_types: ['cust'] })
    expect((await batchOf(batchId)).state).toBe('validated')
  })
})

describe('lifecycle guards', () => {
  test('a batch loads only from mapped, once; a rejected batch cannot be mapped', async () => {
    const validatedId = await uploadTiny()
    const rejectedId = (await upload(app, consultant, { files: tinyFiles({ orders: 'order_id\n' }), market: 'TINY', from: '2025-01', to: '2025-01' })).json().data.id
    const mappingId = await approvedMappingId(app, consultant, approver, TINY_MAPPING)
    const tooEarly = await load(validatedId)
    const rejected = await attach(rejectedId, mappingId)
    await attach(validatedId, mappingId)
    await load(validatedId)
    const twice = await load(validatedId)

    expect([tooEarly.statusCode, tooEarly.json().error.details]).toEqual([409, { state: 'validated' }])
    expect([rejected.statusCode, rejected.json().error.code]).toEqual([409, 'IMPORT_STATE_CONFLICT'])
    expect([twice.statusCode, twice.json().error.details]).toEqual([409, { state: 'loaded' }])
  })

  test('the database keeps validated content fixed and refuses transitions outside the lifecycle (0020)', async () => {
    const batchId = await uploadTiny()

    await expect(ownerRows(`UPDATE import_batch SET control_totals = '{}' WHERE id = $1`, [batchId])).rejects.toThrow(/may change only/)
    await expect(ownerRows(`UPDATE import_batch SET state = 'loaded' WHERE id = $1`, [batchId])).rejects.toThrow(
      /cannot change from validated to loaded/,
    )
  })

  test('a stored file that changed since validation is not loaded; the batch stays mapped', async () => {
    const batchId = await uploadTiny()
    await attach(batchId, await approvedMappingId(app, consultant, approver, TINY_MAPPING))
    await writeFile(join(uploadDir, acme.id, batchId, 'orders.csv'), 'tampered')

    const response = await load(batchId)

    expect(response.statusCode).toBe(500)
    expect((await batchOf(batchId)).state).toBe('mapped')
    expect((await factTotals(batchId)).participants).toBe(0)
  })
})
