import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { recordExport, type ExportDecision } from '../../lib/exports.js'
import { decimalOf, marketInScope, type MarketRow } from './ledger.js'
import { countEntries, listEntries, type EntryFilter, type EntrySort } from './reads.js'

// D-B4-19 GL export: one period's postings of one market aggregated by (gl_code, account type, origin), instruction
// entries rolled up to their batch; a gzip CSV stored with its sha256 and verified on every download.

type Scope = readonly string[] | null

const COMMITTED = ['committed', 'paid', 'closed']
const CSV_HEADER = ['export_id', 'period_start', 'period_end', 'market', 'currency', 'gl_code', 'account_type', 'origin_type', 'origin_id', 'debit', 'credit']

/** PUT /v1/ledger/gl-mappings/:marketId/:accountType: 404 unknown market, 403 SCOPE_NOT_HELD outside the caller's scope. */
export async function setGlMapping(tx: Tx, marketId: string, accountType: string, glCode: string, scope: Scope) {
  await marketInScope(tx, marketId, null)
  if (scope !== null && !scope.includes(marketId)) throw new ApiError(403, 'SCOPE_NOT_HELD', 'You do not manage the ledger of this market.')
  const { rows: before } = await tx.query<{ gl_code: string }>(
    'SELECT gl_code FROM gl_account_map WHERE market_id = $1 AND account_type = $2 FOR UPDATE', [marketId, accountType])
  const { rows } = await tx.query<{ account_type: string; gl_code: string; updated_by: string; updated_at: Date }>(
    `INSERT INTO gl_account_map (tenant_id, market_id, account_type, gl_code, updated_by)
     VALUES (app_tenant_id(), $1, $2, $3, app_user_id())
     ON CONFLICT (tenant_id, market_id, account_type) DO UPDATE SET gl_code = EXCLUDED.gl_code, updated_by = app_user_id(), updated_at = now()
     RETURNING account_type, gl_code, updated_by, updated_at`,
    [marketId, accountType, glCode],
  )
  await recordAudit(tx, {
    action: 'LEDGER.GL_MAPPING_SET', objectType: 'gl_account_map', objectId: marketId,
    before: before[0] === undefined ? null : { market_id: marketId, account_type: accountType, gl_code: before[0].gl_code },
    after: { market_id: marketId, account_type: accountType, gl_code: glCode },
  })
  return rows[0]!
}

interface ExportRow {
  readonly id: string
  readonly market_id: string
  readonly market_code: string
  readonly period_id: string
  readonly starts_at: Date
  readonly ends_at: Date
  readonly line_count: number
  readonly debit_total_minor: string
  readonly credit_total_minor: string
  readonly content_sha256: string
  readonly created_by: string
  readonly created_by_type: string
  readonly created_at: Date
  readonly created_at_close: boolean
  readonly at: string
}

const EXPORT_SELECT = `
  SELECT j.id, j.market_id, m.code AS market_code, j.period_id, p.starts_at, p.ends_at, j.line_count, j.debit_total_minor::text,
         j.credit_total_minor::text, encode(j.content_sha256, 'hex') AS content_sha256, j.created_by, j.created_by_type, j.created_at,
         EXISTS (SELECT 1 FROM period cp WHERE cp.close_journal_export_id = j.id) AS created_at_close, j.created_at::text AS at
  FROM journal_export j JOIN market m ON m.id = j.market_id JOIN period p ON p.id = j.period_id`

export const exportView = (e: ExportRow) => ({
  id: e.id, market: { id: e.market_id, code: e.market_code }, period: { id: e.period_id, starts_at: e.starts_at, ends_at: e.ends_at },
  line_count: e.line_count, debit_total_minor: e.debit_total_minor, credit_total_minor: e.credit_total_minor, content_sha256: e.content_sha256,
  created_by: { id: e.created_by, type: e.created_by_type }, created_at: e.created_at, created_at_close: e.created_at_close,
})

interface Aggregate {
  readonly gl_code: string | null
  readonly account_type: string
  readonly origin_type: string
  readonly origin_id: string
  readonly debit_minor: string
  readonly credit_minor: string
}

async function aggregate(tx: Tx, periodId: string): Promise<Aggregate[]> {
  const { rows } = await tx.query<Aggregate>(
    `SELECT g.gl_code, a.type AS account_type,
            CASE WHEN e.origin_type = 'payout_instruction' THEN 'payout_batch' ELSE e.origin_type END AS origin_type,
            coalesce(i.batch_id, e.origin_id) AS origin_id, sum(x.debit_minor)::text AS debit_minor, sum(x.credit_minor)::text AS credit_minor
     FROM journal_entry e JOIN posting x ON x.entry_id = e.id JOIN ledger_account a ON a.id = x.account_id
     LEFT JOIN payout_instruction i ON e.origin_type = 'payout_instruction' AND i.id = e.origin_id
     LEFT JOIN gl_account_map g ON g.market_id = e.market_id AND g.account_type = a.type
     WHERE e.period_id = $1
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`,
    [periodId],
  )
  return rows
}

/** Account types with postings in the period and no GL code in its market (what createJournalExport would refuse). */
export async function unmappedAccountTypes(tx: Tx, periodId: string): Promise<string[]> {
  const { rows } = await tx.query<{ type: string }>(
    `SELECT DISTINCT a.type FROM journal_entry e JOIN posting x ON x.entry_id = e.id JOIN ledger_account a ON a.id = x.account_id
     WHERE e.period_id = $1 AND NOT EXISTS (SELECT 1 FROM gl_account_map g WHERE g.market_id = e.market_id AND g.account_type = a.type)
     ORDER BY 1`,
    [periodId],
  )
  return rows.map((row) => row.type)
}

export type CreatedExport = { readonly refused: Extract<ExportDecision, { refused: true }> } | { readonly refused?: never; readonly view: ReturnType<typeof exportView> }

/** POST /v1/ledger/journal-exports: refusals before anything is recorded, except the row cap (EXPORT.REFUSED commits). */
export async function createJournalExport(tx: Tx, periodId: string, scope: Scope, rowCap: number): Promise<CreatedExport> {
  const { rows: periods } = await tx.query<{ market_id: string; state: string; starts_at: Date; ends_at: Date }>(
    'SELECT c.market_id, p.state, p.starts_at, p.ends_at FROM period p JOIN calendar c ON c.id = p.calendar_id WHERE p.id = $1', [periodId])
  const period = periods[0]
  if (period === undefined || (scope !== null && !scope.includes(period.market_id))) throw notFound()
  if (!COMMITTED.includes(period.state)) throw new ApiError(409, 'PERIOD_NOT_COMMITTED', 'Only a committed period is exported.', { state: period.state })
  const rows = await aggregate(tx, periodId)
  if (rows.length === 0) throw new ApiError(422, 'NOTHING_TO_EXPORT', 'The period has no ledger entries.')
  const unmapped = [...new Set(rows.filter((r) => r.gl_code === null).map((r) => r.account_type))].sort()
  if (unmapped.length > 0) throw new ApiError(422, 'GL_MAPPING_MISSING', 'Map every account type to a GL code first.', { account_types: unmapped })
  const debit = rows.reduce((sum, r) => sum + BigInt(r.debit_minor), 0n)
  const credit = rows.reduce((sum, r) => sum + BigInt(r.credit_minor), 0n)
  if (debit !== credit) throw new ApiError(500, 'EXPORT_UNBALANCED', 'The period\'s postings do not balance; nothing was exported.')
  const decision = await recordExport(tx, { kind: 'gl_journal', filters: { period_id: periodId, market_id: period.market_id }, rowCount: rows.length, rowCap })
  if (decision.refused) return { refused: decision }
  const market = await marketInScope(tx, period.market_id, null)
  const id = randomUUID()
  const csv = journalCsv(id, market, period, rows)
  const content = gzipSync(csv)
  await tx.query(
    `INSERT INTO journal_export (id, tenant_id, market_id, period_id, export_job_id, content, content_sha256, line_count, debit_total_minor,
       credit_total_minor)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $8)`,
    [id, market.id, periodId, decision.job.id, content, createHash('sha256').update(content).digest(), rows.length, debit.toString()],
  )
  await recordAudit(tx, {
    action: 'JOURNAL_EXPORT.CREATED', objectType: 'journal_export', objectId: id,
    after: { export_job_id: decision.job.id, period_id: periodId, line_count: rows.length, debit_total_minor: debit.toString() },
  })
  const { rows: created } = await tx.query<ExportRow>(`${EXPORT_SELECT} WHERE j.id = $1`, [id])
  return { view: exportView(created[0]!) }
}

function journalCsv(id: string, market: MarketRow, period: { starts_at: Date; ends_at: Date }, rows: readonly Aggregate[]): string {
  return toCsv(CSV_HEADER, rows.map((r) => [
    id, period.starts_at, period.ends_at, market.code, market.currency, r.gl_code, r.account_type, r.origin_type, r.origin_id,
    decimalOf(r.debit_minor, market.minor_digits), decimalOf(r.credit_minor, market.minor_digits),
  ]))
}

export interface ExportFilter {
  readonly market_id?: string | undefined
  readonly period_id?: string | undefined
}

/** GET /v1/ledger/journal-exports, newest first. */
export async function listJournalExports(tx: Tx, scope: Scope, filter: ExportFilter, after: { at: string; id: string } | undefined, limit: number) {
  const { rows } = await tx.query<ExportRow>(
    `${EXPORT_SELECT}
     WHERE ($1::uuid[] IS NULL OR j.market_id = ANY ($1)) AND ($2::uuid IS NULL OR j.market_id = $2) AND ($3::uuid IS NULL OR j.period_id = $3)
       AND ($4::timestamptz IS NULL OR (j.created_at, j.id) < ($4, $5::uuid))
     ORDER BY j.created_at DESC, j.id DESC LIMIT $6`,
    [scope, filter.market_id ?? null, filter.period_id ?? null, after?.at ?? null, after?.id ?? null, limit + 1],
  )
  return rows.map((row) => ({ ...exportView(row), at: row.at }))
}

/** GET /v1/ledger/journal-exports/:id/file: the CSV after the stored hash checks out (else 500 EXPORT_CORRUPT). */
export async function journalExportFile(tx: Tx, id: string, scope: Scope): Promise<{ name: string; csv: Buffer }> {
  const { rows } = await tx.query<{ market_id: string; code: string; starts_on: string; content: Buffer; intact: boolean }>(
    `SELECT j.market_id, m.code, to_char(p.starts_at AT TIME ZONE m.time_zone, 'YYYY-MM-DD') AS starts_on, j.content,
            digest(j.content, 'sha256') = j.content_sha256 AS intact
     FROM journal_export j JOIN market m ON m.id = j.market_id JOIN period p ON p.id = j.period_id WHERE j.id = $1`,
    [id],
  )
  const file = rows[0]
  if (file === undefined || (scope !== null && !scope.includes(file.market_id))) throw notFound()
  if (!file.intact) throw new ApiError(500, 'EXPORT_CORRUPT', 'The stored export does not match its checksum.')
  await recordAudit(tx, { action: 'EXPORT.DOWNLOADED', objectType: 'journal_export', objectId: id, after: { journal_export_id: id } })
  return { name: `gl-${file.code}-${file.starts_on}-${id}.csv`, csv: gunzipSync(file.content) }
}

/** D-B6-08 ledger entries export columns (the RPT saved-view registry names the same keys). */
export const ENTRY_COLUMNS = ['posted_at', 'entry_id', 'market', 'period', 'event_type', 'origin_type', 'origin_id', 'debit_total', 'credit_total', 'approval_id'] as const
export type EntryColumn = (typeof ENTRY_COLUMNS)[number]
type EntryListRow = Awaited<ReturnType<typeof listEntries>>[number]
const ENTRY_CELL: { readonly [C in EntryColumn]: (r: EntryListRow) => unknown } = {
  posted_at: (r) => r.posted_at, entry_id: (r) => r.id, market: (r) => r.market.code, period: (r) => r.period.id, event_type: (r) => r.event_type,
  origin_type: (r) => r.origin_type, origin_id: (r) => r.origin_id, debit_total: (r) => decimalOf(r.debit_total_minor, r.market.minor_digits),
  credit_total: (r) => decimalOf(r.credit_total_minor, r.market.minor_digits), approval_id: (r) => r.approval_id,
}

/**
 * GET /v1/ledger/entries/export: every entry of the list's filter in its sort as CSV, capped and audited by recordExport
 * (the refusal is committed with EXPORT.REFUSED, so it is returned, not thrown).
 */
export async function entriesCsv(
  tx: Tx, scope: Scope, filter: EntryFilter, sort: EntrySort, columns: readonly EntryColumn[], rowCap: number,
): Promise<{ refused: Extract<ExportDecision, { refused: true }> } | { refused?: never; csv: string }> {
  const rows = await listEntries(tx, scope, filter, sort, undefined, rowCap) // at most rowCap + 1: enough to know the cap is passed
  const rowCount = rows.length > rowCap ? await countEntries(tx, scope, filter) : rows.length
  const decision = await recordExport(tx, { kind: 'ledger_entries', filters: { ...filter, sort, columns }, rowCount, rowCap })
  if (decision.refused) return { refused: decision }
  return { csv: toCsv(columns, rows.map((r) => columns.map((c) => ENTRY_CELL[c](r)))) }
}
