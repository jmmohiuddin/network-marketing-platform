import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { acquireImportSlot } from './import-gate.js'
import { createImpModule } from './index.js'
import { multipartBody, syntheticFiles, tinyFiles, upload } from './test-support.js'

const MAX_FILE_BYTES = 1_000_000

let app: FastifyInstance
let uploadDir: string
let acme: TestTenant
let consultant: TestUser
let compliance: TestUser
let analyst: TestUser
let otherMarketConsultant: TestUser
let globexConsultant: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  await createMarket(acme.id, 'DEMO')
  const acmeOther = await createMarket(acme.id, 'OTHER')
  await createMarket(globex.id, 'GLX')
  consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  otherMarketConsultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'], marketIds: [acmeOther] })
  globexConsultant = await createSignedInUser({ tenantId: globex.id, roles: ['Implementation consultant'] })
  uploadDir = await mkdtemp(join(tmpdir(), 'nmp-imp-'))
  app = await buildTestApp({ modules: [createImpModule({ uploadDir, maxFileBytes: MAX_FILE_BYTES })] })
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const factCount = async (batchId: string) =>
  (await ownerRows<{ n: number }>(
    `SELECT ((SELECT count(*) FROM cpl_fact_participant WHERE batch_id = $1) + (SELECT count(*) FROM cpl_fact_order WHERE batch_id = $1)
          + (SELECT count(*) FROM cpl_fact_payout_line WHERE batch_id = $1))::int AS n`, [batchId]))[0]!.n
const storedFiles = async (batchId: string) => readdir(join(uploadDir, acme.id, batchId)).catch(() => [])

describe('POST /v1/imports (API-01)', () => {
  test('the synthetic export is validated with its control totals; files are kept, no fact is stored yet', async () => {
    const response = await upload(app, consultant)
    const batch = response.json().data

    expect(response.statusCode).toBe(201)
    expect(batch).toMatchObject({
      state: 'validated', market: 'DEMO', kind: 'overlay', period_from: '2025-01', period_to: '2025-12', mapping_id: null,
      uploaded_by: consultant.id, row_counts: { participants: 1466, orders: 4775, payout_lines: 7442 },
      control_totals: { order_amount_minor: '53195001', order_volume_minor: '53195001', order_refunded_minor: '2600070', payout_amount_minor: '9225679' },
      report: { error_count: 0, errors_stored: 0 },
    })
    expect(batch.files.orders).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/), size_bytes: 248756, stored_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect((await storedFiles(batch.id)).sort()).toEqual(['orders.csv', 'participants.csv', 'payout_lines.csv'])
    expect(await factCount(batch.id)).toBe(0)
    expect((await auditActions(acme.id)).slice(-2)).toEqual(['IMPORT.UPLOADED', 'IMPORT.VALIDATED'])
  })

  test('a repeated key replays the same batch; the same key with other files is refused', async () => {
    const first = await upload(app, consultant, { files: tinyFiles(), from: '2025-01', to: '2025-01', idempotencyKey: 'imp-replay' })
    const replay = await upload(app, consultant, { files: tinyFiles(), from: '2025-01', to: '2025-01', idempotencyKey: 'imp-replay' })
    const changed = await upload(app, consultant, {
      files: tinyFiles({ orders: tinyFiles().orders.toString().replace('10000', '10001') }), from: '2025-01', to: '2025-01', idempotencyKey: 'imp-replay',
    })

    expect(replay.statusCode).toBe(201)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.json().data.id).toBe(first.json().data.id)
    expect(changed.statusCode).toBe(422)
    expect(changed.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  test('TS-32: forbidden columns reject the whole batch, name the columns and store nothing', async () => {
    const participants = 'participant_id,type,enrolled_month,sponsor_id,email,phone,bank_account,national_id,address\nD1,dist,2025-01,,x,x,x,x,x\n'
    const response = await upload(app, consultant, { files: tinyFiles({ participants }), from: '2025-01', to: '2025-01' })
    const batch = response.json().data
    const errors = await get(consultant, `/v1/imports/${batch.id}/errors`)

    expect(response.statusCode).toBe(201)
    expect(batch).toMatchObject({ state: 'rejected', row_counts: null, control_totals: null, report: { error_count: 5, errors_stored: 5 } })
    expect(errors.json().data.map((e: { column_name: string; code: string }) => [e.column_name, e.code])).toEqual(
      ['email', 'phone', 'bank_account', 'national_id', 'address'].map((column) => [column, 'FORBIDDEN_COLUMN']),
    )
    expect(errors.json().data[0]).toMatchObject({ file: 'participants.csv', row_no: 1 })
    expect(await storedFiles(batch.id)).toEqual([])
    expect(await factCount(batch.id)).toBe(0)
    expect((await auditActions(acme.id)).slice(-2)).toEqual(['IMPORT.UPLOADED', 'IMPORT.REJECTED'])
  })

  test('synchronous checks: missing file, file too large, content type, period and market', async () => {
    const { payout_lines: _dropped, ...twoFiles } = tinyFiles()
    const missing = await upload(app, consultant, { files: twoFiles })
    const tooLarge = await upload(app, consultant, { files: tinyFiles({ orders: Buffer.alloc(MAX_FILE_BYTES + 1, 'a') }) })
    const wrongType = await upload(app, consultant, { files: tinyFiles(), type: 'application/pdf' })
    const badPeriod = await upload(app, consultant, { files: tinyFiles(), from: '2025-03', to: '2025-02' })
    const unknownMarket = await upload(app, consultant, { files: tinyFiles(), market: 'NOPE' })
    const json = await call(app, { method: 'POST', url: '/v1/imports', as: consultant, body: { market: 'DEMO' }, idempotencyKey: true })
    const form = multipartBody({ market: 'DEMO', period_from: '2025-01', period_to: '2025-01' }, tinyFiles())
    const noKey = await call(app, { method: 'POST', url: '/v1/imports', as: consultant, body: form.payload, headers: { 'content-type': form.contentType } })

    expect([missing.statusCode, missing.json().error.code, missing.json().error.details]).toEqual([400, 'FILE_MISSING', { files: ['payout_lines'] }])
    expect([tooLarge.statusCode, tooLarge.json().error.code]).toEqual([413, 'FILE_TOO_LARGE'])
    expect([wrongType.statusCode, wrongType.json().error.code]).toEqual([415, 'UNSUPPORTED_FILE_TYPE'])
    expect([badPeriod.statusCode, badPeriod.json().error.code]).toEqual([400, 'VALIDATION_FAILED'])
    expect([unknownMarket.statusCode, unknownMarket.json().error.code]).toEqual([422, 'MARKET_UNKNOWN'])
    expect([json.statusCode, json.json().error.code]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE'])
    expect([noKey.statusCode, noKey.json().error.code]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED'])
  })
})

describe('reading batches (API-02)', () => {
  test('the list is newest first, filters by state and pages with a cursor', async () => {
    const first = await get(consultant, '/v1/imports?limit=1')
    const second = await get(consultant, `/v1/imports?limit=1&cursor=${first.json().meta.next_cursor}`)
    const rejected = await get(consultant, '/v1/imports?state=rejected')

    expect(first.json().data[0].state).toBe('rejected')
    expect(second.json().data[0].id).not.toBe(first.json().data[0].id)
    expect(rejected.json().data.every((batch: { state: string }) => batch.state === 'rejected')).toBe(true)
    expect((await get(consultant, '/v1/imports?cursor=nonsense')).json().error.code).toBe('INVALID_CURSOR')
  })

  test('row errors page in the order they were found', async () => {
    const orders = 'order_id,month,day,buyer_id,amount_cents,volume_cents,purpose,is_starter_kit,refunded_cents,refund_month\n'
      + 'O1,2025-01,1,C1,x,1,a,0,0,\nO2,2025-01,1,C1,y,1,a,0,0,\nO3,2025-01,1,C1,z,1,a,0,0,\n'
    const batch = (await upload(app, consultant, { files: tinyFiles({ orders }), from: '2025-01', to: '2025-01' })).json().data
    const page1 = await get(consultant, `/v1/imports/${batch.id}/errors?limit=2`)
    const page2 = await get(consultant, `/v1/imports/${batch.id}/errors?limit=2&cursor=${page1.json().meta.next_cursor}`)

    expect(page1.json().data.map((e: { row_no: number }) => e.row_no)).toEqual([2, 3])
    expect(page2.json().data.map((e: { row_no: number }) => e.row_no)).toEqual([4])
    expect(page2.json().meta.next_cursor).toBeNull()
  })

  test('partner codes with counts are readable by the mapping approver, who cannot manage imports', async () => {
    const batch = (await upload(app, consultant, { files: tinyFiles(), from: '2025-01', to: '2025-01' })).json().data
    const values = await get(compliance, `/v1/imports/${batch.id}/source-values`)

    expect(values.json().data).toEqual({
      batch_id: batch.id, state: 'validated',
      source_values: {
        participant_types: { cust: 1, dist: 1 }, purposes: { cust_order: 1, own: 1 }, source_kinds: { leader_pool: 1, retail: 1 },
        starter_kits: { 0: 1, 1: 1 },
      },
    })
    expect((await get(compliance, `/v1/imports/${batch.id}`)).statusCode).toBe(403)
  })
})

describe('authorisation and isolation', () => {
  let batchId: string

  beforeAll(async () => {
    batchId = (await upload(app, consultant, { files: tinyFiles(), from: '2025-01', to: '2025-01' })).json().data.id
  })

  const routes = () => [
    { method: 'GET' as const, url: `/v1/imports/${batchId}` },
    { method: 'GET' as const, url: `/v1/imports/${batchId}/errors` },
    { method: 'GET' as const, url: `/v1/imports/${batchId}/source-values` },
    { method: 'POST' as const, url: `/v1/imports/${batchId}/mapping`, body: { mapping_id: batchId } },
    { method: 'POST' as const, url: `/v1/imports/${batchId}/load` },
  ]

  test('without import permissions every route is 403', async () => {
    const responses = await Promise.all([
      upload(app, analyst, { files: syntheticFiles() }), get(analyst, '/v1/imports'), ...routes().map((route) => call(app, { ...route, as: analyst })),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403, 403, 403, 403])
  })

  test('another tenant sees none of the batches and cannot use the market code', async () => {
    const responses = await Promise.all(routes().map((route) => call(app, { ...route, as: globexConsultant })))
    const list = await get(globexConsultant, '/v1/imports')
    const foreignMarket = await upload(app, globexConsultant, { files: tinyFiles(), market: 'DEMO', from: '2025-01', to: '2025-01' })

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404])
    expect(list.json().data).toEqual([])
    expect(foreignMarket.json().error.code).toBe('MARKET_UNKNOWN')
  })

  test('a consultant scoped to another market neither sees the batch nor uploads to its market (AC-36.2)', async () => {
    const responses = await Promise.all(routes().map((route) => call(app, { ...route, as: otherMarketConsultant })))
    const scopedUpload = await upload(app, otherMarketConsultant, { files: tinyFiles(), from: '2025-01', to: '2025-01' })

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404])
    expect((await get(otherMarketConsultant, '/v1/imports')).json().data).toEqual([])
    expect(scopedUpload.json().error.code).toBe('MARKET_UNKNOWN')
  })
})

describe('what an upload keeps and how many run at once', () => {
  test('only the published columns are stored, and stored_sha256 is the digest of those bytes (BR-IMP-01)', async () => {
    const participants = 'participant_id,type,enrolled_month,sponsor_id,branch\nD1,dist,2025-01,,north\nC1,cust,2025-01,D1,south\n'
    const batch = (await upload(app, consultant, { files: tinyFiles({ participants }), from: '2025-01', to: '2025-01' })).json().data
    const stored = await readFile(join(uploadDir, acme.id, batch.id, 'participants.csv'))

    expect(batch.state).toBe('validated')
    expect(stored.toString()).toBe('"participant_id","type","enrolled_month","sponsor_id"\n"D1","dist","2025-01",""\n"C1","cust","2025-01","D1"\n')
    expect(batch.files.participants.stored_sha256).toBe(createHash('sha256').update(stored).digest('hex'))
  })

  test('one upload or load runs at a time per process; another is refused with 429 and Retry-After', async () => {
    const release = acquireImportSlot()!
    const busyUpload = await upload(app, consultant, { files: tinyFiles(), from: '2025-01', to: '2025-01' })
    const busyLoad = await call(app, { method: 'POST', url: `/v1/imports/${randomUUID()}/load`, as: consultant })
    release()
    const after = await upload(app, consultant, { files: tinyFiles(), from: '2025-01', to: '2025-01' })

    expect([busyUpload.statusCode, busyUpload.json().error.code, busyUpload.headers['retry-after']]).toEqual([429, 'IMPORT_BUSY', '10'])
    expect([busyLoad.statusCode, busyLoad.json().error.code]).toEqual([429, 'IMPORT_BUSY'])
    expect(after.statusCode).toBe(201)
  })
})
