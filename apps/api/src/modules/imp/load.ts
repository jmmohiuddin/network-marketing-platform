import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { getSetting } from '../ten/index.js'
import { getBatch, lockBatch, lockLoads, type BatchView, type DataQuality, type LockedBatch, type BatchScope } from './batches.js'
import { insertFacts, reconcile } from './facts.js'
import type { FileStore } from './file-store.js'
import { mappingsSchema, resolveMapping, type Mappings } from './mappings.js'
import { sha256Hex } from './upload.js'
import { validateImport, type ImportRows } from './validate.js'
import { IMPORT_FILES, type ImportFile } from './vocabulary.js'

const audited = (id: string) => ({ objectType: 'import_batch', objectId: id })

async function lockedBatchOrFail(tx: Tx, id: string, scope: BatchScope, allowed: readonly string[]): Promise<LockedBatch> {
  const batch = await lockBatch(tx, id, scope)
  if (batch === null) throw notFound()
  if (!allowed.includes(batch.state)) {
    throw new ApiError(409, 'IMPORT_STATE_CONFLICT', `The batch is ${batch.state}; this step needs it ${allowed.join(' or ')}.`, {
      state: batch.state,
    })
  }
  return batch
}

async function approvedMapping(tx: Tx, mappingId: string, batch: LockedBatch): Promise<{ version: number; mappings: Mappings }> {
  const { rows } = await tx.query<{ version: number; state: string; kind: string; mappings: unknown }>(
    'SELECT version, state, kind, mappings FROM import_mapping WHERE id = $1',
    [mappingId],
  )
  const mapping = rows[0]
  if (mapping === undefined) throw new ApiError(422, 'MAPPING_UNKNOWN', 'No mapping version with this id exists.')
  if (mapping.kind !== batch.kind) throw new ApiError(422, 'MAPPING_KIND', `A ${batch.kind} batch uses a ${batch.kind} mapping.`, { kind: mapping.kind })
  if (mapping.state !== 'approved') throw new ApiError(422, 'MAPPING_NOT_APPROVED', 'Only an approved mapping version can be used.')
  return { version: mapping.version, mappings: mappingsSchema.parse(mapping.mappings) }
}

/**
 * Participant types have no safe default (BR-PTY-01 flags) and a starter-kit code outside the published 0/1 has no
 * meaning, so each must be mapped. details lists the uncovered codes per vocabulary.
 */
function assertCovers(batch: LockedBatch, mappings: Mappings): void {
  const resolved = resolveMapping(mappings)
  const values = batch.source_values
  const missing = {
    participant_types: Object.keys(values?.participant_types ?? {}).filter((code) => resolved.participantFlags(code) === undefined),
    starter_kits: Object.keys(values?.starter_kits ?? {}).filter((code) => resolved.starterKit(code) === undefined),
  }
  const details = Object.fromEntries(Object.entries(missing).filter(([, codes]) => codes.length > 0))
  if (Object.keys(details).length > 0) {
    throw new ApiError(422, 'MAPPING_INCOMPLETE', 'The mapping does not cover every participant type and starter-kit code of the batch.', details)
  }
}

/** validated | mapped -> mapped (FR-IMP-003): attaches an approved mapping version to the batch. */
export async function attachMapping(tx: Tx, batchId: string, mappingId: string, scope: BatchScope): Promise<BatchView> {
  const batch = await lockedBatchOrFail(tx, batchId, scope, ['validated', 'mapped'])
  const mapping = await approvedMapping(tx, mappingId, batch)
  assertCovers(batch, mapping.mappings)
  await tx.query(`UPDATE import_batch SET state = 'mapped', mapping_id = $2 WHERE id = $1`, [batchId, mappingId])
  await recordAudit(tx, {
    action: 'IMPORT.MAPPED', ...audited(batchId),
    before: { state: batch.state, mapping_id: batch.mapping_id },
    after: { state: 'mapped', mapping_id: mappingId, mapping_version: mapping.version },
  })
  return (await getBatch(tx, batchId, null))!
}

/** Reads the stored files back, checks they are the bytes that were validated, and parses them again. */
async function storedRows(store: FileStore, tenantId: string, batch: LockedBatch): Promise<ImportRows> {
  const files = {} as Record<ImportFile, Buffer>
  for (const file of IMPORT_FILES) {
    const data = await store.get(tenantId, batch.id, file)
    if (sha256Hex(data) !== batch.files?.[file]?.stored_sha256) {
      throw new Error(`import batch ${batch.id}: stored ${file}.csv differs from the validated upload`)
    }
    files[file] = data
  }
  const result = validateImport(files, { from: batch.period_from, to: batch.period_to }, batch.kind)
  if (result.rows === null) throw new Error(`import batch ${batch.id}: stored files no longer validate`)
  return result.rows
}

/**
 * BR-IMP-04: loaded batches of the market and kind whose period lies within this batch's period are superseded, never
 * deleted. A loaded batch that overlaps but reaches outside it would take its other months out of force, so the
 * load is refused (409 IMPORT_PERIOD_OVERLAP) and nothing changes.
 */
async function supersedeCovered(tx: Tx, batch: LockedBatch): Promise<string[]> {
  const { rows } = await tx.query<{ id: string; covered: boolean }>(
    `SELECT b.id, (b.period_from >= n.period_from AND b.period_to <= n.period_to) AS covered
     FROM import_batch b JOIN import_batch n ON n.id = $1
     WHERE b.market_id = n.market_id AND b.kind = n.kind AND b.state = 'loaded' AND b.id <> n.id
       AND b.period_from <= n.period_to AND b.period_to >= n.period_from
     ORDER BY b.id FOR UPDATE OF b`,
    [batch.id],
  )
  // D-B6-09: a migration batch that a draft or applied migration names stays loaded (apply writes its facts and
  // cannot be undone); the row lock above serialises this with createMigration's FOR UPDATE of the batch.
  const { rows: named } = await tx.query<{ id: string }>(
    "SELECT id FROM migration WHERE state <> 'cancelled' AND import_batch_id = ANY($1::uuid[]) ORDER BY id LIMIT 1", [rows.map((row) => row.id)])
  if (named[0] !== undefined) {
    throw new ApiError(409, 'MIGRATION_EXISTS', 'A migration names a loaded batch of these months. Cancel that migration first.', { migration_id: named[0].id })
  }
  const partial = rows.filter((row) => !row.covered).map((row) => row.id)
  if (partial.length > 0) {
    throw new ApiError(409, 'IMPORT_PERIOD_OVERLAP',
      'A loaded batch of this market also covers months outside this batch. Load a batch covering all of its months.', { batch_ids: partial })
  }
  const ids = rows.map((row) => row.id)
  if (ids.length > 0) {
    await tx.query(`UPDATE import_batch SET state = 'superseded', superseded_by = $1 WHERE id = ANY($2::uuid[])`, [batch.id, ids])
  }
  for (const id of ids) {
    await recordAudit(tx, { action: 'IMPORT.SUPERSEDED', ...audited(id), before: { state: 'loaded' }, after: { state: 'superseded', superseded_by: batch.id } })
  }
  return ids
}

function unmappedCodes(batch: LockedBatch, mappings: Mappings): DataQuality['unmapped'] {
  const missing = (codes: Readonly<Record<string, number>> | undefined, mapped: Readonly<Record<string, unknown>>) =>
    Object.keys(codes ?? {}).filter((code) => !Object.hasOwn(mapped, code))
  const values = batch.source_values
  return { purposes: missing(values?.purposes, mappings.purposes), source_kinds: missing(values?.source_kinds, mappings.source_kinds) }
}

export interface LoadResult {
  readonly batch: BatchView
  readonly superseded: readonly string[]
}

/**
 * mapped -> loaded (FR-IMP-003): facts written in this one transaction, control totals reconciled, earlier loads
 * within the period superseded (supersedeCovered). Refused without a breach contact (AC-53.1, MVP_A C-21). Loads
 * of one market are serialised so two overlapping batches cannot both stay loaded. tenant.region is locked by the
 * database from the first load on (tenant_region_guard, 0004).
 */
export async function loadBatch(tx: Tx, store: FileStore, tenantId: string, batchId: string, scope: BatchScope): Promise<LoadResult> {
  const batch = await lockedBatchOrFail(tx, batchId, scope, ['mapped'])
  await lockLoads(tx, batch.market_id)
  if ((await getSetting(tx, 'privacy.breach_contacts')) === null) {
    throw new ApiError(422, 'BREACH_CONTACT_REQUIRED', 'Record at least one breach-notification contact before the first data load.')
  }
  const mapping = await approvedMapping(tx, batch.mapping_id!, batch)
  assertCovers(batch, mapping.mappings)
  const superseded = await supersedeCovered(tx, batch)
  const rows = await storedRows(store, tenantId, batch)
  await insertFacts(tx, batch.id, batch.market_id, rows, resolveMapping(mapping.mappings))
  const quality = await reconcile(tx, batch.id, { rowCounts: batch.row_counts!, controlTotals: batch.control_totals! })
  const dataQuality: DataQuality = { ...quality, unmapped: unmappedCodes(batch, mapping.mappings) }
  await tx.query(`UPDATE import_batch SET state = 'loaded', data_quality = $2 WHERE id = $1`, [batch.id, dataQuality])
  await recordAudit(tx, {
    action: 'IMPORT.LOADED', ...audited(batch.id),
    before: { state: 'mapped' }, after: { state: 'loaded', mapping_version: mapping.version, row_counts: batch.row_counts, superseded },
  })
  return { batch: (await getBatch(tx, batch.id, null))!, superseded }
}
