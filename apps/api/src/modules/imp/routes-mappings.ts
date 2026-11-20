import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertAllMarkets, currentAuth, hasPermission, requireAllMarkets, requireAnyPermission, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { MAPPING_READERS } from './access.js'
import { approveMapping, createMappingVersion, getMapping, latestMappingVersion, listMappings, mappingsSchema } from './mappings.js'
import { IMPORT_KINDS } from './vocabulary.js'

const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({ ...pageQuery, kind: z.enum(IMPORT_KINDS).optional() })
const putBody = z.strictObject({
  kind: z.enum(IMPORT_KINDS).default('overlay'), mappings: mappingsSchema, notes: z.string().trim().min(1).max(2000).optional(),
})
const approveBody = z.strictObject({ reason: z.string().trim().min(1).max(500).optional() })
const IF_MATCH = /^(?:W\/)?"?(\d{1,9})"?$/

const READ = { preHandler: [requireRealm('tenant'), requireAnyPermission(...MAPPING_READERS)] }

function expectedVersion(request: FastifyRequest): number {
  const header = request.headers['if-match']
  if (header === undefined) {
    throw new ApiError(428, 'PRECONDITION_REQUIRED', 'Send If-Match with the latest mapping version you saw ("0" for none).')
  }
  const match = IF_MATCH.exec(header)
  if (match === null) throw new ApiError(400, 'VALIDATION_FAILED', 'If-Match must be a version number.')
  return Number(match[1])
}

function registerReads(app: FastifyInstance): void {
  app.get('/v1/import-mappings', READ, async (request, reply) => {
    const query = parse(listQuery, request.query)
    const before = decodeCursor(query.cursor, z.number().int().positive())
    const { rows, latest } = await inTenant(request, async (tx) => ({
      rows: await listMappings(tx, query.kind, before, query.limit),
      // The ETag is the latest version of the listed kind (overlay when unfiltered: the default kind of a save).
      latest: await latestMappingVersion(tx, query.kind ?? 'overlay'),
    }))
    reply.header('etag', `"${latest}"`)
    const page = toPage(rows, query.limit, (row) => row.version)
    return envelope(page.data, { ...page.meta, latest_version: latest })
  })

  app.get('/v1/import-mappings/:id', READ, async (request) => {
    const { id } = parse(idParams, request.params)
    const mapping = await inTenant(request, (tx) => getMapping(tx, id))
    if (mapping === null) throw notFound()
    return envelope(mapping)
  })
}

function registerWrites(app: FastifyInstance): void {
  // API-03: saving creates the next version as a draft; If-Match carries the latest version of its kind the client saw.
  app.put(
    '/v1/import-mappings',
    // One mapping serves every market's imports, so editing and approving it need all markets.
    { preHandler: [requireRealm('tenant'), requirePermission('mapping.edit'), requireAllMarkets('mapping.edit')] },
    async (request, reply) => {
      const version = expectedVersion(request)
      const body = parse(putBody, request.body)
      // D-B6-09: a migration mapping is drafted by whoever runs the migration, over every market as any mapping.
      if (body.kind === 'migration') {
        if (!hasPermission(currentAuth(request), 'migration.manage')) throw permissionDenied()
        assertAllMarkets(currentAuth(request), 'migration.manage')
      }
      const draft = { kind: body.kind, mappings: body.mappings, notes: body.notes ?? null, expectedVersion: version }
      const created = await inTenant(request, (tx) => createMappingVersion(tx, draft))
      reply.code(201).header('etag', `"${created.version}"`)
      return envelope(created)
    },
  )

  app.post(
    '/v1/import-mappings/:id/approve',
    { preHandler: [requireRealm('tenant'), requirePermission('mapping.approve'), requireAllMarkets('mapping.approve'), requireStepUp()] },
    async (request) => {
      const { id } = parse(idParams, request.params)
      const body = parse(approveBody, request.body ?? {})
      const auth = currentAuth(request)
      const approval = { userId: auth.userId, stepUpAt: auth.stepUpAt, reason: body.reason ?? null }
      return envelope(await inTenant(request, (tx) => approveMapping(tx, id, approval)))
    },
  )
}

/** API-03 (FR-IMP-002): versioned mapping of partner codes; drafted with mapping.edit, approved by someone else. */
export function registerMappingRoutes(app: FastifyInstance): void {
  registerReads(app)
  registerWrites(app)
}
