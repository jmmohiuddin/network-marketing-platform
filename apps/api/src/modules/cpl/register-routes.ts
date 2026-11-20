import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { toCsv } from '../../lib/csv.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { recordExport, type ExportDecision } from '../../lib/exports.js'
import { envelope, parse } from '../../lib/http.js'
import { decodeCursor, encodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import {
  assertMarket, delistedCount, delistedRows, delistedRule, delistedView, grievanceCount, grievanceCsvRow, grievancePage, grievanceRows,
  GRIEVANCE_CSV_HEADER, type GrievanceFilter,
} from './registers.js'

// API-30 registers (PLAN B-MKT section 2.3): GET lists and audited CSV exports, market-scoped by the read permission.

const PAGE_MAX = 50
const limit = z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_MAX)
const grievanceFilter = {
  market_id: z.uuid().optional(),
  state: z.enum(['open', 'submitted', 'approved', 'rejected', 'withdrawn']).optional(),
  overdue: z.enum(['ack', 'resolution']).optional(),
  case_id: z.uuid().optional(),
}
const grievanceQuery = z.strictObject({ ...grievanceFilter, cursor: pageQuery.cursor, limit })
const grievanceExportQuery = z.strictObject(grievanceFilter)
const grievanceCursor = z.tuple([z.iso.datetime(), z.uuid()])
const delistedQuery = z.strictObject({ market_id: z.uuid(), cursor: pageQuery.cursor, limit })
const delistedExportQuery = z.strictObject({ market_id: z.uuid() })

const guard = (permission: Permission) => ({ preHandler: [requireRealm('tenant'), requirePermission(permission)] })
const scopeOf = (request: FastifyRequest, permission: Permission) => marketScope(currentAuth(request), permission)

const registerNotEnabled = () => new ApiError(422, 'REGISTER_NOT_ENABLED', 'The market pack keeps no delisted-seller register.')

// A refused export is committed (EXPORT.REFUSED is audited), so it is sent, not thrown.
function sendCsv(request: FastifyRequest, reply: FastifyReply, decision: ExportDecision, csv: () => string, name: string): unknown {
  if (decision.refused) {
    return reply.code(422).send({ error: {
      code: 'EXPORT_ROW_CAP_EXCEEDED', message: 'The export is larger than the row limit. Narrow the filters.',
      details: { row_count: decision.rowCount, row_cap: decision.rowCap }, request_id: request.id,
    } })
  }
  reply.header('content-type', 'text/csv; charset=utf-8')
  reply.header('content-disposition', `attachment; filename="${name}"`)
  reply.header('cache-control', 'no-store')
  return reply.send(csv())
}

function registerGrievanceRegister(app: FastifyInstance): void {
  app.get('/v1/registers/grievances', guard('case.grievance.read'), async (request) => {
    const { cursor, limit: size, ...filter } = parse(grievanceQuery, request.query)
    const after = decodeCursor(cursor, grievanceCursor)
    const scope = scopeOf(request, 'case.grievance.read')
    const rows = await inTenant(request, async (tx) => {
      if (filter.market_id !== undefined) await assertMarket(tx, filter.market_id, scope)
      return grievancePage(tx, filter, scope, after, size)
    })
    return toPage(rows, size, (row) => [row.received_at, row.case_id])
  })

  app.get('/v1/registers/grievances/export', guard('case.grievance.read'), async (request, reply) => {
    const filter: GrievanceFilter = parse(grievanceExportQuery, request.query)
    const scope = scopeOf(request, 'case.grievance.read')
    const { decision, rows } = await inTenant(request, async (tx) => {
      if (filter.market_id !== undefined) await assertMarket(tx, filter.market_id, scope)
      const rowCount = await grievanceCount(tx, filter, scope)
      const recorded = await recordExport(tx, { kind: 'grievance_register', filters: { ...filter }, rowCount, rowCap: app.config.exportRowCap })
      return { decision: recorded, rows: recorded.refused ? [] : await grievanceRows(tx, filter, scope) }
    })
    return sendCsv(request, reply, decision, () => toCsv(GRIEVANCE_CSV_HEADER, rows.map(grievanceCsvRow)), 'grievance-register.csv')
  })
}

function registerDelistedRegister(app: FastifyInstance): void {
  app.get('/v1/registers/delisted', guard('register.read'), async (request) => {
    const { market_id: marketId, cursor, limit: size } = parse(delistedQuery, request.query)
    const after = decodeCursor(cursor, z.uuid())
    const scope = scopeOf(request, 'register.read')
    const { rule, rows } = await inTenant(request, async (tx) => {
      await assertMarket(tx, marketId, scope)
      const found = await delistedRule(tx, marketId)
      if (found === null) throw registerNotEnabled()
      return { rule: found.rule, rows: await delistedRows(tx, marketId, found.today, found.rule, after, size) }
    })
    const page = rows.slice(0, size)
    const last = page.at(-1)
    const nextCursor = rows.length > size && last !== undefined ? encodeCursor(last.participant_id) : null
    return envelope({ rule, rows: page.map((row) => delistedView(row, rule)) }, { next_cursor: nextCursor })
  })

  app.get('/v1/registers/delisted/export', guard('register.read'), async (request, reply) => {
    const { market_id: marketId } = parse(delistedExportQuery, request.query)
    const scope = scopeOf(request, 'register.read')
    const { decision, fields, rows } = await inTenant(request, async (tx) => {
      await assertMarket(tx, marketId, scope)
      const found = await delistedRule(tx, marketId)
      if (found === null) throw registerNotEnabled()
      const rowCount = await delistedCount(tx, marketId, found.today, found.rule)
      const recorded = await recordExport(tx, { kind: 'delisted_register', filters: { market_id: marketId }, rowCount, rowCap: app.config.exportRowCap })
      const rows = recorded.refused ? [] : await delistedRows(tx, marketId, found.today, found.rule, undefined, null)
      return { decision: recorded, fields: found.rule.fields, rows }
    })
    const csv = () => toCsv(fields, rows.map((row) => fields.map((field) => row[field])))
    return sendCsv(request, reply, decision, csv, 'delisted-register.csv')
  })
}

export function registerRegisterRoutes(app: FastifyInstance): void {
  registerGrievanceRegister(app)
  registerDelistedRegister(app)
}
