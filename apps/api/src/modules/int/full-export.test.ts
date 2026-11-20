import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import type { Tx } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, mailsTo, ownerRows, resetApiDb, runQueuedJobs,
  testConfig, type TestUser,
} from '../../../test/helpers/index.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { iamModule } from '../iam/index.js'
import { EXCLUDED_COLUMNS, FULL_EXPORTS_KEPT } from './export-model.js'
import { canonicalJson, fullExportJob, fullExportScheduleJob, generateExport } from './full-export.js'
import { intModule } from './index.js'
import { setSettings } from './test-support.js'

// T-B6-11..15 (FR-INT-003, D-B6-06/13/17): generation, manifest and signature, snapshot consistency, routes and key scope,
// the schedule cron, failure mails, retention and erasure.

let app: FastifyInstance
let tenantId: string
let gbId: string
let globexId: string
let admin: TestUser
let noStepUp: TestUser
let scoped: TestUser
let analyst: TestUser
let globexAdmin: TestUser
let token: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  globexId = (await createTenant()).id
  gbId = await createMarket(tenantId, 'GB')
  await createMarket(globexId, 'GB')
  admin = await createSignedInUser({ tenantId, roles: ['Tenant admin'], stepUp: true })
  noStepUp = await createSignedInUser({ tenantId, roles: ['Tenant admin'] })
  scoped = await createSignedInUser({ tenantId, roles: ['Tenant admin'], marketIds: [gbId], stepUp: true })
  analyst = await createSignedInUser({ tenantId, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globexId, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, intModule] })
  const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as: admin, body: { name: 'warehouse', purpose: 'exports' }, idempotencyKey: true })
  const key = await call(app, {
    method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as: admin, body: { name: 'full', scopes: ['exports:full'], rate_tier: 'standard' }, idempotencyKey: true,
  })
  expect(key.statusCode, key.body).toBe(201)
  token = key.json().data.token
})

afterAll(async () => {
  await app.close()
})

const get = (url: string, as: TestUser = admin) => call(app, { method: 'GET', url, as })
const asKey = (method: 'GET' | 'POST', url: string) => app.inject({
  method, url, headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, ...(method === 'POST' ? { payload: {} } : {}),
})
const requestExport = (as: TestUser = admin) => call(app, { method: 'POST', url: '/v1/exports', as, body: {}, idempotencyKey: true })
const stateOf = async (id: string) => (await ownerRows<{ state: string; error: unknown }>('SELECT state, error FROM data_export WHERE id = $1', [id]))[0]!
const filesOf = async (id: string) => (await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM data_export_file WHERE export_id = $1', [id]))[0]!.n
const jobContext = () => ({ jobId: randomUUID(), log: fastify({ logger: false }).log, config: testConfig() })

async function exported(as: TestUser = admin): Promise<string> {
  const response = await requestExport(as)
  expect(response.statusCode, response.body).toBe(202)
  await runQueuedJobs(fullExportJob)
  return response.json().data.id
}

/** Waits until a backend of this database waits on a lock (the job reached the point a holder blocks). */
async function lockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
    if (row!.n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('no backend waits on a lock')
}

/** The owner connection that holds a lock (only its query is used). */
type Holder = { query: (sql: string, params?: unknown[]) => Promise<unknown> }

/** Runs the queued export job while `holder` holds `lock`; `meanwhile` runs once the job waits, then the holder commits. */
async function whileBlocked(lock: string, meanwhile: (holder: Holder) => Promise<unknown>): Promise<unknown> {
  const holder = await getOwnerPool().connect()
  try {
    await holder.query('BEGIN')
    await holder.query(lock)
    const job = runQueuedJobs(fullExportJob).then(() => null, (error: unknown) => error)
    await lockWaiter()
    await meanwhile(holder)
    await holder.query('COMMIT')
    return await job
  } finally {
    holder.release()
  }
}

const AUDIT_LOCK = (tenant: string) => `SELECT pg_advisory_xact_lock(hashtextextended('audit.audit_event:${tenant}', 0))`
/** Cancels the statement of the backend waiting on a lock: a transient error (57014) of the job's snapshot read. */
const CANCEL_WAITER = `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`

/** An approved erasure request for a new participant (written with triggers off, as PRV's decision would leave it). */
async function approvedErasure(): Promise<string> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN; SET LOCAL session_replication_role = replica')
    const { rows } = await client.query<{ id: string }>(
      `WITH p AS (INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
                  VALUES ($1, gen_random_uuid()::text, 'individual', $2, now(), $3, 'system') RETURNING id),
            c AS (INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, opened_by_kind, submitted_by,
                                         submitted_at, approval_id, decided_at)
                  VALUES ($1, 'privacy', 'privacy_request', $4, 'RECEIVED_BY_STAFF', 'approved', '{}', 'system', $3, now(), gen_random_uuid(), now())
                  RETURNING id)
       INSERT INTO privacy_request (id, tenant_id, case_id, type, channel, subject_participant_id, verified_at, verified_by, verification_method, created_by)
       SELECT $4, $1, c.id, 'erasure', 'staff', p.id, now(), $3, 'contact_match', $3 FROM p, c RETURNING id`,
      [tenantId, gbId, admin.id, randomUUID()],
    )
    await client.query('COMMIT')
    return rows[0]!.id
  } finally {
    client.release()
  }
}

const erase = (tx: Tx, requestId: string) => tx.query('SELECT prv_erase_participant($1)', [requestId])
const inAdminTx = <T>(fn: (tx: Tx) => Promise<T>) =>
  runInTenant({ tenantId, userId: admin.id }, { actorType: 'user', requestId: null, supportSessionId: null }, fn)

describe('routes (T-B6-13, AC-INT3-3)', () => {
  test('step-up, all-market scope and export.full are required; another tenant\'s export is 404', async () => {
    const withoutStepUp = await requestExport(noStepUp)
    const marketScoped = await requestExport(scoped)
    const id = await exported()

    expect([withoutStepUp.statusCode, withoutStepUp.json().error.code]).toEqual([403, 'STEP_UP_REQUIRED'])
    expect([marketScoped.statusCode, marketScoped.json().error.code]).toEqual([403, 'SCOPE_NOT_HELD'])
    expect((await get('/v1/exports', analyst)).statusCode).toBe(403)
    expect((await get(`/v1/exports/${id}`, globexAdmin)).statusCode).toBe(404)
    expect((await get(`/v1/exports/${id}/files/market`, globexAdmin)).statusCode).toBe(404)
    expect((await get('/v1/exports', globexAdmin)).json().data).toEqual([])
  })

  test('one export at a time: 409 EXPORT_RUNNING while one is queued', async () => {
    const first = await requestExport()
    const second = await requestExport()
    await runQueuedJobs(fullExportJob)

    expect(first.statusCode).toBe(202)
    expect([second.statusCode, second.json().error.code]).toEqual([409, 'EXPORT_RUNNING'])
    // A generation outlives the queue's 15-minute expiry: pg-boss must not hand the active job to a second worker.
    expect(await ownerRows(`SELECT expire_in::text FROM pgboss.job WHERE name = $1 AND data -> 'payload' ->> 'export_id' = $2`,
      [fullExportJob.name, first.json().data.id])).toEqual([{ expire_in: '04:00:00' }])
    expect((await stateOf(first.json().data.id)).state).toBe('completed')
  })

  test('an exports:full key may create, list and download without step-up; downloads are audited', async () => {
    const created = await asKey('POST', '/v1/exports')
    await runQueuedJobs(fullExportJob)
    const id = created.json().data.id
    const file = await asKey('GET', `/v1/exports/${id}/files/market`)
    const [audit] = await ownerRows<{ after_ref: string; actor_type: string }>(
      `SELECT after_ref, actor_type FROM audit.audit_event WHERE tenant_id = $1 AND action = 'EXPORT.DOWNLOADED' ORDER BY seq DESC LIMIT 1`, [tenantId])

    expect(created.statusCode, created.body).toBe(202)
    expect((await asKey('GET', '/v1/exports')).statusCode).toBe(200)
    expect([file.statusCode, file.headers['content-type'], file.headers['cache-control']]).toEqual([200, 'application/gzip', 'no-store'])
    expect(file.headers['content-disposition']).toBe('attachment; filename="market.jsonl.gz"')
    expect([audit!.actor_type, JSON.parse(audit!.after_ref).after]).toEqual(['service_account', { export_id: id, table: 'market' }])
  })

  test('the model lists tables with their exported columns and the exclusions; an unknown or tampered file', async () => {
    const model = (await get('/v1/exports/model')).json().data
    const id = await exported()
    const unknown = await get(`/v1/exports/${id}/files/session`)
    const holder = await getOwnerPool().connect()
    await holder.query('BEGIN; SET LOCAL session_replication_role = replica')
    await holder.query(`UPDATE data_export_file SET content = '\\x00' WHERE export_id = $1 AND table_name = 'market'`, [id])
    await holder.query('COMMIT')
    holder.release()
    const corrupt = await get(`/v1/exports/${id}/files/market`)

    expect(model.version).toBe(1)
    expect(model.tables.find((t: { name: string }) => t.name === 'api_key').columns.map((c: { name: string }) => c.name)).not.toContain('key_hash')
    expect(model.excluded_columns).toEqual(EXCLUDED_COLUMNS)
    expect(unknown.statusCode).toBe(404)
    expect([corrupt.statusCode, corrupt.json().error.code]).toEqual([500, 'EXPORT_CORRUPT'])
  })
})

describe('generation (T-B6-11, AC-32.1)', () => {
  test('the manifest lists every table with its row count, size and sha256; the signature verifies; rows carry exactly the model columns', async () => {
    const id = await exported()
    const detail = (await get(`/v1/exports/${id}`)).json().data
    const key = (await get('/v1/exports/signing-key')).json().data
    const model = (await get('/v1/exports/model')).json().data
    const publicKey = createPublicKey({ key: Buffer.from(key.public_key, 'base64'), format: 'der', type: 'spki' })

    expect(detail).toMatchObject({ state: 'completed', trigger: 'manual', model_version: 1, requested_by: { id: admin.id, type: 'user' }, error: null })
    expect(verify(null, Buffer.from(canonicalJson(detail.manifest)), publicKey, Buffer.from(detail.signature, 'base64'))).toBe(true)
    expect(key.key_id).toBe(createHash('sha256').update(Buffer.from(key.public_key, 'base64')).digest('hex').slice(0, 16))
    expect(detail.manifest.tables.map((t: { name: string }) => t.name)).toEqual(model.tables.map((t: { name: string }) => t.name))
    expect(detail.table_count).toBe(model.tables.length)
    const [users] = await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM user_account WHERE tenant_id = $1', [tenantId])
    expect(detail.manifest.tables.find((t: { name: string }) => t.name === 'user_account').rows).toBe(users!.n)
    for (const table of detail.manifest.tables.filter((t: { rows: number }) => t.rows > 0)) {
      const file = await get(`/v1/exports/${id}/files/${table.name}`)
      const raw = file.rawPayload
      const lines = gunzipSync(raw).toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
      const columns = model.tables.find((t: { name: string }) => t.name === table.name).columns.map((c: { name: string }) => c.name)
      expect([raw.length, createHash('sha256').update(raw).digest('hex'), lines.length]).toEqual([table.bytes, table.sha256, table.rows])
      expect(lines.every((line) => JSON.stringify(Object.keys(line)) === JSON.stringify(columns))).toBe(true)
    }
    const audit = gunzipSync((await get(`/v1/exports/${id}/files/audit_event`)).rawPayload).toString('utf8').split('\n')[0]!
    expect(JSON.parse(audit)).toMatchObject({ seq: expect.stringMatching(/^\d+$/), hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      occurred_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/) })
    const listed = (await get('/v1/exports?limit=1')).json()
    expect(listed.data[0]).toMatchObject({ id, table_count: model.tables.length, total_rows: expect.any(Number) })
    expect(listed.meta.next_cursor).not.toBeNull()
    const [job] = await ownerRows<{ filters: unknown }>('SELECT j.filters FROM export_job j JOIN data_export d ON d.export_job_id = j.id WHERE d.id = $1', [id])
    expect(job!.filters).toEqual({ export_id: id, requested_by: { id: admin.id, type: 'user' } })
  })
})

describe('snapshot (T-B6-12, AC-INT3-1)', () => {
  test('a row committed by another transaction while the export runs is in neither the file nor the count', async () => {
    const response = await requestExport()
    const [before] = await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM brand WHERE tenant_id = $1', [tenantId])
    const outcome = await whileBlocked('LOCK TABLE brand IN ACCESS EXCLUSIVE MODE', (holder) =>
      holder.query(`INSERT INTO brand (tenant_id, name) VALUES ($1, 'Late brand')`, [tenantId]))
    const detail = (await get(`/v1/exports/${response.json().data.id}`)).json().data

    expect(outcome).toBeNull()
    expect(detail.manifest.tables.find((t: { name: string }) => t.name === 'brand').rows).toBe(before!.n)
    const [after] = await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM brand WHERE tenant_id = $1', [tenantId])
    expect(after!.n).toBe(before!.n + 1)
  })

  test('an audit event of the tenant committed while the export runs does not break the chain write: completed', async () => {
    const id = (await requestExport()).json().data.id
    const outcome = await whileBlocked(AUDIT_LOCK(tenantId), (holder) =>
      holder.query(`INSERT INTO audit.audit_event (tenant_id, actor_type, action) VALUES ($1, 'system', 'TEST.DURING_EXPORT')`, [tenantId]))

    expect(outcome).toBeNull()
    expect(await stateOf(id)).toEqual({ state: 'completed', error: null })
  })
})

describe('schedule (T-B6-14, AC-INT3-4)', () => {
  test('a due daily schedule starts one export per window; a second tick none; a tenant without a schedule none', async () => {
    await setSettings(tenantId, admin.id, { 'exports.full_schedule': { cadence: 'daily', hour_utc: 2 } })
    const ctx = jobContext()
    await fullExportScheduleJob.run(ctx)
    await runQueuedJobs(fullExportJob)
    await fullExportScheduleJob.run(ctx)
    const scheduled = await ownerRows<{ tenant_id: string; state: string; requested_by: string | null }>(
      `SELECT tenant_id, state, requested_by FROM data_export WHERE trigger = 'schedule'`)

    expect(scheduled).toEqual([{ tenant_id: tenantId, state: 'completed', requested_by: null }])
  })
})

describe('failure, retention and erasure (T-B6-15)', () => {
  test('AC-INT3-2/5: a table over the cap fails EXPORT_TABLE_TOO_LARGE and mails the all-market export.full holders only', async () => {
    const id = (await requestExport()).json().data.id
    await runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: null, supportSessionId: null },
      (tx) => generateExport(tx, id, jobContext(), 64))

    expect(await stateOf(id)).toEqual({ state: 'failed', error: { code: 'EXPORT_TABLE_TOO_LARGE', table: expect.any(String) } })
    expect(await filesOf(id)).toBe(0)
    expect((await mailsTo(admin.email)).some((mail) => mail.includes(`${id} failed (EXPORT_TABLE_TOO_LARGE)`))).toBe(true)
    expect((await mailsTo(noStepUp.email)).some((mail) => mail.includes(id))).toBe(true)
    expect((await mailsTo(scoped.email)).some((mail) => mail.includes(id))).toBe(false)
    await ownerRows('DELETE FROM pgboss.job WHERE name = $1', [fullExportJob.name])
  })

  test('a transient error retries (the export completes on the next attempt); on the last attempt it fails EXPORT_FAILED', async () => {
    const brandLock = 'LOCK TABLE brand IN ACCESS EXCLUSIVE MODE'
    const retried = (await requestExport()).json().data.id
    const first = await whileBlocked(brandLock, (holder) => holder.query(CANCEL_WAITER))
    expect(first).toMatchObject({ code: '57014' })
    await runQueuedJobs(fullExportJob)
    expect((await stateOf(retried)).state).toBe('completed')

    const last = (await requestExport()).json().data.id
    await ownerRows('UPDATE pgboss.job SET retry_count = retry_limit WHERE name = $1', [fullExportJob.name])
    expect(await whileBlocked(brandLock, (holder) => holder.query(CANCEL_WAITER))).toBeNull()
    expect(await stateOf(last)).toEqual({ state: 'failed', error: { code: 'EXPORT_FAILED' } })
    expect((await mailsTo(admin.email)).some((mail) => mail.includes(`${last} failed (EXPORT_FAILED)`))).toBe(true)
  })

  test('an export whose job ended without its handler (worker killed, expiry) fails EXPORT_ABANDONED on the next tick or request', async () => {
    const abandon = async (id: string) => {
      await ownerRows(`UPDATE data_export SET state = 'running' WHERE id = $1`, [id])
      await ownerRows(`UPDATE pgboss.job SET state = 'failed' WHERE name = $1 AND data -> 'payload' ->> 'export_id' = $2`, [fullExportJob.name, id])
    }
    const byTick = (await requestExport()).json().data.id
    await abandon(byTick)
    await fullExportScheduleJob.run(jobContext())
    const byRequest = (await requestExport()).json().data.id
    await abandon(byRequest)
    const next = await requestExport()
    await runQueuedJobs(fullExportJob)

    expect(await stateOf(byTick)).toEqual({ state: 'failed', error: { code: 'EXPORT_ABANDONED' } })
    expect(await stateOf(byRequest)).toEqual({ state: 'failed', error: { code: 'EXPORT_ABANDONED' } })
    expect(next.statusCode, next.body).toBe(202)
    expect((await stateOf(next.json().data.id)).state).toBe('completed')
    expect((await mailsTo(admin.email)).some((mail) => mail.includes(`${byRequest} failed (EXPORT_ABANDONED)`))).toBe(true)
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'EXPORT.FAILED' AND object_id = ANY ($1)`, [[byTick, byRequest]]))
      .toHaveLength(2)
  })

  test('AC-INT3-5: the export after the 7th kept one expires the oldest, deletes its files and audits EXPORT.EXPIRED', async () => {
    for (let i = 0; i < FULL_EXPORTS_KEPT; i += 1) await exported()
    const completed = await ownerRows<{ id: string }>(
      `SELECT id FROM data_export WHERE tenant_id = $1 AND state = 'completed' ORDER BY created_at, id`, [tenantId])
    const expired = await ownerRows<{ id: string }>(`SELECT id FROM data_export WHERE tenant_id = $1 AND state = 'expired'`, [tenantId])

    expect(completed).toHaveLength(FULL_EXPORTS_KEPT)
    expect(expired.length).toBeGreaterThan(0)
    expect(await ownerRows('SELECT 1 FROM data_export_file WHERE export_id = ANY ($1)', [expired.map((e) => e.id)])).toEqual([])
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE action = 'EXPORT.EXPIRED' AND object_id = $1`, [expired[0]!.id])).toHaveLength(1)
  })

  test('AC-INT3-6: an erasure expires completed exports; a running one ends ERASED_DURING_EXPORT without files or mail; a queued one too', async () => {
    const mailsBefore = (await mailsTo(admin.email)).length
    const [first, second] = [await approvedErasure(), await approvedErasure()]
    const running = (await requestExport()).json().data.id
    // The erasure commits in a tenant transaction while the generation waits on the audit chain lock that transaction holds.
    const { job } = await inAdminTx(async (tx) => {
      await tx.query(AUDIT_LOCK(tenantId))
      const generation = runQueuedJobs(fullExportJob).then(() => null, (error: unknown) => error)
      await lockWaiter()
      await erase(tx, first)
      return { job: generation }
    })
    expect(await job).toBeNull()
    expect(await ownerRows(`SELECT 1 FROM data_export WHERE tenant_id = $1 AND state = 'completed'`, [tenantId])).toEqual([])
    await runQueuedJobs(fullExportJob)
    expect(await stateOf(running)).toEqual({ state: 'failed', error: { code: 'ERASED_DURING_EXPORT' } })
    expect(await filesOf(running)).toBe(0)

    const queued = (await requestExport()).json().data.id
    await inAdminTx((tx) => erase(tx, second))
    await runQueuedJobs(fullExportJob)
    expect(await stateOf(queued)).toEqual({ state: 'failed', error: { code: 'ERASED_DURING_EXPORT' } })
    expect(await ownerRows('SELECT 1 FROM data_export_file WHERE tenant_id = $1', [tenantId])).toEqual([])
    expect((await mailsTo(admin.email)).length).toBe(mailsBefore)
  })

  test('D-B6-13: data_export and data_export_file are hidden from portal transactions', async () => {
    const counts = await runInTenant({ tenantId, userId: admin.id, participantId: randomUUID() }, { actorType: 'user', requestId: null, supportSessionId: null },
      async (tx) => (await tx.query<{ n: number }>('SELECT (SELECT count(*) FROM data_export) + (SELECT count(*) FROM data_export_file) AS n')).rows[0]!.n)

    expect(Number(counts)).toBe(0)
  })
})
