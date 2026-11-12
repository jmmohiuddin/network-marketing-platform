import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { MAPPING_READERS, requireAnyPermission, scopeForAny, tenantOf } from './access.js'
import { BATCH_STATES, getBatch, listBatches, listFindings, type MarketScope } from './batches.js'
import { createBatch } from './create-batch.js'
import type { FileStore } from './file-store.js'
import { inImportSlot } from './import-gate.js'
import { attachMapping, loadBatch } from './load.js'
import { idempotencyMaterial, readUpload } from './upload.js'

export interface ImportRouteDeps {
  readonly store: FileStore
  readonly maxFileBytes: number
}

const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({ ...pageQuery, state: z.enum(BATCH_STATES).optional() })
const findingsQuery = z.strictObject(pageQuery)
const attachBody = z.strictObject({ mapping_id: z.uuid() })

const MANAGE = { preHandler: [requireRealm('tenant'), requirePermission('import.manage')] }
const READ_VALUES = { preHandler: [requireRealm('tenant'), requireAnyPermission(MAPPING_READERS)] }

const importScope = (request: FastifyRequest): MarketScope => scopeForAny(request, ['import.manage'])
const batchId = (request: FastifyRequest): string => parse(idParams, request.params).id

function registerUpload(app: FastifyInstance, deps: ImportRouteDeps): void {
  app.post('/v1/imports', MANAGE, (request, reply) => inImportSlot(reply, async () => {
    const upload = await readUpload(request, deps.maxFileBytes)
    // The Idempotency-Key's request hash covers request.body: the form fields and the file digests.
    request.body = idempotencyMaterial(upload)
    const batch = { batchId: randomUUID(), tenantId: tenantOf(request), upload, scope: importScope(request) }
    try {
      const result = await inTenant(request, (tx) => idempotent(tx, request, () => createBatch(tx, deps.store, batch)))
      return sendIdempotent(reply, result)
    } catch (error) {
      // Files are written just before commit; a rolled-back upload must not leave them behind.
      await deps.store.removeBatch(batch.tenantId, batch.batchId).catch((cleanup: unknown) => {
        request.log.error({ err: cleanup, batchId: batch.batchId }, 'removing the files of a failed upload failed')
      })
      throw error
    }
  }))
}

function registerReads(app: FastifyInstance, deps: ImportRouteDeps): void {
  // The upload form's file size limit (a larger file gets 413 FILE_TOO_LARGE).
  app.get('/v1/imports/limits', MANAGE, async () => envelope({ max_file_bytes: deps.maxFileBytes }))

  app.get('/v1/imports', MANAGE, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const rows = await inTenant(request, (tx) => listBatches(tx, importScope(request), query.state, after, query.limit))
    return toPage(rows, query.limit, (row) => row.id)
  })

  app.get('/v1/imports/:id', MANAGE, async (request) => {
    const batch = await inTenant(request, (tx) => getBatch(tx, batchId(request), importScope(request)))
    if (batch === null) throw notFound()
    return envelope(batch)
  })

  app.get('/v1/imports/:id/errors', MANAGE, async (request) => {
    const id = batchId(request)
    const query = parse(findingsQuery, request.query)
    const after = decodeCursor(query.cursor, z.string().regex(/^\d{1,19}$/))
    const rows = await inTenant(request, async (tx) => {
      if ((await getBatch(tx, id, importScope(request))) === null) throw notFound()
      return listFindings(tx, id, after, query.limit)
    })
    return toPage(rows, query.limit, (row) => row.seq)
  })

  app.get('/v1/imports/:id/source-values', READ_VALUES, async (request) => {
    const id = batchId(request)
    const values = await inTenant(request, async (tx) => {
      const { rows } = await tx.query<{ state: string; source_values: unknown }>(
        `SELECT state, source_values FROM import_batch
         WHERE id = $1 AND ($2::uuid[] IS NULL OR market_id = ANY($2::uuid[]))`,
        [id, scopeForAny(request, MAPPING_READERS)],
      )
      return rows[0]
    })
    if (values === undefined) throw notFound()
    return envelope({ batch_id: id, state: values.state, source_values: values.source_values })
  })
}

function registerTransitions(app: FastifyInstance, deps: ImportRouteDeps): void {
  app.post('/v1/imports/:id/mapping', MANAGE, async (request) => {
    const id = batchId(request)
    const body = parse(attachBody, request.body)
    return envelope(await inTenant(request, (tx) => attachMapping(tx, id, body.mapping_id, importScope(request))))
  })

  app.post('/v1/imports/:id/load', MANAGE, (request, reply) => inImportSlot(reply, async () => {
    const id = batchId(request)
    const tenantId = tenantOf(request)
    const loaded = await inTenant(request, (tx) => loadBatch(tx, deps.store, tenantId, id, importScope(request)))
    return envelope(loaded.batch, { superseded: loaded.superseded })
  }))
}

/** API-01, API-02 and the batch lifecycle steps (FR-IMP-001, FR-IMP-003); all need import.manage. */
export function registerImportRoutes(app: FastifyInstance, deps: ImportRouteDeps): void {
  registerUpload(app, deps)
  registerReads(app, deps)
  registerTransitions(app, deps)
}
