import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { envelope } from '../../lib/http.js'
import type { StoredResponse } from '../../lib/idempotency.js'
import { getBatch, type BatchState, type FileDigest, type MarketScope } from './batches.js'
import type { FileStore } from './file-store.js'
import type { Finding } from './findings.js'
import { sha256Hex, type Upload } from './upload.js'
import { validateImport, type ValidationResult } from './validate.js'
import { IMPORT_FILES, type ImportFile } from './vocabulary.js'

export interface NewBatch {
  /** Chosen by the caller so the files of a failed request can be removed. */
  readonly batchId: string
  readonly tenantId: string
  readonly upload: Upload
  readonly scope: MarketScope
}

async function marketIdOf(tx: Tx, code: string, scope: MarketScope): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM market WHERE code = $1', [code])
  const id = rows[0]?.id
  if (id === undefined || (scope !== null && !scope.includes(id))) {
    throw new ApiError(422, 'MARKET_UNKNOWN', 'No market with this code is available to you.')
  }
  return id
}

const fileDigests = (upload: Upload) =>
  Object.fromEntries(IMPORT_FILES.map((file) => [file, { sha256: upload.files[file].sha256, size_bytes: upload.files[file].data.length }]))

/** The upload's digests plus, for a validated batch, the digest of the stored projection the load re-checks. */
const batchFiles = (upload: Upload, stored: ValidationResult['storedFiles']): Record<string, FileDigest> =>
  Object.fromEntries(IMPORT_FILES.map((file) => [file, {
    sha256: upload.files[file].sha256, size_bytes: upload.files[file].data.length,
    ...(stored === null ? {} : { stored_sha256: sha256Hex(stored[file]) }),
  }]))

async function insertBatch(tx: Tx, batch: NewBatch, marketId: string, result: ValidationResult): Promise<void> {
  const report = { error_count: result.errorCount, errors_stored: result.findings.length, warnings: result.warnings }
  // period_to is stored as the last day of its month.
  await tx.query(
    `INSERT INTO import_batch (id, tenant_id, market_id, kind, period_from, period_to, state, row_counts, control_totals,
       files, source_values, report, uploaded_by, created_by)
     VALUES ($1, app_tenant_id(), $2, 'overlay', $3::date, ($4::date + interval '1 month' - interval '1 day')::date,
       'uploaded', $5, $6, $7, $8, $9, current_setting('app.user_id')::uuid, current_setting('app.user_id')::uuid)`,
    [batch.batchId, marketId, `${batch.upload.period.from}-01`, `${batch.upload.period.to}-01`, result.rowCounts,
      result.controlTotals, batchFiles(batch.upload, result.storedFiles), result.sourceValues, report],
  )
}

async function insertFindings(tx: Tx, batchId: string, findings: readonly Finding[]): Promise<void> {
  if (findings.length === 0) return
  await tx.query(
    `INSERT INTO import_row_error (tenant_id, batch_id, file, row_no, column_name, code, detail, created_by)
     SELECT app_tenant_id(), $1, f.file, f.row_no, f.column_name, f.code, f.detail, current_setting('app.user_id')::uuid
     FROM unnest($2::text[], $3::int[], $4::text[], $5::text[], $6::text[]) WITH ORDINALITY
       AS f(file, row_no, column_name, code, detail, n)
     ORDER BY f.n`,
    [batchId, findings.map((f) => `${f.file}.csv`), findings.map((f) => f.rowNo), findings.map((f) => f.column),
      findings.map((f) => f.code), findings.map((f) => f.detail)],
  )
}

async function storeFiles(store: FileStore, batch: NewBatch, files: Readonly<Record<ImportFile, Buffer>>): Promise<void> {
  for (const file of IMPORT_FILES) await store.put(batch.tenantId, batch.batchId, file, files[file])
}

/**
 * API-01 (FR-IMP-001): validates the export before any row is stored, then records the batch as validated
 * (the published columns of each file kept for the load, nothing else) or rejected (findings only; the files are
 * never stored, TRD-05 2.1).
 */
export async function createBatch(tx: Tx, store: FileStore, batch: NewBatch): Promise<StoredResponse> {
  const marketId = await marketIdOf(tx, batch.upload.market, batch.scope)
  const files = Object.fromEntries(IMPORT_FILES.map((file) => [file, batch.upload.files[file].data])) as Record<ImportFile, Buffer>
  const result = validateImport(files, batch.upload.period)
  await insertBatch(tx, batch, marketId, result)
  const audited = { objectType: 'import_batch', objectId: batch.batchId }
  await recordAudit(tx, {
    action: 'IMPORT.UPLOADED', ...audited,
    after: { state: 'uploaded', market_id: marketId, period_from: batch.upload.period.from, period_to: batch.upload.period.to, files: fileDigests(batch.upload) },
  })
  await insertFindings(tx, batch.batchId, result.findings)
  const state: BatchState = result.errorCount === 0 ? 'validated' : 'rejected'
  if (result.storedFiles !== null) await storeFiles(store, batch, result.storedFiles)
  await tx.query('UPDATE import_batch SET state = $2 WHERE id = $1', [batch.batchId, state])
  await recordAudit(tx, {
    action: state === 'validated' ? 'IMPORT.VALIDATED' : 'IMPORT.REJECTED', ...audited,
    before: { state: 'uploaded' }, after: { state, row_counts: result.rowCounts, error_count: result.errorCount },
  })
  return { statusCode: 201, body: envelope(await getBatch(tx, batch.batchId, null)) }
}
