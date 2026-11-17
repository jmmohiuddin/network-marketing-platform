import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requireAllMarkets, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { installConnector, listConnectors, rotateConnectorSecret, withdrawConnector, type ConnectorView } from '../pay/index.js'
import { syncHealth } from './health.js'
import { registerConnectorWebhook } from './webhook-inbound.js'

const idParams = z.object({ id: z.uuid() })
const secret = z.string().min(16).max(200)
const createBody = z.strictObject({
  provider: z.enum(['shopify', 'woocommerce']), market_id: z.uuid(), name: z.string().trim().min(1).max(100), webhook_secret: secret,
})
const rotateBody = z.strictObject({ webhook_secret: secret })
const withdrawBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })

/**
 * FR-ORD-002 connectors (inbound webhooks only, D-B2-14) and FR-INT-002 sync health. Connectors are tenant-wide
 * integration credentials: integration.manage for all markets, as for API keys and webhook endpoints. The signing secret
 * is written once and never returned.
 */
export function registerConnectorRoutes(app: FastifyInstance): void {
  const guard = [requireRealm('tenant'), requirePermission('integration.manage'), requireAllMarkets('integration.manage')]
  const { secretKey } = app.config
  const withUrl = (connector: ConnectorView) => ({ ...connector, webhook_url: `${app.config.webUrl}/v1/connectors/${connector.id}/webhooks` })

  app.get('/v1/connectors', { preHandler: guard }, async (request) =>
    envelope((await inTenant(request, (tx) => listConnectors(tx))).map(withUrl)))

  app.post('/v1/connectors', { preHandler: [...guard, requireStepUp()] }, async (request, reply) => {
    const body = parse(createBody, request.body)
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        const connector = withUrl(await installConnector(tx, secretKey, body))
        return { statusCode: 201, body: envelope({ connector, webhook_url: connector.webhook_url }) }
      }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/connectors/:id/rotate-secret', { preHandler: [...guard, requireStepUp()] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const { webhook_secret: webhookSecret } = parse(rotateBody, request.body)
    return envelope(withUrl(await inTenant(request, (tx) => rotateConnectorSecret(tx, secretKey, id, webhookSecret))))
  })

  app.post('/v1/connectors/:id/withdraw', { preHandler: guard }, async (request) => {
    const { id } = parse(idParams, request.params)
    const { reason } = parse(withdrawBody, request.body)
    return envelope(withUrl(await inTenant(request, (tx) => withdrawConnector(tx, id, reason))))
  })

  app.get('/v1/integrations/health', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const auth = currentAuth(request)
    const held = (['integration.read', 'integration.manage'] as const).filter((permission) => auth.permissions.has(permission))
    if (held.length === 0) throw permissionDenied()
    // Sync health lists every connector and source of the tenant: all markets only (as the Integrations screen).
    if (!held.some((permission) => marketScope(auth, permission) === null)) {
      throw new ApiError(403, 'SCOPE_NOT_HELD', 'Sync health spans every market, so it needs the permission for all markets.')
    }
    return envelope(await inTenant(request, (tx) => syncHealth(tx)))
  })

  registerConnectorWebhook(app)
}
