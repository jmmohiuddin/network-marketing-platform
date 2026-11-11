import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { createImpModule } from './index.js'
import { SYNTHETIC_MAPPING, TINY_MAPPING } from './test-support.js'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let consultant: TestUser
let approver: TestUser
let approverWithoutStepUp: TestUser
let admin: TestUser
let analyst: TestUser
let globexConsultant: TestUser
let globexApprover: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
  approver = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  approverWithoutStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexConsultant = await createSignedInUser({ tenantId: globex.id, roles: ['Implementation consultant'] })
  globexApprover = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'], stepUp: true })
  app = await buildTestApp({ modules: [createImpModule()] })
})

afterAll(async () => {
  await app.close()
})

const put = (as: TestUser, body: unknown, ifMatch?: string) =>
  call(app, { method: 'PUT', url: '/v1/import-mappings', as, body, ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }) })
const approve = (as: TestUser, id: string, body?: unknown) =>
  call(app, { method: 'POST', url: `/v1/import-mappings/${id}/approve`, as, ...(body === undefined ? {} : { body }) })
const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })

describe('PUT /v1/import-mappings (API-03)', () => {
  test('needs If-Match with the latest version; each save is a new draft version', async () => {
    const withoutHeader = await put(consultant, { mappings: SYNTHETIC_MAPPING })
    const first = await put(consultant, { mappings: SYNTHETIC_MAPPING, notes: 'prototype config' }, '"0"')
    const stale = await put(consultant, { mappings: TINY_MAPPING }, '"0"')
    const second = await put(consultant, { mappings: TINY_MAPPING }, first.headers.etag as string)

    expect([withoutHeader.statusCode, withoutHeader.json().error.code]).toEqual([428, 'PRECONDITION_REQUIRED'])
    expect(first.statusCode).toBe(201)
    expect(first.headers.etag).toBe('"1"')
    expect(first.json().data).toMatchObject({ version: 1, state: 'draft', notes: 'prototype config', created_by: consultant.id, mappings: SYNTHETIC_MAPPING })
    expect([stale.statusCode, stale.json().error.details]).toEqual([412, { latest_version: 1 }])
    expect(second.json().data).toMatchObject({ version: 2, state: 'draft' })
    expect((await auditActions(acme.id)).filter((action) => action === 'MAPPING.VERSION_CREATED')).toHaveLength(2)
  })

  test('targets outside the platform vocabulary and unknown keys are refused', async () => {
    const badPurpose = await put(consultant, { mappings: { ...TINY_MAPPING, purposes: { cust_order: 'gift' } } }, '"2"')
    const missingFlag = await put(consultant, { mappings: { ...TINY_MAPPING, participant_types: { dist: { can_earn: true } } } }, '"2"')
    const extraKey = await put(consultant, { mappings: { ...TINY_MAPPING, bonus_types: {} } }, '"2"')

    expect([badPurpose, missingFlag, extraKey].map((response) => response.json().error.code)).toEqual([
      'VALIDATION_FAILED', 'VALIDATION_FAILED', 'VALIDATION_FAILED',
    ])
  })
})

describe('POST /v1/import-mappings/:id/approve', () => {
  let draftId: string

  beforeAll(async () => {
    draftId = (await get(consultant, '/v1/import-mappings')).json().data.find((m: { version: number }) => m.version === 1).id
  })

  test('the author cannot approve; another approver needs a fresh second factor', async () => {
    const authored = (await put(admin, { mappings: TINY_MAPPING }, '"2"')).json().data
    const selfApproval = await approve(admin, authored.id)
    const noStepUp = await approve(approverWithoutStepUp, draftId)

    expect([selfApproval.statusCode, selfApproval.json().error.code]).toEqual([422, 'SOD_SELF_APPROVAL'])
    expect([noStepUp.statusCode, noStepUp.json().error.code]).toEqual([403, 'STEP_UP_REQUIRED'])
  })

  test('approval records the approver and the factor; approved versions are immutable', async () => {
    const approved = await approve(approver, draftId, { reason: 'matches the partner glossary' })
    const again = await approve(approver, draftId)

    expect(approved.statusCode).toBe(200)
    expect(approved.json().data).toMatchObject({ id: draftId, version: 1, state: 'approved', approved_by: approver.id })
    expect([again.statusCode, again.json().error.code]).toEqual([409, 'MAPPING_ALREADY_APPROVED'])
    const [decision] = await ownerRows<{ preparer_id: string; approver_id: string; factor_verified_at: Date | null }>(
      `SELECT preparer_id, approver_id, factor_verified_at FROM approval WHERE object_type = 'import_mapping' AND object_id = $1`, [draftId],
    )
    expect(decision).toMatchObject({ preparer_id: consultant.id, approver_id: approver.id })
    expect(decision!.factor_verified_at).toBeInstanceOf(Date)
    await expect(ownerRows(`UPDATE import_mapping SET notes = 'late' WHERE id = $1`, [draftId])).rejects.toThrow(/immutable/)
    expect((await auditActions(acme.id)).at(-1)).toBe('MAPPING.APPROVED')
  })
})

describe('reading mappings', () => {
  test('the list is newest first with the latest version as ETag; one version includes its mappings', async () => {
    const page1 = await get(consultant, '/v1/import-mappings?limit=2')
    const page2 = await get(consultant, `/v1/import-mappings?limit=2&cursor=${page1.json().meta.next_cursor}`)
    const one = await get(approver, `/v1/import-mappings/${page2.json().data[0].id}`)

    expect(page1.headers.etag).toBe('"3"')
    expect(page1.json().data.map((m: { version: number }) => m.version)).toEqual([3, 2])
    expect(page1.json().data[0].mappings).toBeUndefined()
    expect(page2.json().data.map((m: { version: number }) => m.version)).toEqual([1])
    expect(one.json().data).toMatchObject({ version: 1, state: 'approved', mappings: SYNTHETIC_MAPPING })
  })
})

describe('authorisation and isolation', () => {
  test('without mapping or import permissions every route is 403; drafting and approving are separate permissions', async () => {
    const [anyId] = (await get(consultant, '/v1/import-mappings')).json().data.map((m: { id: string }) => m.id)
    const denied = await Promise.all([
      get(analyst, '/v1/import-mappings'), get(analyst, `/v1/import-mappings/${anyId}`),
      put(analyst, { mappings: TINY_MAPPING }, '"3"'), approve(analyst, anyId),
      put(approver, { mappings: TINY_MAPPING }, '"3"'), approve(consultant, anyId),
    ])

    expect(denied.map((response) => response.statusCode)).toEqual([403, 403, 403, 403, 403, 403])
  })

  test('another tenant neither sees nor approves these versions and numbers its own from 1', async () => {
    const [acmeId] = (await get(consultant, '/v1/import-mappings')).json().data.map((m: { id: string }) => m.id)
    const read = await get(globexConsultant, `/v1/import-mappings/${acmeId}`)
    const approval = await approve(globexApprover, acmeId)
    const list = await get(globexConsultant, '/v1/import-mappings')
    const own = await put(globexConsultant, { mappings: TINY_MAPPING }, '"0"')

    expect([read.statusCode, approval.statusCode]).toEqual([404, 404])
    expect([list.json().data, list.headers.etag]).toEqual([[], '"0"'])
    expect(own.json().data.version).toBe(1)
  })
})

describe('AC-40.1: saving a new mapping version outdates the snapshots computed on an earlier one (0031)', () => {
  const insertSnapshot = async (tenantId: string, createdBy: string, mappingIds: string[]) => {
    const market = await createMarket(tenantId, `S${mappingIds.length}${tenantId.slice(0, 4)}`)
    const [row] = await ownerRows<{ id: string }>(
      `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version, mapping_id,
         input_refs, state, created_by, inputs_hash)
       VALUES ($1, $2, '2025-01-01', '2025-12-31', 'test', $3, $4, 'ready', $5, decode('00', 'hex')) RETURNING id`,
      [tenantId, market, mappingIds[0] ?? null, { batch_ids: [], mapping_ids: mappingIds, reports: ['R1'] }, createdBy],
    )
    return row!.id
  }
  const stateOf = async (id: string) =>
    (await ownerRows<{ state: string }>('SELECT state FROM compliance_report_snapshot WHERE id = $1', [id]))[0]!.state

  test('a ready snapshot on version 1 is outdated in the same transaction; others keep their state', async () => {
    const listed = await get(consultant, '/v1/import-mappings')
    const versions = listed.json().data as { id: string; version: number }[]
    const [globexV1] = (await get(globexConsultant, '/v1/import-mappings')).json().data as { id: string }[]
    const onVersion1 = await insertSnapshot(acme.id, approver.id, [versions.find((m) => m.version === 1)!.id])
    const withoutMapping = await insertSnapshot(acme.id, approver.id, [])
    const otherTenant = await insertSnapshot(globex.id, globexConsultant.id, [globexV1!.id])

    const saved = await put(consultant, { mappings: TINY_MAPPING }, listed.headers.etag as string)

    expect(saved.statusCode).toBe(201)
    expect([await stateOf(onVersion1), await stateOf(withoutMapping), await stateOf(otherTenant)]).toEqual(['outdated', 'ready', 'ready'])
    expect((await auditActions(acme.id)).slice(-2)).toEqual(['SNAPSHOT.OUTDATED', 'MAPPING.VERSION_CREATED'])
  })
})
