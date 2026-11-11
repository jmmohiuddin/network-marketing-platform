import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, hasPermission, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { batchDataQuality } from '../imp/index.js'
import { drillPage, drillTarget, exportDrillRows, type DrillExport } from './drill.js'
import { readResults } from './figures.js'
import { FIGURES_NOTICE, intersectScopes, REPORT_CODES, snapshotView } from './snapshot-row.js'
import { createSnapshot, findSnapshot, listSnapshots } from './snapshots.js'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a month as YYYY-MM')
const createBody = z
  .strictObject({
    market: z.string().trim().min(1).max(32),
    period_from: month,
    period_to: month,
    reports: z.array(z.enum(REPORT_CODES)).min(1).max(REPORT_CODES.length).default([...REPORT_CODES]),
  })
  .refine((body) => body.period_from <= body.period_to, { message: 'must not be before period_from', path: ['period_to'] })
const idParams = z.object({ id: z.uuid() })
const rowsParams = z.object({ id: z.uuid(), figure: z.string().min(1).max(300) })
const listQuery = z.strictObject(pageQuery)
const rowsQuery = z.strictObject({
  ...pageQuery,
  set: z.enum(['numerator', 'denominator']).default('numerator'),
  export: z.enum(['true', 'false']).default('false'),
})
const snapshotCursor = z.uuid()
const rowCursor = z.string().min(1).max(300)

// A refusal is committed (EXPORT.REFUSED is audited), so it is sent, not thrown.
function sendDrillExport(request: FastifyRequest, reply: FastifyReply, file: DrillExport): unknown {
  if (file.refused !== null) {
    const error = {
      code: 'EXPORT_ROW_CAP_EXCEEDED',
      message: 'The export is larger than the row limit. Request a scheduled export instead.',
      details: { row_count: file.refused.rowCount, row_cap: file.refused.rowCap, scheduled_export: 'POST /v1/exports (release B)' },
      request_id: request.id,
    }
    return reply.code(422).send({ error })
  }
  reply.header('content-type', 'text/csv; charset=utf-8')
  reply.header('content-disposition', `attachment; filename="${file.filename}"`)
  return reply.send(file.csv)
}

/** API-04, API-05 (+ list) and API-06: compliance report snapshots and figure drill-down (FR-CPL-001..006). */
export function registerComplianceRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission('compliance.read')] }
  const create = { preHandler: [requireRealm('tenant'), requirePermission('snapshot.create')] }

  app.post('/v1/compliance/snapshots', create, async (request, reply) => {
    const body = parse(createBody, request.body)
    const scope = marketScope(currentAuth(request), 'snapshot.create')
    const reports = REPORT_CODES.filter((code) => body.reports.includes(code))
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        const snapshot = await createSnapshot(tx, {
          market: body.market, periodFrom: body.period_from, periodTo: body.period_to, reports, scope,
        })
        return { statusCode: 202, body: envelope(snapshotView(snapshot)) }
      }),
    )
    return sendIdempotent(reply, result)
  })

  app.get('/v1/compliance/snapshots', read, async (request) => {
    const { cursor, limit } = parse(listQuery, request.query)
    const afterId = decodeCursor(cursor, snapshotCursor)
    const scope = marketScope(currentAuth(request), 'compliance.read')
    const snapshots = await inTenant(request, (tx) => listSnapshots(tx, scope, afterId, limit))
    return toPage(snapshots.map(snapshotView), limit, (snapshot) => snapshot.id)
  })

  app.get('/v1/compliance/snapshots/:id', read, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'compliance.read')
    const view = await inTenant(request, async (tx) => {
      const snapshot = await findSnapshot(tx, id, scope)
      // SC-10 / US-24: the data-quality warnings of the input batches are shown beside the figures.
      const quality = await batchDataQuality(tx, snapshot.inputs.batch_ids)
      return { ...snapshotView(snapshot), input_data_quality: quality, results: await readResults(tx, snapshot.id) }
    })
    return envelope(view, { notice: FIGURES_NOTICE })
  })

  app.get('/v1/compliance/snapshots/:id/figures/:figure/rows', read, async (request, reply) => {
    const { id, figure } = parse(rowsParams, request.params)
    const query = parse(rowsQuery, request.query)
    const auth = currentAuth(request)
    const scope = marketScope(auth, 'compliance.read')
    if (query.export === 'true') {
      if (!hasPermission(auth, 'export')) throw permissionDenied()
      // Each grant applies to its own markets (SEC-26): the snapshot must be in reach of both permissions.
      const exportScope = intersectScopes(scope, marketScope(auth, 'export'))
      const file = await inTenant(request, async (tx) =>
        exportDrillRows(tx, await drillTarget(tx, id, figure, exportScope), app.config.exportRowCap, auth.userId),
      )
      return sendDrillExport(request, reply, file)
    }
    const after = decodeCursor(query.cursor, rowCursor)
    return inTenant(request, async (tx) => drillPage(await drillTarget(tx, id, figure, scope), query.set, after, query.limit))
  })
}
