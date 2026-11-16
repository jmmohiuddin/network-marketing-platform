import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import type { Permission } from '../../lib/permissions.js'
import { listProviders, recordProvider, withdrawProvider } from './providers.js'

const READERS: readonly Permission[] = ['market.manage', 'market.signoff']
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
})
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
}
