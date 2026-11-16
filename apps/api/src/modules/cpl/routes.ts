import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, hasPermission, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { apiKeyOrSession } from '../iam/index.js'
import { batchDataQuality } from '../imp/index.js'
import { drillPage, drillTarget, exportDrillRows, type DrillExport } from './drill.js'
import { readResults } from './figures.js'
import { packRules, screeningMandatory } from './pack-rules.js'
import { publicSnapshotSchemas } from './public-schemas.js'
import { FIGURES_NOTICE, intersectScopes, REPORT_CODES, snapshotView, type MarketScope } from './snapshot-row.js'
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
const packParams = z.object({ pack: z.string().min(1).max(64) })
// Postgres has no year 0: '0000-01-01'::date fails.
const packQuery = z.strictObject({ on: z.iso.date().refine((value) => !value.startsWith('0000'), 'must be in year 0001 or later').optional() })
const rowsQuery = z.strictObject({
  ...pageQuery,
  set: z.enum(['numerator', 'denominator']).default('numerator'),
  export: z.enum(['true', 'false']).default('false'),
})
const snapshotCursor = z.uuid()
const rowCursor = z.string().min(1).max(300)

function requireAnyPermission(...permissions: Permission[]): preHandlerAsyncHookHandler {
  return async (request) => {
    const auth = currentAuth(request)
    if (!permissions.some((permission) => hasPermission(auth, permission))) throw permissionDenied()
  }
}

/** A key caller sees every market of its tenant (RLS still isolates tenants); a session caller its compliance.read markets. */
function readScope(request: FastifyRequest): MarketScope {
  return request.apiKey === undefined ? marketScope(currentAuth(request), 'compliance.read') : null
}

/** D-B1-19: every read by an API key is attributed to its service account in the read's own transaction. */
async function auditKeyRead(tx: Tx, request: FastifyRequest, count: number): Promise<void> {
  const key = request.apiKey
  if (key === undefined) return
  await recordAudit(tx, {
    action: 'API_KEY.READ', objectType: 'api_key', objectId: key.keyId,
    after: { key_id: key.keyId, scope: 'compliance:read', route: `${request.method} ${request.routeOptions.url}`, count },
  })
}

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

/**
 * FR-CPL-012: the rules of a market pack with their basis status, for whoever prepares, signs off or reads compliance.
 * meta.screening_mandatory counts the mandatory rules still at screening (go-live then needs a risk acceptance).
 */
export function registerPackRuleRoutes(app: FastifyInstance): void {
  const guard = { preHandler: [requireRealm('tenant'), requireAnyPermission('market.manage', 'market.signoff', 'compliance.read')] }
  app.get('/v1/market-packs/:pack/rules', guard, async (request) => {
    const { pack } = parse(packParams, request.params)
    const on = parse(packQuery, request.query).on ?? new Date().toISOString().slice(0, 'YYYY-MM-DD'.length)
    const rules = await inTenant(request, (tx) => packRules(tx, pack, on))
    return envelope(rules, { on, screening_mandatory: screeningMandatory(rules) })
  })
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

  // Open to API keys with scope compliance:read (AC-22.3); responses go through the published schemas.
  const keyRead = { config: { apiKey: true }, preHandler: [apiKeyOrSession(app, 'compliance:read', ...read.preHandler)] }
  const { listQuery, listItem, detail } = publicSnapshotSchemas

  app.get('/v1/compliance/snapshots', keyRead, async (request) => {
    const { cursor, limit } = parse(listQuery, request.query)
    const afterId = decodeCursor(cursor, snapshotCursor)
    const scope = readScope(request)
    const snapshots = await inTenant(request, async (tx) => {
      const rows = await listSnapshots(tx, scope, afterId, limit)
      await auditKeyRead(tx, request, Math.min(rows.length, limit))
      return rows
    })
    return toPage(snapshots.map((snapshot) => listItem.parse(snapshotView(snapshot))), limit, (snapshot) => snapshot.id)
  })

  app.get('/v1/compliance/snapshots/:id', keyRead, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = readScope(request)
    const view = await inTenant(request, async (tx) => {
      const snapshot = await findSnapshot(tx, id, scope)
      // SC-10 / US-24: the data-quality warnings of the input batches are shown beside the figures.
      const quality = await batchDataQuality(tx, snapshot.inputs.batch_ids)
      const results = await readResults(tx, snapshot.id)
      await auditKeyRead(tx, request, 1)
      return { ...snapshotView(snapshot), input_data_quality: quality, results }
    })
    return envelope(detail.parse(view), { notice: FIGURES_NOTICE })
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
