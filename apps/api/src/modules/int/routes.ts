import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { assertStepUp, requireAllMarkets, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type IdempotentResult } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import {
  allowedUrl, assertTopics, createEndpoint, getEndpoint, listDeliveries, listEndpoints, retryDelivery, rotateSecret,
  sendTest, updateEndpoint, WEBHOOK_URL_MAX, type EndpointView,
} from './endpoints.js'
import { openApiDocument } from './openapi.js'
import { topicCatalogue } from './topics.js'

const idParams = z.object({ id: z.uuid() })
const url = z.string().trim().min(1).max(WEBHOOK_URL_MAX)
const topics = z.array(z.string().min(1).max(100)).min(1).max(20).transform((list) => [...new Set(list)])
const description = z.string().trim().min(1).max(200)
const createBody = z.strictObject({ url, topics, description: description.optional() })
const patchBody = z
  .strictObject({ url: url.optional(), topics: topics.optional(), description: description.nullable().optional(), state: z.enum(['active', 'disabled']).optional() })
  .refine((body) => Object.keys(body).length > 0, { message: 'name at least one field to change' })
const emptyBody = z.strictObject({})
const listQuery = z.strictObject(pageQuery)
const deliveriesQuery = z.strictObject({ ...pageQuery, outcome: z.enum(['scheduled', 'delivered', 'failed', 'dead', 'cancelled']).optional() })
const timeCursor = z.object({ created_at: z.iso.datetime({ offset: true }), id: z.uuid() })
const cursorOf = (row: { created_at: Date; id: string }) => ({ created_at: row.created_at.toISOString(), id: row.id })

/** D-B1-06: the stored (replayable) response never holds the secret; only the first response carries it. */
function sendWithSecret(reply: FastifyReply, result: IdempotentResult, shown: { endpoint: EndpointView; secret: string } | null): unknown {
  if (result.replayed || shown === null) return sendIdempotent(reply, result)
  return sendIdempotent(reply, { ...result, body: envelope({ ...shown, secret_shown: true }) })
}

/**
 * FR-INT-001 (PLAN B1 2.7): the OpenAPI document and webhook endpoint management. integration.manage for all markets:
 * an endpoint receives the events of every market.
 */
export function registerIntRoutes(app: FastifyInstance): void {
  const guard = [requireRealm('tenant'), requirePermission('integration.manage'), requireAllMarkets('integration.manage')]
  const manage = { preHandler: guard }
  const stepUp = { preHandler: [...guard, requireStepUp()] }
  const { secretKey, webhookAllowedPorts: ports } = app.config
  const graceBody = z.strictObject({ grace_minutes: z.number().int().min(0).max(app.config.apiKeyMaxGraceMinutes) })
  const document = openApiDocument()

  app.get('/v1/openapi.json', async () => document)

  app.get('/v1/webhook-topics', manage, async () => envelope(topicCatalogue()))

  app.get('/v1/webhook-endpoints', manage, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, timeCursor)
    const rows = await inTenant(request, (tx) => listEndpoints(tx, after, query.limit))
    return toPage(rows, query.limit, cursorOf)
  })

  app.post('/v1/webhook-endpoints', stepUp, async (request, reply) => {
    const body = parse(createBody, request.body)
    const hookUrl = allowedUrl(body.url, ports)
    assertTopics(body.topics)
    let shown: { endpoint: EndpointView; secret: string } | null = null
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        shown = await createEndpoint(tx, secretKey, { url: hookUrl, topics: body.topics, description: body.description ?? null })
        return { statusCode: 201, body: envelope({ endpoint: shown.endpoint, secret_shown: false }) }
      }),
    )
    return sendWithSecret(reply, result, shown)
  })

  app.get('/v1/webhook-endpoints/:id', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => getEndpoint(tx, id)))
  })

  app.patch('/v1/webhook-endpoints/:id', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(patchBody, request.body)
    // Where signed events go is decided with step-up, as on create: a new URL or (re-)enabling.
    if (body.url !== undefined || body.state === 'active') assertStepUp(request)
    const change = body.url === undefined ? body : { ...body, url: allowedUrl(body.url, ports) }
    if (body.topics !== undefined) assertTopics(body.topics)
    return envelope(await inTenant(request, (tx) => updateEndpoint(tx, id, change)))
  })

  app.post('/v1/webhook-endpoints/:id/rotate-secret', stepUp, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const { grace_minutes: graceMinutes } = parse(graceBody, request.body)
    let shown: { endpoint: EndpointView; secret: string } | null = null
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        shown = await rotateSecret(tx, secretKey, id, graceMinutes)
        return { statusCode: 200, body: envelope({ endpoint: shown.endpoint, secret_shown: false }) }
      }),
    )
    return sendWithSecret(reply, result, shown)
  })

  app.post('/v1/webhook-endpoints/:id/test', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    parse(emptyBody, request.body ?? {})
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 202, body: envelope({ event_id: await sendTest(tx, id) }) })),
    )
    return sendIdempotent(reply, result)
  })

  app.get('/v1/webhook-endpoints/:id/deliveries', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const query = parse(deliveriesQuery, request.query)
    const after = decodeCursor(query.cursor, timeCursor)
    const rows = await inTenant(request, (tx) => listDeliveries(tx, id, query.outcome, after, query.limit))
    return toPage(rows, query.limit, cursorOf)
  })

  app.post('/v1/webhook-deliveries/:id/retry', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    parse(emptyBody, request.body ?? {})
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await retryDelivery(tx, id)) })),
    )
    return sendIdempotent(reply, result)
  })
}
