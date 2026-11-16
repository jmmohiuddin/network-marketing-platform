import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requireRealm, type AuthContext } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { caseTypesOf } from '../cas/index.js'
import type { DocumentStore } from './document-store.js'
import { canUploadEvidence, insertDocument, readableDocument } from './documents.js'
import { contentDisposition, EVIDENCE_TYPES, readEvidenceFile } from './evidence-file.js'

const idParams = z.object({ id: z.uuid() })
const TENANT = { preHandler: [requireRealm('tenant')] }

type TenantAuth = AuthContext & { readonly tenantId: string }

function tenantAuth(request: FastifyRequest): TenantAuth {
  const auth = currentAuth(request)
  if (auth.tenantId === null) throw new ApiError(403, 'REALM_FORBIDDEN', 'This endpoint is not available to your account type.')
  return { ...auth, tenantId: auth.tenantId }
}

function uploader(request: FastifyRequest): TenantAuth {
  const auth = tenantAuth(request)
  if (!canUploadEvidence(auth, caseTypesOf(request.server))) throw permissionDenied()
  return auth
}

/** Evidence documents (PLAN B1 section 2.8, D-B1-04): uploaded once, referenced by id, read through their references. */
export function registerDocumentRoutes(app: FastifyInstance, store: DocumentStore): void {
  const maxFileBytes = app.config.evidenceMaxFileBytes

  app.get('/v1/documents/limits', TENANT, async (request) => {
    uploader(request)
    return envelope({ max_file_bytes: maxFileBytes, types: EVIDENCE_TYPES })
  })

  app.post('/v1/documents', TENANT, async (request, reply) => {
    const { tenantId } = uploader(request)
    const file = await readEvidenceFile(request, maxFileBytes)
    // The Idempotency-Key's request hash covers request.body: the class, the file name and the content digest.
    request.body = { class: 'evidence', file_name: file.fileName, sha256: file.sha256 }
    const id = randomUUID()
    try {
      const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
        const document = await insertDocument(tx, id, file)
        await recordAudit(tx, {
          action: 'DOCUMENT.UPLOADED', objectType: 'document', objectId: id,
          after: { mime: file.mime, size_bytes: file.data.length, sha256: file.sha256 },
        })
        await store.put(tenantId, id, file.data) // last: a failed write rolls the row back
        return { statusCode: 201, body: envelope(document) }
      }))
      return sendIdempotent(reply, result)
    } catch (error) {
      // The file is written just before commit; a rolled-back upload must not leave it behind.
      await store.remove(tenantId, id).catch((cleanup: unknown) => {
        request.log.error({ err: cleanup, documentId: id }, 'removing the file of a failed upload failed')
      })
      throw error
    }
  })

  app.get('/v1/documents/:id', TENANT, async (request) => {
    const { id } = parse(idParams, request.params)
    const auth = currentAuth(request)
    const document = await inTenant(request, (tx) => readableDocument(tx, auth, id, caseTypesOf(request.server)))
    if (document === null) throw notFound()
    return envelope(document)
  })

  app.get('/v1/documents/:id/content', TENANT, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const auth = tenantAuth(request)
    const { document, data } = await inTenant(request, async (tx) => {
      const readable = await readableDocument(tx, auth, id, caseTypesOf(request.server))
      if (readable === null) throw notFound()
      const bytes = await store.get(auth.tenantId, id)
      await recordAudit(tx, { action: 'DOCUMENT.DOWNLOADED', objectType: 'document', objectId: id })
      return { document: readable, data: bytes }
    })
    reply.header('content-type', document.mime)
    reply.header('content-disposition', contentDisposition(document.file_name ?? 'document'))
    reply.header('x-content-type-options', 'nosniff')
    return data
  })
}
