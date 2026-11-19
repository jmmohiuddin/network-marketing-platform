import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { providerForWebhook, receiveProviderWebhook } from '../pay/index.js'
import { signatureValid } from './webhook-inbound.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_AGE_SECONDS = 300
const params = z.object({ providerConfigId: z.uuid() })

const headerText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** X-Sandbox-Timestamp (Unix seconds) within five minutes of now, either way. */
const fresh = (timestamp: string): boolean => /^\d{1,12}$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= MAX_AGE_SECONDS

/**
 * POST /v1/webhooks/providers/:providerConfigId (API-26, D-B4-15): signed sandbox payout events. Public, authenticated
 * by X-Sandbox-Signature = base64 HMAC-SHA256 of `<X-Sandbox-Event-Id>.<X-Sandbox-Timestamp>.<raw body>` under the
 * provider's sealed secret, so a captured body is not replayed under a new event id or after five minutes;
 * deduplicated by X-Sandbox-Event-Id. Its own scope so JSON arrives as raw bytes; the API-wide limiter counts it per IP.
 * shortcut: the secret is typed by a Tenant admin (sandbox only), take it from the provider when real adapters exist.
 */
export function registerProviderWebhook(app: FastifyInstance): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES }, (_request, body, done) => done(null, body))
    scope.post('/v1/webhooks/providers/:providerConfigId', { config: { signedWebhook: true } }, async (request, reply) => {
      const parsed = params.safeParse(request.params)
      const provider = parsed.success ? await providerForWebhook(app.config.secretKey, parsed.data.providerConfigId) : null
      if (!parsed.success || provider === null) throw notFound()
      const raw = request.body
      const eventId = headerText(request.headers['x-sandbox-event-id'])
      const timestamp = headerText(request.headers['x-sandbox-timestamp'])
      if (!Buffer.isBuffer(raw) || !fresh(timestamp)
        || !signatureValid(provider.secret, Buffer.concat([Buffer.from(`${eventId}.${timestamp}.`), raw]), request.headers['x-sandbox-signature'])) {
        throw new ApiError(401, 'SIGNATURE_INVALID', 'The webhook signature does not match, or its timestamp is more than five minutes away.')
      }
      const actor = { actorType: 'system' as const, requestId: request.id, supportSessionId: null }
      const result = await runInTenant({ tenantId: provider.tenantId, userId: SYSTEM_ACTOR_ID }, actor, (tx) =>
        receiveProviderWebhook(tx, request, { providerId: parsed.data.providerConfigId, eventId, raw }))
      reply.code(result.statusCode)
      return result.body
    })
  })
}
