import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, hasPermission, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inOwnRealm, inTenant } from '../../lib/db.js'
import { permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { decideSession, endSessionAsTenant, endSessionAsVendor } from './decisions.js'
import { requestSession } from './requests.js'
import { getSession, listSessions, scopePermission, sessionLog, SUPPORT_SESSION_MAX_MINUTES, withRequesters } from './sessions.js'
import { vendorIdempotency } from './vendor-idempotency.js'

const idParams = z.object({ id: z.uuid() })
const minutes = z.number().int().min(1).max(SUPPORT_SESSION_MAX_MINUTES)
const requestBody = z.strictObject({
  tenant: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  scope: z.strictObject({ permissions: z.array(scopePermission).min(1).max(scopePermission.options.length) }),
  minutes,
})
const decisionBody = z
  .strictObject({
    approved: z.boolean(),
    minutes: minutes.nullable().default(null),
    region_approved: z.boolean().default(false),
    reason: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .refine((body) => !body.approved || body.minutes !== null, { message: 'minutes is required when approving', path: ['minutes'] })
const listQuery = z.strictObject({
  ...pageQuery,
  state: z.enum(['requested', 'approved', 'denied', 'active', 'expired', 'ended']).optional(),
})
const sessionCursor = z.object({ created_at: z.iso.datetime({ offset: true }), id: z.uuid() })
const logQuery = z.strictObject(pageQuery)
const seqCursor = z.string().regex(/^\d+$/)

// Vendor users see every request (vendor console); tenant users need vendor_access.decide (SC-14).
async function vendorOrDecider(request: FastifyRequest): Promise<void> {
  const auth = currentAuth(request)
  if (auth.realm === 'tenant' && !hasPermission(auth, 'vendor_access.decide')) throw permissionDenied()
}

const either = { preHandler: [vendorOrDecider] }
const vendorOnly = { preHandler: [requireRealm('vendor')] }
const decider = { preHandler: [requireRealm('tenant'), requirePermission('vendor_access.decide')] }
// A decision grants access to tenant data: fresh second factor (MVP_A C-4) and an Idempotency-Key.
const decisionGuard = { preHandler: [...decider.preHandler, requireStepUp()] }

/** API-08 support sessions (FR-IAM-005): vendor requests, tenant decisions, ending, the session log. */
export function registerSupportRoutes(app: FastifyInstance): void {
  // What a request may ask for, so the vendor console does not repeat the server's limits.
  app.get('/v1/support-sessions/limits', vendorOnly, async () =>
    envelope({ max_minutes: SUPPORT_SESSION_MAX_MINUTES, scopes: scopePermission.options }))

  app.post('/v1/support-sessions', vendorOnly, async (request, reply) => {
    const body = parse(requestBody, request.body)
    const input = { tenantId: body.tenant, reason: body.reason, minutes: body.minutes, permissions: body.scope.permissions }
    const outcome = await requestSession(request, input, vendorIdempotency(request))
    return sendIdempotent(reply, { statusCode: 201, body: envelope(outcome.session), replayed: outcome.replayed })
  })

  app.get('/v1/support-sessions', either, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, sessionCursor)
    const tenantView = currentAuth(request).realm === 'tenant'
    const rows = await inOwnRealm(request, async (tx) => {
      const sessions = await listSessions(tx, query.state, after, query.limit)
      return tenantView ? withRequesters(tx, sessions) : sessions
    })
    return toPage(rows, query.limit, (row) => ({ created_at: row.created_at.toISOString(), id: row.id }))
  })

  app.get('/v1/support-sessions/:id', either, async (request) => {
    const { id } = parse(idParams, request.params)
    const tenantView = currentAuth(request).realm === 'tenant'
    return envelope(await inOwnRealm(request, async (tx) => {
      const session = await getSession(tx, id)
      return tenantView ? (await withRequesters(tx, [session]))[0]! : session
    }))
  })

  app.post('/v1/support-sessions/:id/decision', decisionGuard, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(decisionBody, request.body)
    const decision = { approved: body.approved, minutes: body.minutes, regionApproved: body.region_approved, reason: body.reason }
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await decideSession(tx, currentAuth(request), id, decision)) })),
    )
    return sendIdempotent(reply, result)
  })

  app.post('/v1/support-sessions/:id/end', either, async (request) => {
    const { id } = parse(idParams, request.params)
    const ended = currentAuth(request).realm === 'vendor'
      ? await endSessionAsVendor(request, id)
      : await inTenant(request, (tx) => endSessionAsTenant(tx, id))
    return envelope(ended)
  })

  app.get('/v1/support-sessions/:id/log', decider, async (request) => {
    const { id } = parse(idParams, request.params)
    const query = parse(logQuery, request.query)
    const beforeSeq = decodeCursor(query.cursor, seqCursor)
    const rows = await inTenant(request, (tx) => sessionLog(tx, id, beforeSeq, query.limit))
    return toPage(rows, query.limit, (event) => event.seq)
  })
}
