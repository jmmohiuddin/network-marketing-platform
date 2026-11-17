import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { z } from 'zod'
import { currentAuth, requireAllMarkets, requireAnyPermission, requirePermission, requireRealm, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { apiKeyOrSession } from '../iam/index.js'
import { receive, retryHeld, type IngestContext, type Submission } from './inbound.js'
import { eventBody, orderBody } from './schemas.js'
import { listInbound } from './views.js'

const idParams = z.object({ id: z.uuid() })
const emptyBody = z.strictObject({})
const inboundQuery = z.strictObject({
  ...pageQuery, state: z.enum(['held', 'processed', 'rejected']).optional(), source: z.string().min(1).max(110).optional(),
})
const inboundCursor = z.object({ received_at: z.iso.datetime({ offset: true }), id: z.uuid() })

/** API-10/11 take API keys only (key scope orders:write): a signed-in user is refused, no session at all is 401. */
const keyRequired: preHandlerAsyncHookHandler = async (request) => {
  currentAuth(request)
  throw new ApiError(403, 'API_KEY_REQUIRED', 'This endpoint accepts API keys with the scope orders:write only.')
}

/** FR-ORD-001/004 ingestion routes and the exception queue (held and rejected inbound events). */
export function registerIngestRoutes(app: FastifyInstance): void {
  const keyOnly = { preHandler: [apiKeyOrSession(app, 'orders:write', keyRequired)], config: { apiKey: true } }
  const context = (request: FastifyRequest): IngestContext => ({ requestId: request.id, toleranceSeconds: app.config.orderFutureToleranceSeconds })
  const ingest = (request: FastifyRequest, submission: Submission) =>
    inTenant(request, (tx) => idempotent(tx, request, () => receive(tx, submission, context(request))))

  app.post('/v1/orders', keyOnly, async (request, reply) => {
    const { attribution, ...body } = parse(orderBody, request.body)
    const input = { ...body, buyer: { ...body.buyer, auto_create: true }, ...(attribution === undefined ? {} : { attribution: [attribution] }) }
    return sendIdempotent(reply, await ingest(request, { kind: 'order', source: `api:${body.source_system}`, input }))
  })

  app.post('/v1/order-events', keyOnly, async (request, reply) => {
    const input = parse(eventBody, request.body)
    return sendIdempotent(reply, await ingest(request, { kind: 'event', source: `api:${input.source_system}`, input }))
  })

  // Inbound events carry no market: the exception queue is for all-markets holders only (as the Integrations screen).
  const allMarketsOfAny: preHandlerAsyncHookHandler = async (request) => {
    if (scopeOfAny(currentAuth(request), ['order.read', 'product.manage']) !== null) {
      throw new ApiError(403, 'SCOPE_NOT_HELD', 'Inbound events span every market, so they need the permission for all markets.')
    }
  }
  const readers = { preHandler: [requireRealm('tenant'), requireAnyPermission('order.read', 'product.manage'), allMarketsOfAny] }
  app.get('/v1/inbound-events', readers, async (request) => {
    const query = parse(inboundQuery, request.query)
    const after = decodeCursor(query.cursor, inboundCursor)
    const rows = await inTenant(request, (tx) => listInbound(tx, query, after, query.limit))
    return toPage(rows, query.limit, (row) => ({ received_at: (row.received_at as Date).toISOString(), id: row.id }))
  })

  // No Idempotency-Key: the held row is locked and must still be held, so a repeated retry is 409 NOT_HELD.
  const retry = { preHandler: [requireRealm('tenant'), requirePermission('product.manage'), requireAllMarkets('product.manage')] }
  app.post('/v1/inbound-events/:id/retry', retry, async (request) => {
    const { id } = parse(idParams, request.params)
    parse(emptyBody, request.body ?? {})
    const outcome = await inTenant(request, (tx) => retryHeld(tx, id, context(request)))
    if (outcome === null) throw notFound()
    return envelope(outcome)
  })
}
