import type { Tx } from '@nmp/db'
import type { ImportWarning } from './findings.js'
import type { ControlTotals, RowCounts, SourceValues } from './validate.js'

export const BATCH_STATES = ['uploaded', 'rejected', 'validated', 'mapped', 'loaded', 'superseded'] as const
export type BatchState = (typeof BATCH_STATES)[number]

/** Markets the caller may act on (marketScope, AC-36.2): null = every market of the tenant. */
export type MarketScope = readonly string[] | null

export interface BatchReport {
  readonly error_count: number
  readonly errors_stored: number
  readonly warnings: readonly ImportWarning[]
}

/** FR-IMP-003 data-quality report, set at load. Counts only; shares are left to the reader. */
export interface DataQuality {
  readonly orders: number
  readonly orders_unknown_purpose: number
  readonly refunded_orders: number
  readonly refunds_without_month: number
  readonly payout_lines: number
  readonly payout_lines_without_source_order: number
  readonly payout_lines_unknown_source_kind: number
  /** Partner codes the mapping did not name, loaded as 'unknown'. */
  readonly unmapped: { readonly purposes: readonly string[]; readonly source_kinds: readonly string[] }
}

/** Per file: the upload's sha256 and size; stored_sha256 is the stored projection's digest (validated batches). */
export interface FileDigest {
  readonly sha256: string
  readonly size_bytes: number
  readonly stored_sha256?: string
}

export interface BatchView {
  id: string
  market_id: string
  market: string
  kind: string
  /** YYYY-MM */
  period_from: string
  /** YYYY-MM */
  period_to: string
  state: BatchState
  mapping_id: string | null
  mapping_version: number | null
  superseded_by: string | null
  uploaded_by: string
  created_at: Date
  row_counts: RowCounts | null
  control_totals: ControlTotals | null
  files: Record<string, FileDigest> | null
  report: BatchReport | null
  data_quality: DataQuality | null
}

const VIEW = `
  SELECT b.id, b.market_id, m.code AS market, b.kind, to_char(b.period_from, 'YYYY-MM') AS period_from,
         to_char(b.period_to, 'YYYY-MM') AS period_to, b.state, b.mapping_id, im.version AS mapping_version,
         b.superseded_by, b.uploaded_by, b.created_at, b.row_counts, b.control_totals, b.files, b.report, b.data_quality
  FROM import_batch b
  JOIN market m ON m.tenant_id = b.tenant_id AND m.id = b.market_id
  LEFT JOIN import_mapping im ON im.tenant_id = b.tenant_id AND im.id = b.mapping_id`

const inScope = (param: number): string => `($${param}::uuid[] IS NULL OR b.market_id = ANY($${param}::uuid[]))`

/** One batch, if it exists in the caller's tenant (RLS) and market scope. */
export async function getBatch(tx: Tx, id: string, scope: MarketScope): Promise<BatchView | null> {
  const { rows } = await tx.query<BatchView>(`${VIEW} WHERE b.id = $1 AND ${inScope(2)}`, [id, scope])
  return rows[0] ?? null
}

/** Newest first. The cursor is the id of the last batch shown. */
export async function listBatches(
  tx: Tx, scope: MarketScope, state: BatchState | undefined, afterId: string | undefined, limit: number,
): Promise<BatchView[]> {
  const { rows } = await tx.query<BatchView>(
    `${VIEW}
     WHERE ${inScope(1)} AND ($2::text IS NULL OR b.state = $2)
       AND ($3::uuid IS NULL OR (b.created_at, b.id) < (SELECT created_at, id FROM import_batch WHERE id = $3))
     ORDER BY b.created_at DESC, b.id DESC LIMIT $4`,
    [scope, state ?? null, afterId ?? null, limit + 1],
  )
  return rows
}

export interface FindingView {
  seq: string
  file: string
  row_no: number | null
  column_name: string | null
  code: string
  detail: string | null
}

/** Validation findings of a batch in the order they were found; the cursor is the seq of the last one shown. */
export async function listFindings(tx: Tx, batchId: string, afterSeq: string | undefined, limit: number): Promise<FindingView[]> {
  const { rows } = await tx.query<FindingView>(
    `SELECT seq, file, row_no, column_name, code, detail FROM import_row_error
     WHERE batch_id = $1 AND ($2::bigint IS NULL OR seq > $2) ORDER BY seq LIMIT $3`,
    [batchId, afterSeq ?? null, limit + 1],
  )
  return rows
}

export interface LockedBatch {
  id: string
  market_id: string
  state: BatchState
  mapping_id: string | null
  period_from: string
  period_to: string
  files: Record<string, FileDigest> | null
  row_counts: RowCounts | null
  control_totals: ControlTotals | null
  source_values: SourceValues | null
}

/** The batch row locked for a state change (period as YYYY-MM). */
export async function lockBatch(tx: Tx, id: string, scope: MarketScope): Promise<LockedBatch | null> {
  const { rows } = await tx.query<LockedBatch>(
    `SELECT b.id, b.market_id, b.state, b.mapping_id, to_char(b.period_from, 'YYYY-MM') AS period_from,
            to_char(b.period_to, 'YYYY-MM') AS period_to, b.files, b.row_counts, b.control_totals, b.source_values
     FROM import_batch b WHERE b.id = $1 AND ${inScope(2)} FOR UPDATE`,
    [id, scope],
  )
  return rows[0] ?? null
}

const LOAD_LOCK_KEY = `hashtextextended('imp.load:' || app_tenant_id() || ':' || $1, 0)`

/** Serialises the loads of one market (loadBatch) until the caller's transaction ends. */
export async function lockLoads(tx: Tx, marketId: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(${LOAD_LOCK_KEY})`, [marketId])
}

/**
 * Facade for compliance snapshots (API-04 409 INPUTS_CHANGING): false while a load of the market is running.
 * Otherwise the caller holds the load lock until its transaction ends, so no load of the market starts first.
 */
export async function tryLockLoads(tx: Tx, marketId: string): Promise<boolean> {
  const { rows } = await tx.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock(${LOAD_LOCK_KEY}) AS locked`, [marketId])
  return rows[0]!.locked
}

/** Facade for compliance snapshot views (SC-10, US-24): the FR-IMP-003 data-quality report of each batch, any state. */
export async function batchDataQuality(tx: Tx, ids: readonly string[]): Promise<{ batch_id: string; data_quality: DataQuality | null }[]> {
  const { rows } = await tx.query<{ batch_id: string; data_quality: DataQuality | null }>(
    'SELECT id AS batch_id, data_quality FROM import_batch WHERE id = ANY ($1::uuid[]) ORDER BY id',
    [ids],
  )
  return rows
}

export interface LoadedBatch {
  readonly id: string
  readonly mappingId: string
  readonly mappingVersion: number
  /** YYYY-MM-DD, first day of the first month */
  readonly periodFrom: string
  /** YYYY-MM-DD, last day of the last month */
  readonly periodTo: string
}

/**
 * Facade for compliance snapshots (BR-IMP-03, FR-CPL-006): the batches in force (state 'loaded') for a
 * market whose period overlaps [from, to] (dates YYYY-MM-DD), with the mapping version each was loaded with.
 */
export async function loadedBatches(tx: Tx, marketId: string, from: string, to: string): Promise<LoadedBatch[]> {
  const { rows } = await tx.query<LoadedBatch>(
    `SELECT b.id, b.mapping_id AS "mappingId", im.version AS "mappingVersion",
            to_char(b.period_from, 'YYYY-MM-DD') AS "periodFrom", to_char(b.period_to, 'YYYY-MM-DD') AS "periodTo"
     FROM import_batch b JOIN import_mapping im ON im.tenant_id = b.tenant_id AND im.id = b.mapping_id
     WHERE b.state = 'loaded' AND b.market_id = $1
       AND daterange(b.period_from, b.period_to, '[]') && daterange($2::date, $3::date, '[]')
     ORDER BY b.period_from, b.id`,
    [marketId, from, to],
  )
  return rows
}
