import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAllMarkets, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant, inVendor } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type StoredResponse } from '../../lib/idempotency.js'
import type { ExportDecision } from '../../lib/exports.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { createAuditExport, downloadAuditExport } from './audit-export.js'
import { auditFilterSchema, listAuditEvents } from './events.js'
import { verifyChain } from './verify.js'

const listQuery = auditFilterSchema.extend(pageQuery)
const exportBody = z.strictObject({ filters: auditFilterSchema.default({}) })
const idParams = z.object({ id: z.uuid() })
const seqCursor = z.string().regex(/^\d+$/)

// A refusal is committed (the attempt is audited), so it is a stored response, not a thrown error.
function exportResponse(request: FastifyRequest, decision: ExportDecision): StoredResponse {
  if (!decision.refused) {
    const download = `/v1/audit-exports/${decision.job.id}/download`
    return { statusCode: 201, body: envelope({ ...decision.job, download }) }
  }
  const error = {
    code: 'EXPORT_ROW_CAP_EXCEEDED',
    message: 'The export is larger than the row limit. Narrow the filters, or request a scheduled export.',
    details: { row_count: decision.rowCount, row_cap: decision.rowCap, scheduled_export: 'POST /v1/exports (release B)' },
    request_id: request.id,
  }
  return { statusCode: 422, body: { error } }
}

/** API-09 audit search, FR-AUD-002 audit export, SEC-38 chain verification. */
export function registerAuditRoutes(app: FastifyInstance): void {
  // Audit events carry no market, so a holder limited to some markets would see every market's events.
  const read = { preHandler: [requireRealm('tenant'), requirePermission('audit.read'), requireAllMarkets('audit.read')] }
  const exporting = { preHandler: [...read.preHandler, requirePermission('export'), requireAllMarkets('export')] }

  app.get('/v1/audit-events', read, async (request) => {
    const { cursor, limit, ...filter } = parse(listQuery, request.query)
    const beforeSeq = decodeCursor(cursor, seqCursor)
    const rows = await inTenant(request, (tx) => listAuditEvents(tx, filter, beforeSeq, limit))
    return toPage(rows, limit, (event) => event.seq)
  })

  // BUG-012 (FR-OPS-001, E-ADR-06): the vendor log, for vendor users (console actions and refused vendor access).
  app.get('/v1/vendor-audit-events', { preHandler: [requireRealm('vendor')] }, async (request) => {
    const { cursor, limit, ...filter } = parse(listQuery, request.query)
    const beforeSeq = decodeCursor(cursor, seqCursor)
    const rows = await inVendor(request, (tx) => listAuditEvents(tx, filter, beforeSeq, limit, 'audit.vendor_event'))
    return toPage(rows, limit, (event) => event.seq)
  })

  app.get('/v1/audit-chain/verification', read, async (request) => envelope(await inTenant(request, verifyChain)))

  app.post('/v1/audit-exports', exporting, async (request, reply) => {
    const { filters } = parse(exportBody, request.body)
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => exportResponse(request, await createAuditExport(tx, filters, app.config.exportRowCap))),
    )
    return sendIdempotent(reply, result)
  })

  app.get('/v1/audit-exports/:id/download', exporting, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const file = await inTenant(request, (tx) => downloadAuditExport(tx, id))
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="${file.filename}"`)
    return file.csv
  })
}
