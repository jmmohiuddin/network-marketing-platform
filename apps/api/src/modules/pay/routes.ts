import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requireAllMarkets, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import type { Permission } from '../../lib/permissions.js'
import { ADAPTERS, configureAdapter, listProviders, recordProvider, setReviewDate, withdrawProvider, type Adapter } from './providers.js'

const READERS: readonly Permission[] = ['market.manage', 'market.signoff', 'integration.manage', 'integration.read', 'payout.read']
const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({
  market_id: z.uuid().optional(),
  kind: z.enum(['payout', 'payment', 'commerce', 'messaging']).optional(),
  state: z.enum(['recorded', 'withdrawn']).optional(),
})
const createBody = z.strictObject({
  market_id: z.uuid(),
  kind: z.enum(['payout', 'payment']),
  provider: z.string().trim().min(1).max(100),
  approved_description: z.string().trim().min(1).max(2000),
  approval_document_id: z.uuid(),
  approved_at: z.iso.date(),
  funds_holder: z.string().trim().min(1).max(200),
  review_due_on: z.iso.date().nullable().optional(),
})
const reviewBody = z.strictObject({ review_due_on: z.iso.date().nullable() })
const adapterBody = z.strictObject({ adapter: z.string().max(100), webhook_secret: z.string().optional() })
const withdrawBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })

/** Provider eligibility records (FR-TEN-004 / FR-PAY-006 B1 part): market.manage prepares, market.signoff reads. */
export function registerProviderRoutes(app: FastifyInstance): void {
  app.get('/v1/provider-configs', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const auth = currentAuth(request)
    const held = READERS.filter((permission) => auth.permissions.has(permission))
    if (held.length === 0) throw permissionDenied()
    const scopes = held.map((permission) => marketScope(auth, permission))
    const scope = scopes.includes(null) ? null : [...new Set(scopes.flatMap((markets) => markets ?? []))]
    const filter = parse(listQuery, request.query)
    return envelope(await inTenant(request, (tx) => listProviders(tx, scope, filter)))
  })

  app.post('/v1/provider-configs', { preHandler: [requireRealm('tenant'), requirePermission('market.manage')] }, async (request, reply) => {
    const body = parse(createBody, request.body)
    if (body.approved_at > new Date().toISOString().slice(0, 10)) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'approved_at is not valid: it cannot be in the future.', { issues: [{ path: 'approved_at', message: 'cannot be in the future' }] })
    }
    const scope = marketScope(currentAuth(request), 'market.manage')
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await recordProvider(tx, scope, body)) })))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/provider-configs/:id/withdraw', { preHandler: [requireRealm('tenant'), requirePermission('market.manage')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const { reason } = parse(withdrawBody, request.body)
    const scope = marketScope(currentAuth(request), 'market.manage')
    return envelope(await inTenant(request, (tx) => withdrawProvider(tx, id, scope, reason)))
  })

  app.patch('/v1/provider-configs/:id', { preHandler: [requireRealm('tenant'), requirePermission('market.manage')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(reviewBody, request.body)
    const scope = marketScope(currentAuth(request), 'market.manage')
    return envelope(await inTenant(request, (tx) => setReviewDate(tx, id, scope, body.review_due_on)))
  })

  // D-B4-14: tenant-wide integration credentials, so integration.manage for all markets (as connectors), with step-up.
  app.put('/v1/provider-configs/:id/adapter', {
    preHandler: [requireRealm('tenant'), requirePermission('integration.manage'), requireAllMarkets('integration.manage'), requireStepUp()],
  }, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(adapterBody, request.body)
    if (!(ADAPTERS as readonly string[]).includes(body.adapter)) {
      throw new ApiError(422, 'ADAPTER_NOT_AVAILABLE', 'Only sandbox adapters exist in this build.', { adapters: ADAPTERS })
    }
    const secret = body.webhook_secret ?? null
    const secretValid = body.adapter === 'sandbox' ? secret !== null && secret.length >= 24 && secret.length <= 128 : secret === null
    if (!secretValid) {
      const message = body.adapter === 'sandbox' ? 'a sandbox adapter needs a webhook secret of 24 to 128 characters' : 'a bank file adapter takes no webhook secret'
      throw new ApiError(422, 'VALIDATION_FAILED', `webhook_secret is not valid: ${message}.`, { issues: [{ path: 'webhook_secret', message }] })
    }
    return envelope(await inTenant(request, (tx) => configureAdapter(tx, app.config.secretKey, id, body.adapter as Adapter, secret)))
  })
}
