import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, mailsTo,
  ownerReplica, ownerRows, resetApiDb, runQueuedJobs, sessionFrom, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import type { TenantJob } from '../../lib/jobs.js'
import { hashPassword } from '../../lib/passwords.js'
import { purgeTenant } from '../../scripts/purge-tenant.js'
import { iamModule } from '../iam/index.js'
import { intModule } from '../int/index.js'
import { tenModule } from '../ten/index.js'
import { opsModule } from './index.js'
import { offboardingRequestedMailJob } from './offboarding.js'

// FR-TEN-005 (D-V1A-07): T-V1A-50 request and confirmation with blockers, T-V1A-51 read-only and archive with the pinned
// export, T-V1A-52 purge request, independent approval and restore, T-V1A-53 the purge itself (slot test database only).

const PASSWORD = 'correct horse battery staple'
const fullExportJob = intModule.jobs!.find((job) => job.name === 'int.full-export.generate') as TenantJob<unknown>

let app: FastifyInstance
let vendor1: TestUser
let vendor2: TestUser
let vendorNoStepUp: TestUser
let globexAdmin: TestUser
let globex: TestTenant

closePoolsAfterAll()

interface World {
  tenant: TestTenant
  market: string
  admin: TestUser
  reader: TestUser
  member: string
}

/** A live tenant with a Tenant admin (step-up), an analyst who signs in with a password, and one member. */
async function world(): Promise<World> {
  const tenant = await createTenant()
  const market = await createMarket(tenant.id, 'GB')
  const admin = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'], stepUp: true })
  const reader = await createSignedInUser({ tenantId: tenant.id, roles: ['Commission analyst'], mfa: 'none', passwordHash: await hashPassword(PASSWORD) })
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by)
     VALUES ($1, 'M-1', 'individual', $2, now(), $3) RETURNING id`,
    [tenant.id, market, admin.id],
  )
  return { tenant, market, admin, reader, member: row!.id }
}

beforeAll(async () => {
  await resetApiDb()
  vendor1 = await createSignedInUser({ tenantId: null, stepUp: true })
  vendor2 = await createSignedInUser({ tenantId: null, stepUp: true })
  vendorNoStepUp = await createSignedInUser({ tenantId: null })
  globex = await createTenant()
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, tenModule, opsModule, intModule] })
}, 60_000)

afterAll(async () => {
  await app.close()
})

const vendorStep = (as: TestUser, tenantId: string, step: string, body: unknown = {}) =>
  call(app, { method: 'POST', url: `/v1/tenants/${tenantId}/offboarding/${step}`, as, body })
const request = (as: TestUser, tenantId: string, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: `/v1/tenants/${tenantId}/offboarding`, as, body: { reason: 'Contract ended' }, idempotencyKey })
const confirm = (as: TestUser, body: Record<string, unknown> = {}) =>
  call(app, { method: 'POST', url: '/v1/offboarding/confirm', as, body: { retention_basis: 'Commercial law, 10 years', retention_months: 12, acknowledged_warnings: [], ...body } })
const refusal = (response: { statusCode: number; json(): { error: { code: string; details: unknown } } }) =>
  [response.statusCode, response.json().error.code, response.json().error.details]
const vendorActions = async (objectId: string) =>
  (await ownerRows<{ action: string }>('SELECT action FROM audit.vendor_event WHERE object_id = $1 ORDER BY seq', [objectId])).map((row) => row.action)

/** POST /v1/exports by the admin and the job run: the id of a completed full export. */
async function completedExport(as: TestUser): Promise<string> {
  const response = await call(app, { method: 'POST', url: '/v1/exports', as, body: {}, idempotencyKey: true })
  expect(response.statusCode, response.body).toBe(202)
  await runQueuedJobs(fullExportJob)
  return response.json().data.id
}

/** Requested by vendor1, confirmed by the tenant admin, archived with a fresh export. */
async function archived(w: World): Promise<string> {
  expect((await request(vendor1, w.tenant.id)).statusCode).toBe(201)
  expect((await confirm(w.admin)).statusCode).toBe(200)
  const exportId = await completedExport(w.admin)
  expect((await vendorStep(vendor1, w.tenant.id, 'archive', { export_id: exportId })).statusCode).toBe(200)
  return exportId
}

describe('T-V1A-50: the vendor requests, the tenant admin sees the blockers and confirms', () => {
  let w: World

  beforeAll(async () => {
    w = await world()
  })

  test('request: vendor realm, step-up and an Idempotency-Key; mailed to the tenant admins; both logs; replay and refusals', async () => {
    expect(refusal(await request(vendorNoStepUp, w.tenant.id))[1]).toBe('STEP_UP_REQUIRED')
    expect(refusal(await request(w.admin, w.tenant.id))[1]).toBe('REALM_FORBIDDEN')
    expect((await call(app, { method: 'POST', url: `/v1/tenants/${w.tenant.id}/offboarding`, as: vendor1, body: { reason: 'x' } })).statusCode).toBe(400)
    expect((await request(vendor1, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    const provisioning = await createTenant({ state: 'provisioning' })
    expect(refusal(await request(vendor1, provisioning.id))).toEqual([409, 'TENANT_STATE', { state: 'provisioning' }])

    const created = await request(vendor1, w.tenant.id, 'offboard-1')
    const replayed = await request(vendor1, w.tenant.id, 'offboard-1')
    const second = await request(vendor2, w.tenant.id)

    expect(created.statusCode, created.body).toBe(201)
    const view = created.json().data
    expect(view).toMatchObject({ state: 'requested', confirmed_at: null, archived_at: null, retain_until: null })
    expect(view.blockers).toHaveLength(10)
    expect(view.blockers.every((blocker: Record<string, unknown>) => !('ids' in blocker))).toBe(true)
    expect([replayed.statusCode, replayed.headers['idempotent-replayed'], replayed.json().data.id]).toEqual([201, 'true', view.id])
    expect(refusal(second)[1]).toBe('OFFBOARDING_OPEN')
    expect(await vendorActions(view.id)).toEqual(['OFFBOARDING.REQUESTED'])
    expect(await auditActions(w.tenant.id)).toContain('OFFBOARDING.REQUESTED')
    expect(await runQueuedJobs(offboardingRequestedMailJob)).toBeGreaterThan(0)
    expect((await mailsTo(w.admin.email)).filter((mail) => mail.includes('Contract ended'))).toHaveLength(1)
    const detail = await call(app, { method: 'GET', url: `/v1/tenants/${w.tenant.id}`, as: vendor2 })
    expect(detail.json().data.offboarding).toMatchObject({ id: view.id, state: 'requested' })
  })

  test('GET /v1/offboarding: tenant.offboard for all markets; other tenants see none; portal and other staff refused', async () => {
    const analyst = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Commission analyst'] })
    const scopedAdmin = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Tenant admin'], marketIds: [w.market] })
    const portal = await createPortalUser({ tenantId: w.tenant.id, participantId: w.member })
    const get = (as: TestUser) => call(app, { method: 'GET', url: '/v1/offboarding', as })

    const own = await get(w.admin)

    expect(own.json().data.offboarding).toMatchObject({ state: 'requested', reason: 'Contract ended' })
    expect(own.json().data.blockers.find((blocker: { kind: string }) => blocker.kind === 'run_open')).toEqual({ kind: 'run_open', blocking: true, count: 0, ids: [] })
    expect((await get(globexAdmin)).json().data.offboarding).toBeNull()
    expect(refusal(await get(analyst))[0]).toBe(403)
    expect(refusal(await get(scopedAdmin))[1]).toBe('SCOPE_NOT_HELD')
    expect(refusal(await get(portal))[0]).toBe(403)
    expect(refusal(await confirm(globexAdmin))).toEqual([409, 'OFFBOARDING_STATE', { state: null }])
  })

  test('confirm: a blocking item refuses (409 with ids), a warning must be acknowledged (422), then the tenant is read-only', async () => {
    const adminNoStepUp = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Tenant admin'] })
    expect(refusal(await confirm(adminNoStepUp))[1]).toBe('STEP_UP_REQUIRED')
    expect((await confirm(w.admin, { retention_months: 0 })).statusCode).toBe(400)
    const queued = await call(app, { method: 'POST', url: '/v1/exports', as: w.admin, body: {}, idempotencyKey: true })

    const blocked = await confirm(w.admin)
    expect(refusal(blocked)).toEqual([409, 'OFFBOARDING_BLOCKED', {
      blockers: [{ kind: 'export_running', blocking: true, count: 1, ids: [queued.json().data.id] }],
    }])
    await runQueuedJobs(fullExportJob)
    // FIXTURE: credits the tenant still owes (a credit_liability balance), written by the owner with triggers off.
    await ownerReplica(
      `WITH t AS (INSERT INTO credit_type (tenant_id, code, name, taxable, created_by, updated_by) VALUES ($1, 'PRODUCT_CREDIT', 'Product credit', false, $3, $3) RETURNING id),
            a AS (INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, credit_type_id, currency)
                  SELECT $1, $2, 'credit_liability', $4, t.id, 'GBP' FROM t RETURNING id)
       INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency) SELECT $1, gen_random_uuid(), a.id, 0, 900, 'GBP' FROM a`,
      [w.tenant.id, w.market, w.admin.id, w.member],
    )
    expect(refusal(await confirm(w.admin))).toEqual([422, 'WARNING_NOT_ACKNOWLEDGED', { kinds: ['credits_outstanding'] }])

    const confirmed = await confirm(w.admin, { acknowledged_warnings: ['credits_outstanding'] })

    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json().data).toMatchObject({ state: 'confirmed', retention_months: 12, retention_basis: 'Commercial law, 10 years' })
    expect(await auditActions(w.tenant.id)).toContain('OFFBOARDING.CONFIRMED')
  })

  test('T-V1A-60 (read-only part): writes are refused with nothing stored, reads and the final export work, /v1/me says so', async () => {
    const calendar = await call(app, {
      method: 'POST', url: '/v1/calendars', as: w.admin, idempotencyKey: true,
      body: { market_id: w.market, name: 'Weekly', cadence: 'weekly', cutoff_time_zone: 'UTC', first_period_start: '2030-01-07', periods_ahead: 1, reason: 'r' },
    })
    expect(refusal(calendar)[0]).toBe(409)
    expect(calendar.json().error.code).toBe('TENANT_READ_ONLY')
    expect(await ownerRows('SELECT 1 FROM calendar WHERE tenant_id = $1', [w.tenant.id])).toEqual([])
    expect((await call(app, { method: 'GET', url: '/v1/calendars', as: w.admin })).statusCode).toBe(200)
    expect((await call(app, { method: 'GET', url: '/v1/me', as: w.admin })).json().data.tenant).toMatchObject({ state: 'live', read_only: true })
    expect((await call(app, { method: 'GET', url: '/v1/me', as: globexAdmin })).json().data.tenant).toMatchObject({ read_only: false })
    expect(typeof (await completedExport(w.admin))).toBe('string')
  })
})

describe('T-V1A-51: archive needs a completed export made after the confirmation; the tenant stays readable', () => {
  let w: World
  let before: string

  beforeAll(async () => {
    w = await world()
    before = await completedExport(w.admin)
    expect((await request(vendor1, w.tenant.id)).statusCode).toBe(201)
  })

  test('archive: state and export refusals, then archived with both logs and the tenant state moved', async () => {
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'archive', { export_id: before }))).toEqual([409, 'OFFBOARDING_STATE', { state: 'requested' }])
    expect((await confirm(w.admin)).statusCode).toBe(200)
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'archive', { export_id: before }))[1]).toBe('EXPORT_REQUIRED')
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'archive', { export_id: '00000000-0000-4000-8000-000000000000' }))[1]).toBe('EXPORT_REQUIRED')
    expect((await vendorStep(vendor1, w.tenant.id, 'archive', {})).statusCode).toBe(400)
    const exportId = await completedExport(w.admin)

    const response = await vendorStep(vendor1, w.tenant.id, 'archive', { export_id: exportId })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toMatchObject({ state: 'archived', archived_at: expect.any(String), retain_until: expect.any(String) })
    expect(await ownerRows('SELECT state FROM tenant WHERE id = $1', [w.tenant.id])).toEqual([{ state: 'archived' }])
    expect(await vendorActions(response.json().data.id)).toEqual(['OFFBOARDING.REQUESTED', 'OFFBOARDING.ARCHIVED'])
    expect(await auditActions(w.tenant.id)).toContain('OFFBOARDING.ARCHIVED')

    // C-V1A-12: later exports never expire the archive's export (seven are kept otherwise). Archiving ended the sessions.
    const admin = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Tenant admin'], stepUp: true })
    for (let i = 0; i < 8; i += 1) await completedExport(admin)
    expect(await ownerRows('SELECT state FROM data_export WHERE id = $1', [exportId])).toEqual([{ state: 'completed' }])
    expect(await ownerRows('SELECT state FROM data_export WHERE id = $1', [before])).toEqual([{ state: 'expired' }])
  })

  test('archived: staff sign in with a password and read, writes are refused, invitations stay refused', async () => {
    const signedIn = await call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: w.tenant.slug, email: w.reader.email, password: PASSWORD } })
    expect(signedIn.statusCode, signedIn.body).toBe(201)
    const session = sessionFrom(signedIn)

    const me = await call(app, { method: 'GET', url: '/v1/me', as: session })

    expect(me.json().data.tenant).toMatchObject({ state: 'archived', read_only: true })
    expect((await call(app, { method: 'GET', url: '/v1/markets', as: session })).statusCode).toBe(200)
    const admin = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Tenant admin'], stepUp: true })
    expect(refusal(await call(app, { method: 'POST', url: '/v1/users', as: admin, body: { email: 'x@acme.test', display_name: 'X' }, idempotencyKey: true }))[1])
      .toBe('TENANT_READ_ONLY')
  })
})

describe('T-V1A-52 / T-V1A-53: purge request, independent approval, restore and the purge', () => {
  let w: World
  let uploads: string

  beforeAll(async () => {
    w = await world()
    await archived(w)
    uploads = await mkdtemp(join(tmpdir(), 'nmp-purge-'))
  }, 60_000)

  test('restore returns another tenant to its previous state and lets it write again', async () => {
    const other = await world()
    await archived(other)
    expect(refusal(await vendorStep(vendorNoStepUp, other.tenant.id, 'restore'))[1]).toBe('STEP_UP_REQUIRED')

    const restored = await vendorStep(vendor2, other.tenant.id, 'restore')

    expect(restored.json().data).toMatchObject({ state: 'restored' })
    expect(await ownerRows('SELECT state FROM tenant WHERE id = $1', [other.tenant.id])).toEqual([{ state: 'live' }])
    expect((await call(app, { method: 'GET', url: '/v1/me', as: other.admin })).statusCode).toBe(401) // archiving revoked the sessions
    const admin = await createSignedInUser({ tenantId: other.tenant.id, roles: ['Tenant admin'], stepUp: true })
    expect((await call(app, { method: 'GET', url: '/v1/me', as: admin })).json().data.tenant.read_only).toBe(false)
    expect(refusal(await vendorStep(vendor1, other.tenant.id, 'restore'))).toEqual([409, 'OFFBOARDING_STATE', { state: null }])
  })

  test('cancel: the vendor from requested, the tenant admin from confirmed (allowed while read-only)', async () => {
    const vendorSide = await world()
    expect((await request(vendor1, vendorSide.tenant.id)).statusCode).toBe(201)
    expect((await vendorStep(vendor2, vendorSide.tenant.id, 'cancel')).json().data).toMatchObject({ state: 'cancelled' })
    const tenantSide = await world()
    expect((await request(vendor1, tenantSide.tenant.id)).statusCode).toBe(201)
    expect((await confirm(tenantSide.admin)).statusCode).toBe(200)

    const cancelled = await call(app, { method: 'POST', url: '/v1/offboarding/cancel', as: tenantSide.admin, body: {} })

    expect(cancelled.json().data).toMatchObject({ state: 'cancelled' })
    expect((await call(app, { method: 'GET', url: '/v1/me', as: tenantSide.admin })).json().data.tenant.read_only).toBe(false)
    expect(refusal(await vendorStep(vendor1, tenantSide.tenant.id, 'cancel'))[1]).toBe('OFFBOARDING_STATE')
  })

  test('purge request: retention not elapsed, then a legal hold, refuse; the requester cannot approve; another vendor user can', async () => {
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'purge-request'))).toEqual([409, 'RETENTION_NOT_ELAPSED', {
      retain_until: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }])
    // FIXTURE: the retention passed (archived two years ago) and a legal hold is active.
    await ownerRows(`UPDATE tenant_offboarding SET archived_at = now() - interval '2 years' WHERE tenant_id = $1 AND state = 'archived'`, [w.tenant.id])
    const [hold] = await ownerRows<{ id: string }>(
      `INSERT INTO legal_hold (tenant_id, participant_id, reason, placed_by) VALUES ($1, $2, 'Litigation', $3) RETURNING id`, [w.tenant.id, w.member, w.admin.id])
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'purge-request'))[1]).toBe('LEGAL_HOLD_PRESENT')
    await ownerRows('UPDATE legal_hold SET released_by = $2, released_at = now() WHERE id = $1', [hold!.id, w.reader.id])

    expect((await vendorStep(vendor1, w.tenant.id, 'purge-request')).json().data).toMatchObject({ state: 'purge_requested' })
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'purge-approve'))[1]).toBe('SOD_SELF_APPROVAL')
    const approved = await vendorStep(vendor2, w.tenant.id, 'purge-approve')

    expect(approved.json().data).toMatchObject({ state: 'purge_approved' })
    expect(refusal(await vendorStep(vendor1, w.tenant.id, 'restore'))[1]).toBe('OFFBOARDING_STATE')
    expect(await vendorActions(approved.json().data.id)).toEqual([
      'OFFBOARDING.REQUESTED', 'OFFBOARDING.ARCHIVED', 'OFFBOARDING.PURGE_REQUESTED', 'OFFBOARDING.PURGE_APPROVED',
    ])
  })

  test('T-V1A-53: the purge deletes every row of the tenant (catalogue), its jobs and uploads; another tenant is intact', async () => {
    const [database] = await ownerRows<{ name: string }>('SELECT current_database() AS name')
    expect(database!.name).toMatch(/^nmp_test(_[1-6])?$/) // never outside a slot test database
    await mkdir(join(uploads, w.tenant.id, 'documents'), { recursive: true })
    await writeFile(join(uploads, w.tenant.id, 'documents', 'file'), 'x')
    await mkdir(join(uploads, globex.id), { recursive: true })
    const tables = await ownerRows<{ rel: string; col: string }>(
      `SELECT c.oid::regclass::text AS rel, 'tenant_id' AS col FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace)
       UNION
       SELECT k.conrelid::regclass::text, a.attname::text FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
       WHERE k.contype = 'f' AND k.confrelid = 'tenant'::regclass AND cardinality(k.conkey) = 1`,
    )
    const counts = async (tenantId: string) => Object.fromEntries(await Promise.all(tables.map(async ({ rel, col }) =>
      [`${rel}.${col}`, Number((await ownerRows<{ n: string }>(`SELECT count(*) AS n FROM ${rel} WHERE ${col} = $1`, [tenantId]))[0]!.n)] as const)))
    const jobs = async (tenantId: string) =>
      Number((await ownerRows<{ n: string }>(`SELECT count(*) AS n FROM pgboss.job WHERE data ->> 'tenantId' = $1`, [tenantId]))[0]!.n)
    const globexBefore = await counts(globex.id)
    const globexJobs = await jobs(globex.id)
    expect(await jobs(w.tenant.id)).toBeGreaterThan(0)
    await expect(purgeTenant({ tenant: w.tenant.id, slug: 'wrong-slug' }, uploads)).rejects.toThrow('refused: the slug does not name this tenant')

    const summary = await purgeTenant({ tenant: w.tenant.id, slug: w.tenant.slug }, uploads)

    expect(summary).toMatchObject({ rows: expect.any(Number) })
    const left = Object.entries(await counts(w.tenant.id)).filter(([table, n]) => n > 0 && !table.startsWith('tenant_offboarding.'))
    expect(left).toEqual([])
    expect(await jobs(w.tenant.id)).toBe(0)
    expect(await counts(globex.id)).toEqual(globexBefore)
    expect(await jobs(globex.id)).toBe(globexJobs)
    expect(await ownerRows('SELECT state FROM tenant_offboarding WHERE tenant_id = $1 AND state = $2', [w.tenant.id, 'purged'])).toHaveLength(1)
    expect(await ownerRows('SELECT 1 FROM tenant WHERE id = $1', [w.tenant.id])).toHaveLength(1)
    expect(await ownerRows(`SELECT 1 FROM audit.vendor_event WHERE action = 'TENANT.PURGED' AND object_id = $1`, [w.tenant.id])).toHaveLength(1)
    expect(await readdir(uploads)).toEqual([globex.id])
    await expect(purgeTenant({ tenant: w.tenant.id, slug: w.tenant.slug }, uploads)).rejects.toThrow('refused')
  })
})
