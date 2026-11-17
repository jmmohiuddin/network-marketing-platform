import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope } from '../../lib/http.js'
import type { StoredResponse } from '../../lib/idempotency.js'
import { eventInput, orderInput, receive, recordRejected, Refusal, type IngestContext, type Submission } from '../ord/index.js'
import { connectorForWebhook, markConnectorOk } from '../pay/index.js'
import { getMarket, getSetting } from '../ten/index.js'
import type { Mapped } from './mapping.js'
import { mapShopify } from './shopify.js'
import { mapWooCommerce } from './woocommerce.js'

const MAX_BODY_BYTES = 1024 * 1024
const idParams = z.object({ id: z.uuid() })

const SIGNATURE_HEADER = { shopify: 'x-shopify-hmac-sha256', woocommerce: 'x-wc-webhook-signature' } as const
const TOPIC_HEADER = { shopify: 'x-shopify-topic', woocommerce: 'x-wc-webhook-topic' } as const

/** Base64 HMAC-SHA256 of the raw body under the connector secret, compared in constant time. */
export function signatureValid(secret: string, raw: Buffer, header: unknown): boolean {
  if (typeof header !== 'string') return false
  const expected = createHmac('sha256', secret).update(raw).digest()
  const given = Buffer.from(header, 'base64')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const header = (request: FastifyRequest, name: string): string => {
  const value = request.headers[name]
  return typeof value === 'string' ? value : ''
}

interface Delivery {
  readonly connectorId: string
  readonly mapped: Mapped
  readonly raw: Buffer
}

const accepted = (statusCode = 200, extra: Record<string, unknown> = {}): StoredResponse => ({ statusCode, body: envelope({ accepted: true, ...extra }) })

/** Ingests a mapped delivery. Refusals are persisted and still answered 200: the store must not retry a refused body. */
async function deliver(tx: Tx, delivery: Delivery, ctx: IngestContext): Promise<StoredResponse> {
  const { mapped, connectorId } = delivery
  const source = `connector:${connectorId}`
  if (mapped.kind === 'ignored') return accepted(200, { ignored: true })
  const reject = async (key: string, code: string, message: string) => {
    const rawHash = createHash('sha256').update(delivery.raw).digest()
    await recordRejected(tx, { source, key, hash: rawHash, refusal: new Refusal(422, code, message) }, ctx.requestId)
    return accepted()
  }
  if (mapped.kind === 'rejected') return reject(mapped.key, mapped.code, mapped.message)
  const submission = parseSubmission(mapped, source)
  if (submission === null) {
    const ref = mapped.kind === 'order' ? mapped.input.source_order_id : mapped.input.source_event_id
    return reject(`${mapped.kind}:${String(mapped.input.source_system)}:${String(ref)}`, 'PAYLOAD_INVALID', 'The store payload does not map to a valid order or event.')
  }
  const response = await receive(tx, submission, ctx)
  if (response.statusCode === 202) return { statusCode: 202, body: envelope({ accepted: true, held: (response.body as { data: { held: unknown } }).data.held }) }
  if (response.statusCode < 300) await markConnectorOk(tx, connectorId)
  return accepted()
}

/** A signed body of an order or refund topic that is not one: refused under a key of its topic and body (still 200). */
function unmappable(topic: string, raw: Buffer): Mapped {
  const key = `payload:${topic.slice(0, 64)}:${createHash('sha256').update(raw).digest('hex')}`
  return { kind: 'rejected', key, code: 'PAYLOAD_INVALID', message: 'The store payload is not an order or refund of this store.' }
}

function parseSubmission(mapped: Mapped & { kind: 'order' | 'event' }, source: string): Submission | null {
  if (mapped.kind === 'order') {
    const parsed = orderInput.safeParse(mapped.input)
    return parsed.success ? { kind: 'order', source, input: parsed.data } : null
  }
  const parsed = eventInput.safeParse(mapped.input)
  return parsed.success ? { kind: 'event', source, input: parsed.data } : null
}

async function handle(app: FastifyInstance, request: FastifyRequest): Promise<StoredResponse> {
  const params = idParams.safeParse(request.params)
  const connector = params.success ? await connectorForWebhook(app.config.secretKey, params.data.id) : null
  if (!params.success || connector === null) throw notFound()
  const raw = request.body
  if (!Buffer.isBuffer(raw) || !signatureValid(connector.secret, raw, request.headers[SIGNATURE_HEADER[connector.provider]])) {
    throw new ApiError(401, 'SIGNATURE_INVALID', 'The webhook signature does not match.')
  }
  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new ApiError(400, 'MALFORMED_REQUEST', 'The webhook body is not JSON.')
  }
  const topic = header(request, TOPIC_HEADER[connector.provider])
  const ctx: IngestContext = { requestId: request.id, toleranceSeconds: app.config.orderFutureToleranceSeconds }
  // The store is the actor: a system transaction in the connector's tenant (D-B2-14).
  const actor = { actorType: 'system' as const, requestId: request.id, supportSessionId: null }
  return runInTenant({ tenantId: connector.tenantId, userId: SYSTEM_ACTOR_ID }, actor, async (tx) => {
    const market = (await getMarket(tx, connector.marketId))!
    const mapping = {
      connectorId: params.data.id, marketCode: market.code, minorUnit: market.minor_unit,
      creditingEvent: await getSetting(tx, 'orders.crediting_event'),
    }
    const mapped = (connector.provider === 'shopify' ? mapShopify(topic, body, mapping) : mapWooCommerce(topic, body, mapping)) ?? unmappable(topic, raw)
    return deliver(tx, { connectorId: params.data.id, mapped, raw }, ctx)
  })
}

/**
 * POST /v1/connectors/:id/webhooks (FR-ORD-002): public, authenticated by the HMAC over the raw body (no session, no
 * CSRF header). Registered in its own scope so JSON arrives as raw bytes for the signature.
 */
export function registerConnectorWebhook(app: FastifyInstance): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES }, (_request, body, done) => done(null, body))
    scope.post('/v1/connectors/:id/webhooks', { config: { signedWebhook: true } }, async (request, reply) => {
      const result = await handle(app, request)
      reply.code(result.statusCode)
      return result.body
    })
  })
}
