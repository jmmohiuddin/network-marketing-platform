// T-B6-40 (D-B6-09, AC-MIG1-1, AC-28.2 / TS-52 import part): batches and mappings of kind migration, the sponsor orphan
// and cycle checks, and the separation of kinds in loads, supersession, mappings and the compliance facade.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { migrationFixtureFiles } from '../../seed.js'
import type { Mappings } from './mappings.js'
import { createImpModule, loadedBatches } from './index.js'
import { approvedMappingId, recordBreachContact, upload, type CsvFiles } from './test-support.js'

const MONTHS = { m3: '2026-08', m2: '2026-09', m1: '2026-10' }
const FILES = migrationFixtureFiles(MONTHS)
const MIGRATION_FILES: CsvFiles = { participants: FILES['participants.csv']!, orders: FILES['orders.csv']!, payout_lines: FILES['payout_lines.csv']! }
const MAPPING: Mappings = {
  participant_types: { FXDIST: { counts_as_end_customer: false, can_earn: true } },
  purposes: { personal: 'personal' },
  source_kinds: { downline_volume: 'downline_volume', other: 'other' },
  starter_kits: {},
}

let app: FastifyInstance
let acme: TestTenant
let consultant: TestUser
let admin: TestUser
let approver: TestUser
let globexConsultant: TestUser
let atMarket: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  await createMarket(acme.id, 'LIVE')
  const [at] = await ownerRows<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, 'AT', 'EUR', 2, 'Europe/Vienna', '{de}', 'none', 'draft') RETURNING id`, [acme.id])
  atMarket = at!.id
  consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  globexConsultant = await createSignedInUser({ tenantId: globex.id, roles: ['Implementation consultant'] })
  await recordBreachContact(acme.id, admin.id)
  const uploadDir = await mkdtemp(join(tmpdir(), 'nmp-imp-migration-'))
  app = await buildTestApp({ modules: [createImpModule({ uploadDir })] })
})

afterAll(async () => {
  await app.close()
})

const fields = (kind: string, market = 'AT') => ({ market, period_from: MONTHS.m3, period_to: MONTHS.m1, kind })
const uploadAs = (as: TestUser, kind: string, files: CsvFiles = MIGRATION_FILES, market = 'AT') => upload(app, as, { fields: fields(kind, market), files })
const errorsOf = async (batchId: string) =>
  (await call(app, { method: 'GET', url: `/v1/imports/${batchId}/errors`, as: consultant })).json().data as { row_no: number; column_name: string; code: string; detail: string }[]
const attach = (batchId: string, mappingId: string) => call(app, { method: 'POST', url: `/v1/imports/${batchId}/mapping`, as: consultant, body: { mapping_id: mappingId } })
const load = (batchId: string) => call(app, { method: 'POST', url: `/v1/imports/${batchId}/load`, as: consultant })

/** A mapping version of `kind`, created and approved; the If-Match is the latest version of that kind. */
async function mappingOf(kind: 'overlay' | 'migration'): Promise<string> {
  if (kind === 'overlay') return approvedMappingId(app, consultant, approver, MAPPING)
  const latest = (await call(app, { method: 'GET', url: '/v1/import-mappings?kind=migration', as: consultant })).headers.etag as string
  const created = await call(app, { method: 'PUT', url: '/v1/import-mappings', as: consultant, body: { kind, mappings: MAPPING }, headers: { 'if-match': latest } })
  expect(created.statusCode, created.body).toBe(201)
  const approved = await call(app, { method: 'POST', url: `/v1/import-mappings/${created.json().data.id}/approve`, as: approver })
  expect(approved.statusCode, approved.body).toBe(200)
  return created.json().data.id
}

describe('T-B6-40 migration batches (D-B6-09)', () => {
  test('kind=migration needs migration.manage and a market in implementation', async () => {
    expect((await uploadAs(admin, 'migration')).statusCode).toBe(403)
    expect((await uploadAs(consultant, 'migration', MIGRATION_FILES, 'LIVE')).json().error.code).toBe('MARKET_NOT_IN_IMPLEMENTATION')
    expect((await uploadAs(consultant, 'archive')).statusCode).toBe(400)
    expect((await uploadAs(globexConsultant, 'migration')).json().error.code).toBe('MARKET_UNKNOWN')
  })

  test('TS-52 / AC-28.2: a sponsor cycle rejects the batch with one GENEALOGY_CYCLE per member, the cycle in chain order; no load', async () => {
    const response = await uploadAs(consultant, 'migration', { ...MIGRATION_FILES, participants: FILES['participants-cycle.csv']! })
    const batch = response.json().data

    expect(batch).toMatchObject({ kind: 'migration', state: 'rejected', report: { error_count: 3 } })
    expect((await errorsOf(batch.id)).map((e) => [e.row_no, e.column_name, e.code, e.detail])).toEqual([
      [2, 'sponsor_id', 'GENEALOGY_CYCLE', "sponsor cycle: 'AT-A' -> 'AT-C' -> 'AT-B' -> 'AT-A'"],
      [3, 'sponsor_id', 'GENEALOGY_CYCLE', "sponsor cycle: 'AT-B' -> 'AT-A' -> 'AT-C' -> 'AT-B'"],
      [4, 'sponsor_id', 'GENEALOGY_CYCLE', "sponsor cycle: 'AT-C' -> 'AT-B' -> 'AT-A' -> 'AT-C'"],
    ])
    expect((await attach(batch.id, await mappingOf('migration'))).json().error.code).toBe('IMPORT_STATE_CONFLICT')
  })

  test('AC-MIG1-1: a sponsor outside the file is an ORPHAN_REFERENCE of a migration batch, a warning of an overlay batch', async () => {
    const orphan = { ...MIGRATION_FILES, participants: String(MIGRATION_FILES.participants).replace(`AT-A,FXDIST,${MONTHS.m3},`, `AT-A,FXDIST,${MONTHS.m3},AT-Z`) }
    const migration = (await uploadAs(consultant, 'migration', orphan)).json().data
    const overlay = (await uploadAs(consultant, 'overlay', orphan, 'LIVE')).json().data

    expect(migration.state).toBe('rejected')
    expect((await errorsOf(migration.id)).map((e) => [e.row_no, e.code, e.detail])).toEqual([[2, 'ORPHAN_REFERENCE', "participant 'AT-A': sponsor_id 'AT-Z' not in participants.csv"]])
    expect(overlay).toMatchObject({ kind: 'overlay', state: 'validated' })
    expect(overlay.report.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SPONSOR_NOT_IN_FILE', count: 1 })]))
  })

  test('mappings are kind-separated: create needs migration.manage, lists and ETags per kind, a batch attaches its own kind only', async () => {
    const overlayMapping = await mappingOf('overlay')
    const migrationMapping = await mappingOf('migration')
    const byAdmin = await call(app, { method: 'PUT', url: '/v1/import-mappings', as: admin, body: { kind: 'migration', mappings: MAPPING }, headers: { 'if-match': '"0"' } })
    const migrationBatch = (await uploadAs(consultant, 'migration')).json().data.id as string
    const overlayBatch = (await uploadAs(consultant, 'overlay', MIGRATION_FILES)).json().data.id as string
    const lists = {
      migration: await call(app, { method: 'GET', url: '/v1/import-mappings?kind=migration', as: consultant }),
      overlay: await call(app, { method: 'GET', url: '/v1/import-mappings', as: consultant }),
    }
    const versions = await ownerRows<{ id: string; version: number }>('SELECT id, version FROM import_mapping WHERE id = ANY ($1::uuid[])', [[overlayMapping, migrationMapping]])

    expect(byAdmin.statusCode).toBe(403)
    expect((await attach(migrationBatch, overlayMapping)).json().error).toMatchObject({ code: 'MAPPING_KIND', details: { kind: 'overlay' } })
    expect((await attach(overlayBatch, migrationMapping)).json().error).toMatchObject({ code: 'MAPPING_KIND', details: { kind: 'migration' } })
    expect(lists.migration.json().data.map((m: { kind: string }) => m.kind)).toEqual(expect.arrayContaining(['migration']))
    expect(lists.migration.json().data.every((m: { kind: string }) => m.kind === 'migration')).toBe(true)
    expect(lists.migration.headers.etag).toBe(`"${versions.find((v) => v.id === migrationMapping)!.version}"`)
    expect(lists.overlay.headers.etag).toBe(`"${versions.find((v) => v.id === overlayMapping)!.version}"`)
    // Concurrent saves of different kinds both succeed: each If-Match is current for its own kind.
    const save = (kind: string, etag: string) => call(app, { method: 'PUT', url: '/v1/import-mappings', as: consultant, body: { kind, mappings: MAPPING }, headers: { 'if-match': etag } })
    const concurrent = await Promise.all([save('migration', lists.migration.headers.etag as string), save('overlay', lists.overlay.headers.etag as string)])
    expect(concurrent.map((r) => r.statusCode)).toEqual([201, 201])
  })

  test('loads never supersede across kinds; loadedBatches is the overlay only; lists filter by kind', async () => {
    const overlayBatch = (await uploadAs(consultant, 'overlay', MIGRATION_FILES)).json().data.id as string
    const migrationBatch = (await uploadAs(consultant, 'migration')).json().data.id as string
    expect((await attach(overlayBatch, await mappingOf('overlay'))).statusCode).toBe(200)
    expect((await load(overlayBatch)).statusCode).toBe(200)
    const migrationMapping = await mappingOf('migration')
    // D-B6-09: import.manage without migration.manage (the admin) neither sees nor changes a migration batch.
    const asAdmin = (method: 'GET' | 'POST', url: string, body?: unknown) => call(app, { method, url, as: admin, ...(body === undefined ? {} : { body }) })
    expect([
      (await asAdmin('POST', `/v1/imports/${migrationBatch}/mapping`, { mapping_id: migrationMapping })).statusCode,
      (await asAdmin('GET', `/v1/imports/${migrationBatch}`)).statusCode,
      (await asAdmin('GET', `/v1/imports/${migrationBatch}/errors`)).statusCode,
      (await asAdmin('GET', `/v1/imports/${migrationBatch}/source-values`)).statusCode,
      (await asAdmin('GET', `/v1/imports/${overlayBatch}`)).statusCode,
      (await asAdmin('GET', `/v1/imports/${overlayBatch}/source-values`)).statusCode,
      (await call(app, { method: 'GET', url: `/v1/imports/${migrationBatch}/source-values`, as: consultant })).statusCode,
    ]).toEqual([404, 404, 404, 404, 200, 200, 200])
    expect((await asAdmin('GET', '/v1/imports?kind=migration')).json().data).toEqual([])
    expect((await attach(migrationBatch, migrationMapping)).statusCode).toBe(200)
    expect((await asAdmin('POST', `/v1/imports/${migrationBatch}/load`)).statusCode).toBe(404)
    const loaded = await load(migrationBatch)
    const inForce = await withTenant({ tenantId: acme.id, userId: consultant.id }, (tx) => loadedBatches(tx, atMarket, `${MONTHS.m3}-01`, `${MONTHS.m1}-31`))
    const migrations = await call(app, { method: 'GET', url: '/v1/imports?kind=migration&state=loaded', as: consultant })

    expect(loaded.json()).toMatchObject({ data: { kind: 'migration', state: 'loaded' }, meta: { superseded: [] } })
    expect((await call(app, { method: 'GET', url: `/v1/imports/${overlayBatch}`, as: consultant })).json().data.state).toBe('loaded')
    expect(inForce.map((b) => b.id)).toEqual([overlayBatch])
    expect(migrations.json().data.map((b: { id: string }) => b.id)).toEqual([migrationBatch])
  })
})
