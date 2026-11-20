import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAllMarkets, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { recordAudit } from '../../lib/audit.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { apiKeyOrSession } from '../iam/index.js'
import { modelView } from './export-model.js'
import { recoverAbandoned, requestExport, signingKeyView } from './full-export.js'

// API-32 (PLAN B6 2.3): full exports are tenant-wide, so a session needs export.full for all markets (D-B6-14); a key
// needs scope exports:full (its minter held export.full for all markets).

const idParams = z.object({ id: z.uuid() })
const fileParams = z.object({ id: z.uuid(), table: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/) })
const listQuery = z.strictObject(pageQuery)
const timeCursor = z.object({ created_at: z.iso.datetime(), id: z.uuid() })

interface ExportRow {
  id: string
  trigger: string
  state: string
  model_version: number
  snapshot_at: Date | null
  table_count: number | null
  total_rows: number | null
  created_at: Date
  finished_at: Date | null
  requested_by: string | null
  requested_by_type: string
  error_code: string | null
}

const SELECT = `
  SELECT d.id, d.trigger, d.state, d.model_version, d.snapshot_at, jsonb_array_length(d.manifest -> 'tables') AS table_count,
         (SELECT sum((t ->> 'rows')::bigint)::float8 FROM jsonb_array_elements(d.manifest -> 'tables') t) AS total_rows,
         d.created_at, d.finished_at, d.requested_by, d.requested_by_type, d.error ->> 'code' AS error_code
  FROM data_export d`

const view = ({ requested_by: by, requested_by_type: type, error_code: code, ...row }: ExportRow) => ({
  ...row, requested_by: by === null ? null : { id: by, type }, error: code === null ? null : { code },
})

async function exportDetail(tx: Tx, id: string) {
  const { rows } = await tx.query<ExportRow & { manifest: unknown; signature: Buffer | null }>(
    `SELECT q.*, d.manifest, d.signature FROM (${SELECT} WHERE d.id = $1) q JOIN data_export d ON d.id = q.id`, [id])
  const row = rows[0]
  if (row === undefined) throw notFound()
  const { manifest, signature, ...rest } = row
  return { ...view(rest), manifest, signature: signature?.toString('base64') ?? null }
}

/** The stored gzip after its digest checks out (500 EXPORT_CORRUPT otherwise); only a completed export has files. */
async function exportFile(tx: Tx, id: string, table: string): Promise<Buffer> {
  const { rows } = await tx.query<{ content: Buffer; intact: boolean }>(
    `SELECT f.content, digest(f.content, 'sha256') = f.content_sha256 AS intact
     FROM data_export_file f JOIN data_export d ON d.id = f.export_id
     WHERE f.export_id = $1 AND f.table_name = $2 AND d.state = 'completed'`,
    [id, table],
  )
  const file = rows[0]
  if (file === undefined) throw notFound()
  if (!file.intact) throw new ApiError(500, 'EXPORT_CORRUPT', 'The stored export file does not match its checksum.')
  await recordAudit(tx, { action: 'EXPORT.DOWNLOADED', objectType: 'data_export', objectId: id, after: { export_id: id, table } })
  return file.content
}

export function registerExportRoutes(app: FastifyInstance): void {
  const session = [requireRealm('tenant'), requirePermission('export.full'), requireAllMarkets('export.full')]
  const read = { config: { apiKey: true }, preHandler: [apiKeyOrSession(app, 'exports:full', ...session)] }
  const create = { config: { apiKey: true }, preHandler: [apiKeyOrSession(app, 'exports:full', ...session, requireStepUp())] }

  app.get('/v1/exports/model', read, async (request) => envelope(await inTenant(request, modelView)))

  app.get('/v1/exports/signing-key', read, async (request) => {
    const tenantId = await inTenant(request, async (tx) => (await tx.query<{ id: string }>('SELECT app_tenant_id() AS id')).rows[0]!.id)
    return envelope(signingKeyView(app.config.secretKey, tenantId))
  })

  app.post('/v1/exports', create, async (request, reply) => {
    parse(z.strictObject({}), request.body ?? {})
    await recoverAbandoned((fn) => inTenant(request, fn), app.config.mailDir)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 202, body: envelope(await requestExport(tx, 'manual')),
    })))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/exports', read, async (request) => {
    const { cursor, limit } = parse(listQuery, request.query)
    const after = decodeCursor(cursor, timeCursor)
    const { rows } = await inTenant(request, (tx) => tx.query<ExportRow>(
      `${SELECT} WHERE ($1::timestamptz IS NULL OR (date_trunc('milliseconds', d.created_at), d.id) < ($1, $2::uuid))
       ORDER BY date_trunc('milliseconds', d.created_at) DESC, d.id DESC LIMIT $3`,
      [after?.created_at ?? null, after?.id ?? null, limit + 1],
    ))
    return toPage(rows.map(view), limit, (row) => ({ created_at: row.created_at.toISOString(), id: row.id }))
  })

  app.get('/v1/exports/:id', read, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => exportDetail(tx, id)))
  })

  app.get('/v1/exports/:id/files/:table', read, async (request, reply) => {
    const { id, table } = parse(fileParams, request.params)
    const content = await inTenant(request, (tx) => exportFile(tx, id, table))
    reply.header('content-type', 'application/gzip')
    reply.header('content-disposition', `attachment; filename="${table}.jsonl.gz"`)
    reply.header('cache-control', 'no-store')
    return reply.send(content)
  })
}
