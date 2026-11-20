import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, type KeyObject } from 'node:crypto'
import { once } from 'node:events'
import { createGzip } from 'node:zlib'
import { eligibleApprovers, withSystem, type Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { recordExport } from '../../lib/exports.js'
import { defineSystemJob, defineTenantJob, enqueue, type JobContext } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import {
  EXCLUDED_COLUMNS, EXCLUDED_TABLES, EXPORT_FETCH_ROWS, EXPORT_MODEL_VERSION, EXPORT_TABLE_MAX_BYTES, FULL_EXPORTS_KEPT, loadModel,
  type LoadedTable, type ModelColumn,
} from './export-model.js'

// D-B6-06 full data export (FR-INT-003): one REPEATABLE READ snapshot of the tenant written as one gzipped JSON Lines file
// per published table, a manifest signed with the tenant's Ed25519 export key, then retention. The snapshot transaction
// only reads: files, export_job, audit and -> completed are written by a READ COMMITTED transaction, because the audit
// chain trigger reads the chain head with its transaction's snapshot (a REPEATABLE READ writer collides with any audit
// event committed after its snapshot, 23505). shortcut: read from the primary; a read replica when one exists (V1, API.md C-32).

const KEY_INFO = 'nmp/full-export/v1'
const SEED_BYTES = 32
// PKCS#8 DER header of an Ed25519 private key; the 32-byte seed follows (RFC 8410).
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const UNIQUE_VIOLATION = '23505'
const FULL_EXPORT_JOB = 'int.full-export.generate'
/**
 * pg-boss hands an active job to another worker once it expires (queue default 15 minutes); a generation reads every
 * table, so the job expires far later. shortcut: no measured generation time behind 4 hours (FR-INT-003 sets no budget);
 * a second attempt that still arrives waits on claimGeneration. Measure on the D-B6-12 fixture before enabling that scale.
 */
const FULL_EXPORT_JOB_EXPIRY = '4 hours'
const ISO_UTC = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** The tenant's export signing key: seed = HKDF-SHA256(SECRET_ENCRYPTION_KEY, tenant id, 'nmp/full-export/v1'). */
export function signingKey(secretKey: Buffer, tenantId: string): KeyObject {
  const seed = Buffer.from(hkdfSync('sha256', secretKey, tenantId, KEY_INFO, SEED_BYTES))
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

/** GET /v1/exports/signing-key: the public key to verify manifests offline. */
export function signingKeyView(secretKey: Buffer, tenantId: string) {
  const der = createPublicKey(signingKey(secretKey, tenantId)).export({ format: 'der', type: 'spki' })
  return { algorithm: 'Ed25519', public_key: der.toString('base64'), key_id: createHash('sha256').update(der).digest('hex').slice(0, 16) }
}

/** The signed form of a manifest: JSON without whitespace, object keys sorted (code unit order) at every level. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** A generation refusal that no retry changes (stored as the export's error). */
export class ExportFailure extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) {
    super(code)
  }
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`

/** bigint/numeric as strings, bytea as hex, instants ISO-8601 UTC with microseconds; everything else as JSON has it. */
function columnSql(column: ModelColumn): string {
  const value = `t.${ident(column.name)}`
  if (column.type === 'bigint' || column.type.startsWith('numeric')) return `${value}::text`
  if (column.type === 'bytea') return `encode(${value}, 'hex')`
  if (column.type === 'timestamp with time zone') return ISO_UTC(value)
  return value
}

interface ManifestTable {
  readonly name: string
  readonly file: string
  readonly rows: number
  readonly bytes: number
  readonly sha256: string
}

/** One table's rows at the snapshot, ordered by primary key, as a gzip buffer; the export fails over maxBytes. */
async function tableFile(tx: Tx, table: LoadedTable, maxBytes: number): Promise<{ content: Buffer; rows: number }> {
  const gzip = createGzip()
  const chunks: Buffer[] = []
  let bytes = 0
  gzip.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    bytes += chunk.length
  })
  const ended = once(gzip, 'end')
  const tooLarge = () => {
    gzip.destroy()
    return new ExportFailure('EXPORT_TABLE_TOO_LARGE', { table: table.name })
  }
  const select = table.columns.map((column) => `${columnSql(column)} AS ${ident(column.name)}`).join(', ')
  await tx.query(
    `DECLARE export_rows NO SCROLL CURSOR FOR
     SELECT row_to_json(r)::text AS line FROM ${ident(table.schema)}.${ident(table.name)} t CROSS JOIN LATERAL (SELECT ${select}) r
     ORDER BY ${table.primaryKey.map((column) => `t.${ident(column)}`).join(', ')}`,
  )
  let rows = 0
  for (;;) {
    const { rows: batch } = await tx.query<{ line: string }>(`FETCH ${EXPORT_FETCH_ROWS} FROM export_rows`)
    if (batch.length === 0) break
    rows += batch.length
    if (!gzip.write(batch.map((row) => `${row.line}\n`).join(''))) await once(gzip, 'drain')
    if (bytes > maxBytes) throw tooLarge()
  }
  await tx.query('CLOSE export_rows')
  gzip.end()
  await ended
  if (bytes > maxBytes) throw tooLarge()
  return { content: Buffer.concat(chunks), rows }
}

async function writeTable(snapshot: Tx, tx: Tx, exportId: string, table: LoadedTable, maxBytes: number): Promise<ManifestTable> {
  const { rows: counted } = await snapshot.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${ident(table.schema)}.${ident(table.name)}`)
  const expected = Number(counted[0]!.n)
  const { content, rows } = await tableFile(snapshot, table, maxBytes)
  // AC-32.1: the file holds exactly the rows counted at the snapshot.
  if (rows !== expected) throw new ExportFailure('EXPORT_COUNT_MISMATCH', { table: table.name, counted: expected, written: rows })
  await tx.query(
    'INSERT INTO data_export_file (tenant_id, export_id, table_name, row_count, content) VALUES (app_tenant_id(), $1, $2, $3, $4)',
    [exportId, table.name, rows, content],
  )
  return { name: table.name, file: `${table.name}.jsonl.gz`, rows, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }
}

/** queued -> running (committed on its own, so an erasure's update never waits for the generation); false: nothing to do. */
async function startExport(tx: Tx, exportId: string): Promise<boolean> {
  const { rowCount } = await tx.query(`UPDATE data_export SET state = 'running' WHERE id = $1 AND state IN ('queued', 'running')`, [exportId])
  return rowCount === 1
}

interface Requester {
  readonly requested_by: string | null
  readonly requested_by_type: string
}

/**
 * This export's generation lock for the write transaction, so a second attempt of the job (a pg-boss expiry) waits for
 * the first; then the requester while the export still runs, undefined once it finished.
 */
async function claimGeneration(tx: Tx, exportId: string): Promise<Requester | undefined> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('int.full-export:' || $1, 0))`, [exportId])
  const { rows } = await tx.query<Requester>(`SELECT requested_by, requested_by_type FROM data_export WHERE id = $1 AND state = 'running'`, [exportId])
  return rows[0]
}

/**
 * Reads the REPEATABLE READ `snapshot`, writes files, manifest, signature, export_job and -> completed in `tx` (READ
 * COMMITTED). An erasure committed meanwhile failed the export, so the final update matches no row and every file rolls
 * back (D-B6-13).
 */
export async function writeExport(snapshot: Tx, tx: Tx, exportId: string, requester: Requester, secretKey: Buffer, maxTableBytes: number): Promise<void> {
  const { rows: head } = await snapshot.query<{ tenant_id: string; snapshot_at: string }>(`SELECT app_tenant_id() AS tenant_id, ${ISO_UTC('now()')} AS snapshot_at`)
  const { tenant_id: tenantId, snapshot_at: snapshotAt } = head[0]!
  const tables: ManifestTable[] = []
  for (const table of await loadModel(snapshot)) tables.push(await writeTable(snapshot, tx, exportId, table, maxTableBytes))
  const { rows: clock } = await tx.query<{ at: string }>(`SELECT ${ISO_UTC('clock_timestamp()')} AS at`)
  const manifest = {
    model_version: EXPORT_MODEL_VERSION, tenant_id: tenantId, snapshot_at: snapshotAt, generated_at: clock[0]!.at, export_id: exportId,
    tables, excluded_tables: EXCLUDED_TABLES, excluded_columns: EXCLUDED_COLUMNS,
  }
  const signature = sign(null, Buffer.from(canonicalJson(manifest)), signingKey(secretKey, tenantId))
  const totalRows = tables.reduce((sum, table) => sum + table.rows, 0)
  // The limit of this export is export.full for all markets plus step-up (BR-SEC-03), not a row cap.
  // The job writes as the system actor: the filters name who requested the export (BR-SEC-03).
  const requestedBy = requester.requested_by === null ? null : { id: requester.requested_by, type: requester.requested_by_type }
  const decision = await recordExport(tx, {
    kind: 'full_data', filters: { export_id: exportId, requested_by: requestedBy }, rowCount: totalRows, rowCap: Number.MAX_SAFE_INTEGER,
  })
  if (decision.refused) throw new ExportFailure('EXPORT_ROW_CAP_EXCEEDED')
  const { rowCount } = await tx.query(
    `UPDATE data_export SET state = 'completed', snapshot_at = $5, manifest = $2, signature = $3, export_job_id = $4, finished_at = clock_timestamp()
     WHERE id = $1 AND state = 'running'`,
    [exportId, manifest, signature, decision.job.id, snapshotAt],
  )
  if (rowCount !== 1) throw new ExportFailure('EXPORT_STOPPED')
  await recordAudit(tx, { action: 'EXPORT.COMPLETED', objectType: 'data_export', objectId: exportId, after: { tables: tables.length, total_rows: totalRows } })
}

/** -> failed with the code; the active all-market export.full holders to mail (none when an erasure failed it first). */
async function failExport(tx: Tx, exportId: string, failure: ExportFailure): Promise<string[]> {
  const { rowCount } = await tx.query(
    `UPDATE data_export SET state = 'failed', error = $2, finished_at = now() WHERE id = $1 AND state IN ('queued', 'running')`,
    [exportId, { code: failure.code, ...failure.details }],
  )
  if (rowCount !== 1) return []
  await recordAudit(tx, { action: 'EXPORT.FAILED', objectType: 'data_export', objectId: exportId, after: { code: failure.code } })
  const holders = await eligibleApprovers(tx, { permission: 'export.full', marketId: null, excludeUserIds: [], allMarkets: true })
  return holders.map((holder) => holder.email)
}

async function mailFailure(mailDir: string, exportId: string, code: string, recipients: readonly string[]): Promise<void> {
  for (const to of recipients) {
    await sendMail(mailDir, {
      to, subject: 'A full data export failed',
      text: `The full data export ${exportId} failed (${code}). Run it again from Integrations > Data exports.`,
    })
  }
}

interface Abandoned {
  readonly id: string
  readonly recipients: readonly string[]
}

/**
 * Queued or running exports whose job pg-boss no longer runs or retries -> failed EXPORT_ABANDONED. A killed worker, a stop
 * that timed out or an expiry on the last attempt ends the job without the handler's catch, and the export would refuse
 * every later one (data_export_one_running).
 */
async function failAbandoned(tx: Tx): Promise<Abandoned[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT d.id FROM data_export d
     WHERE d.state IN ('queued', 'running') AND NOT EXISTS (
       SELECT 1 FROM pgboss.job j
       WHERE j.name = $1 AND j.data -> 'payload' ->> 'export_id' = d.id::text AND j.state IN ('created', 'retry', 'active'))`,
    [FULL_EXPORT_JOB],
  )
  const failed: Abandoned[] = []
  for (const { id } of rows) failed.push({ id, recipients: await failExport(tx, id, new ExportFailure('EXPORT_ABANDONED')) })
  return failed
}

/** Fails the tenant's abandoned exports in a transaction of their own, then mails the holders (POST /v1/exports, the schedule). */
export async function recoverAbandoned(inTx: (fn: (tx: Tx) => Promise<Abandoned[]>) => Promise<Abandoned[]>, mailDir: string): Promise<void> {
  for (const { id, recipients } of await inTx(failAbandoned)) await mailFailure(mailDir, id, 'EXPORT_ABANDONED', recipients)
}

/** Retention: the latest FULL_EXPORTS_KEPT completed exports keep their files; older ones expire and lose them. */
async function expireOld(tx: Tx): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE data_export SET state = 'expired'
     WHERE state = 'completed' AND id NOT IN (SELECT id FROM data_export WHERE state = 'completed' ORDER BY created_at DESC, id DESC LIMIT $1)
     RETURNING id`,
    [FULL_EXPORTS_KEPT],
  )
  for (const { id } of rows) {
    const { rowCount } = await tx.query('DELETE FROM data_export_file WHERE export_id = $1', [id])
    await recordAudit(tx, { action: 'EXPORT.EXPIRED', objectType: 'data_export', objectId: id, after: { files_deleted: rowCount } })
  }
}

/** Whether pg-boss will not retry the job after this attempt. */
async function lastAttempt(tx: Tx, jobId: string): Promise<boolean> {
  const { rows } = await tx.query<{ last: boolean }>('SELECT retry_count >= retry_limit AS last FROM pgboss.job WHERE name = $1 AND id = $2', [
    FULL_EXPORT_JOB, jobId,
  ])
  return rows[0]?.last ?? true
}

/**
 * The job's own transaction only names the tenant: start, the write transaction (holding the read-only snapshot
 * transaction), a failure and retention commit on their own (the export row must not stay locked by the job). Transient
 * errors retry (pg-boss retry 2); a final failure or a refusal fails the export and mails the all-market export.full
 * holders after it committed.
 */
export async function generateExport(jobTx: Tx, exportId: string, ctx: JobContext, maxTableBytes = EXPORT_TABLE_MAX_BYTES): Promise<void> {
  const { rows } = await jobTx.query<{ tenant_id: string }>('SELECT app_tenant_id() AS tenant_id')
  const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
  const ctxOf = { tenantId: rows[0]!.tenant_id, userId: SYSTEM_ACTOR_ID }
  if (!(await runInTenant(ctxOf, actor, (tx) => startExport(tx, exportId)))) return
  try {
    await runInTenant(ctxOf, actor, async (tx) => {
      const requester = await claimGeneration(tx, exportId)
      if (requester === undefined) return
      await runInTenant(ctxOf, actor, async (snapshot) => {
        await snapshot.query('SET TRANSACTION READ ONLY')
        await writeExport(snapshot, tx, exportId, requester, ctx.config.secretKey, maxTableBytes)
      }, { isolation: 'repeatable read' })
    })
  } catch (error) {
    if (!(error instanceof ExportFailure) && !(await lastAttempt(jobTx, ctx.jobId))) throw error
    ctx.log.error({ err: error, exportId }, 'full data export failed')
    const failure = error instanceof ExportFailure ? error : new ExportFailure('EXPORT_FAILED')
    const recipients = await runInTenant(ctxOf, actor, (tx) => failExport(tx, exportId, failure))
    await mailFailure(ctx.config.mailDir, exportId, failure.code, recipients)
    return
  }
  await runInTenant(ctxOf, actor, expireOld)
}

export const fullExportJob = defineTenantJob({
  name: FULL_EXPORT_JOB,
  payload: z.strictObject({ export_id: z.uuid() }),
  run: (tx, payload, ctx) => generateExport(tx, payload.export_id, ctx),
})

/** POST /v1/exports and the schedule: a queued export and its job; 409 EXPORT_RUNNING while another is queued or running. */
export async function requestExport(tx: Tx, trigger: 'manual' | 'schedule'): Promise<{ id: string; state: 'queued' }> {
  const running = await tx.query(`SELECT 1 FROM data_export WHERE state IN ('queued', 'running')`)
  const refused = () => new ApiError(409, 'EXPORT_RUNNING', 'A full export is already queued or running.')
  if (running.rowCount !== 0) throw refused()
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO data_export (tenant_id, trigger, model_version, requested_by)
     VALUES (app_tenant_id(), $1, $2, CASE WHEN app_actor_type() <> 'system' THEN app_user_id() END) RETURNING id`,
    [trigger, EXPORT_MODEL_VERSION],
  ).catch((error: unknown) => {
    throw (error as { code?: string }).code === UNIQUE_VIOLATION ? refused() : error
  })
  const id = rows[0]!.id
  await recordAudit(tx, { action: 'EXPORT.REQUESTED', objectType: 'data_export', objectId: id, after: { trigger } })
  const jobId = await enqueue(tx, fullExportJob, { export_id: id })
  await tx.query('UPDATE pgboss.job SET expire_in = $3::interval WHERE name = $1 AND id = $2', [FULL_EXPORT_JOB, jobId, FULL_EXPORT_JOB_EXPIRY])
  return { id, state: 'queued' }
}

/**
 * Hourly at :05: every tenant's abandoned exports fail, then one scheduled export per tenant whose exports.full_schedule
 * window is due (AC-INT3-4).
 */
export const fullExportScheduleJob = defineSystemJob({
  name: 'int.full-exports.schedule',
  cron: '5 * * * *',
  async run(ctx) {
    const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
    const inTenantTx = (tenantId: string) => <T>(fn: (tx: Tx) => Promise<T>) => runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, actor, fn)
    const { rows: tenants } = await withSystem((tx) => tx.query<{ id: string }>('SELECT system_tenant_ids() AS id'))
    for (const { id: tenantId } of tenants) {
      await recoverAbandoned(inTenantTx(tenantId), ctx.config.mailDir).catch((error: unknown) => {
        ctx.log.error({ err: error, tenantId }, 'abandoned full exports not failed; retried next hour')
      })
    }
    const { rows } = await withSystem((tx) => tx.query<{ tenant_id: string }>('SELECT tenant_id FROM int_due_full_exports()'))
    for (const { tenant_id: tenantId } of rows) {
      try {
        await inTenantTx(tenantId)((tx) => requestExport(tx, 'schedule'))
      } catch (error) {
        ctx.log.error({ err: error, tenantId }, 'scheduled full export not started; retried next hour')
      }
    }
  },
})
