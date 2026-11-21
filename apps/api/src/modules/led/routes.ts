import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, encodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { apiKeyOrSession } from '../iam/index.js'
import { createJournalExport, ENTRY_COLUMNS, entriesCsv, journalExportFile, listJournalExports, setGlMapping } from './exports.js'
import { ACCOUNT_TYPES } from './ledger.js'
import {
  accountPostings, ENTRY_SORTS, entryDetail, glMappings, ledgerSummary, listAccounts, listEntries, listReceivables, payeeBalances,
} from './reads.js'

// API-23/24 (PLAN B4 section 2.1). Reads: ledger.read in the object's market scope; GL mappings and exports:
// ledger.export; export create and download also by an API key with scope ledger:export (all markets).

const id = z.object({ id: z.uuid() })
const accountType = z.enum(ACCOUNT_TYPES)
const marketQuery = z.strictObject({ market_id: z.uuid() })
const accountsQuery = z.strictObject({ ...pageQuery, market_id: z.uuid().optional(), type: accountType.optional(), payee_participant_id: z.uuid().optional() })
const entryFilter = {
  market_id: z.uuid().optional(), period_id: z.uuid().optional(), origin_type: z.enum(['run', 'payout_instruction', 'case', 'migration']).optional(),
  origin_id: z.uuid().optional(), sort: z.enum(ENTRY_SORTS).default('posted_at_desc'),
}
const entriesQuery = z.strictObject({ ...pageQuery, ...entryFilter })
const entriesExportQuery = z.strictObject({
  ...entryFilter,
  columns: z.string().transform((list) => list.split(',')).pipe(z.array(z.enum(ENTRY_COLUMNS)).min(1).refine((c) => new Set(c).size === c.length, 'columns repeat'))
    .default([...ENTRY_COLUMNS]),
})
const receivablesQuery = z.strictObject({ ...pageQuery, market_id: z.uuid().optional() })
const exportsQuery = z.strictObject({ ...pageQuery, market_id: z.uuid().optional(), period_id: z.uuid().optional() })
const mappingParams = z.object({ marketId: z.uuid(), accountType })
// No leading '-': lib/csv would prefix it with an apostrophe (formula guard) and the export would name another account.
const mappingBody = z.strictObject({ gl_code: z.string().regex(/^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,63}$/) })
const exportBody = z.strictObject({ period_id: z.uuid() })
const idCursor = z.uuid()
/** `at` is a timestamptz as PostgreSQL prints it (ISO DateStyle); anything else would reach `::timestamptz` and fail. */
export const timeCursor = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/), id: z.uuid() })
const receivableCursor = z.object({ market_id: z.uuid(), participant_id: z.uuid() })
const entriesCursor = timeCursor.extend({ sort: z.enum(ENTRY_SORTS) })

const read = { preHandler: [requireRealm('tenant'), requirePermission('ledger.read')] }
const manage = { preHandler: [requireRealm('tenant'), requirePermission('ledger.export')] }

const scopeOf = (request: FastifyRequest, permission: Permission) => marketScope(currentAuth(request), permission)
/** A key acts on every market (its minter held ledger.export for all markets). */
const exportScope = (request: FastifyRequest) => (request.apiKey === undefined ? scopeOf(request, 'ledger.export') : null)
/** Time-ordered pages: the cursor is (timestamp text, id) of the last row (plus `extra`); the timestamp text is not shown. */
export function timePage<T extends { at: string; id: string }>(rows: readonly T[], limit: number, extra: Record<string, string> = {}) {
  const page = toPage(rows, limit, (row) => ({ at: row.at, id: row.id, ...extra }))
  return envelope(page.data.map(({ at: _at, ...row }) => row), page.meta)
}

function registerReads(app: FastifyInstance): void {
  app.get('/v1/ledger/summary', read, async (request) => {
    const { market_id: marketId } = parse(marketQuery, request.query)
    return envelope(await inTenant(request, (tx) => ledgerSummary(tx, marketId, scopeOf(request, 'ledger.read'))))
  })

  app.get('/v1/ledger/accounts', read, async (request) => {
    const { cursor, limit, ...filter } = parse(accountsQuery, request.query)
    const rows = await inTenant(request, (tx) => listAccounts(tx, scopeOf(request, 'ledger.read'), filter, decodeCursor(cursor, idCursor), limit))
    return toPage(rows, limit, (row) => row.id)
  })

  app.get('/v1/ledger/accounts/:id/postings', read, async (request) => {
    const { id: accountId } = parse(id, request.params)
    const { cursor, limit } = parse(z.strictObject(pageQuery), request.query)
    const rows = await inTenant(request, (tx) => accountPostings(tx, accountId, scopeOf(request, 'ledger.read'), decodeCursor(cursor, timeCursor), limit))
    return timePage(rows, limit)
  })

  app.get('/v1/ledger/entries', read, async (request) => {
    const { cursor, limit, sort, ...filter } = parse(entriesQuery, request.query)
    const after = decodeCursor(cursor, entriesCursor)
    if (after !== undefined && after.sort !== sort) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'The cursor belongs to another sort: start from the first page.', { path: 'cursor' })
    }
    const rows = await inTenant(request, (tx) => listEntries(tx, scopeOf(request, 'ledger.read'), filter, sort, after, limit))
    return timePage(rows, limit, { sort })
  })

  app.get('/v1/ledger/entries/:id', read, async (request) => {
    const { id: entryId } = parse(id, request.params)
    const { cursor, limit } = parse(z.strictObject(pageQuery), request.query)
    const { entry, nextAfter } = await inTenant(request, (tx) => entryDetail(tx, entryId, scopeOf(request, 'ledger.read'), decodeCursor(cursor, idCursor), limit))
    return envelope(entry, { next_cursor: nextAfter === null ? null : encodeCursor(nextAfter) })
  })

  app.get('/v1/payees/:id/balances', read, async (request) => {
    const { id: participantId } = parse(id, request.params)
    return envelope(await inTenant(request, (tx) => payeeBalances(tx, participantId, scopeOf(request, 'ledger.read'))))
  })

  app.get('/v1/ledger/receivables', read, async (request) => {
    const { cursor, limit, market_id: marketId } = parse(receivablesQuery, request.query)
    const { rows, totalsByBucket } = await inTenant(request, (tx) =>
      listReceivables(tx, scopeOf(request, 'ledger.read'), scopeOf(request, 'case.write_off.read'), marketId, decodeCursor(cursor, receivableCursor), limit))
    const page = toPage(rows, limit, (row) => ({ market_id: row.market.id, participant_id: row.participant.id }))
    return envelope(page.data, { ...page.meta, totals_by_bucket: totalsByBucket })
  })

  app.get('/v1/ledger/gl-mappings', read, async (request) => {
    const { market_id: marketId } = parse(marketQuery, request.query)
    return envelope(await inTenant(request, (tx) => glMappings(tx, marketId, scopeOf(request, 'ledger.read'))))
  })
}

function registerExports(app: FastifyInstance): void {
  const keyOrSession = { config: { apiKey: true }, preHandler: [apiKeyOrSession(app, 'ledger:export', ...manage.preHandler)] }

  app.put('/v1/ledger/gl-mappings/:marketId/:accountType', manage, async (request) => {
    const params = parse(mappingParams, request.params)
    const { gl_code: glCode } = parse(mappingBody, request.body)
    return envelope(await inTenant(request, (tx) => setGlMapping(tx, params.marketId, params.accountType, glCode, scopeOf(request, 'ledger.export'))))
  })

  app.post('/v1/ledger/journal-exports', keyOrSession, async (request, reply) => {
    const { period_id: periodId } = parse(exportBody, request.body)
    const scope = exportScope(request)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const created = await createJournalExport(tx, periodId, scope, app.config.exportRowCap)
      if (created.refused !== undefined) {
        // The refusal is committed with EXPORT.REFUSED, so it is a stored response.
        const details = { row_count: created.refused.rowCount, row_cap: created.refused.rowCap }
        const message = 'The export is larger than the row limit.'
        return { statusCode: 422, body: { error: { code: 'EXPORT_ROW_CAP_EXCEEDED', message, details, request_id: request.id } } }
      }
      return { statusCode: 201, body: envelope(created.view) }
    }))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/ledger/entries/export', manage, async (request, reply) => {
    const { columns, sort, ...filter } = parse(entriesExportQuery, request.query)
    const file = await inTenant(request, (tx) => entriesCsv(tx, scopeOf(request, 'ledger.export'), filter, sort, columns, app.config.exportRowCap))
    reply.header('cache-control', 'no-store')
    if (file.refused !== undefined) {
      return reply.code(422).send({ error: {
        code: 'EXPORT_ROW_CAP_EXCEEDED', message: 'The export is larger than the row limit. Narrow the filters.',
        details: { row_count: file.refused.rowCount, row_cap: file.refused.rowCap }, request_id: request.id,
      } })
    }
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', 'attachment; filename="ledger-entries.csv"')
    return reply.send(file.csv)
  })

  app.get('/v1/ledger/journal-exports', manage, async (request) => {
    const { cursor, limit, ...filter } = parse(exportsQuery, request.query)
    const rows = await inTenant(request, (tx) => listJournalExports(tx, scopeOf(request, 'ledger.export'), filter, decodeCursor(cursor, timeCursor), limit))
    return timePage(rows, limit)
  })

  app.get('/v1/ledger/journal-exports/:id/file', keyOrSession, async (request, reply) => {
    const { id: exportId } = parse(id, request.params)
    const file = await inTenant(request, (tx) => journalExportFile(tx, exportId, exportScope(request)))
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="${file.name}"`)
    return reply.send(file.csv)
  })
}

export function registerLedgerRoutes(app: FastifyInstance): void {
  registerReads(app)
  registerExports(app)
}
