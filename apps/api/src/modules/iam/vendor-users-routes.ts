import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inVendor } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { vendorIdempotency } from '../support/index.js'
import { emailSchema } from './auth-routes.js'
import { loggingSecondPersonRefusals } from './second-person.js'
import { decideVendorInvitation, deactivateVendorUser, inviteVendorUser, listVendorUsers, reissueVendorInvitation } from './vendor-users.js'

const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject(pageQuery)
const inviteBody = z.strictObject({ email: emailSchema, display_name: z.string().trim().min(1).max(200).nullable().default(null) })
const userCursor = z.tuple([z.string().max(320), z.uuid()])

/**
 * Vendor-user management (BUG-011, FR-OPS-001 console): list, invite (step-up, Idempotency-Key), approve or reject an
 * invitation (BUG-031: an independent second vendor user, step-up, Idempotency-Key), re-invite an approved one,
 * deactivate (step-up). Vendor realm only; every MFA-verified vendor user may use it (vendor roles are undefined).
 */
export function registerVendorUserRoutes(app: FastifyInstance): void {
  const vendor = { preHandler: [requireRealm('vendor')] }
  const confirmed = { preHandler: [requireRealm('vendor'), requireStepUp()] }

  app.get('/v1/vendor-users', vendor, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, userCursor)
    const rows = await inVendor(request, (tx) => listVendorUsers(tx, after, query.limit))
    return toPage(rows, query.limit, (user) => [user.email, user.id])
  })

  app.post('/v1/vendor-users', confirmed, async (request, reply) => {
    const body = parse(inviteBody, request.body)
    const idempotency = vendorIdempotency(request)
    const input = { email: body.email, displayName: body.display_name, invitedBy: currentAuth(request).userId }
    const invited = await inVendor(request, (tx) => inviteVendorUser(tx, app.config, input, idempotency))
    return sendIdempotent(reply, { statusCode: 201, body: envelope({ user: invited.user }), replayed: invited.replayed })
  })

  for (const [path, approved] of [['approve', true], ['reject', false]] as const) {
    app.post(`/v1/vendor-users/:id/${path}`, confirmed, async (request, reply) => {
      const { id } = parse(idParams, request.params)
      const idempotency = vendorIdempotency(request)
      const decision = { userId: id, deciderId: currentAuth(request).userId, approved }
      const decided = await loggingSecondPersonRefusals(request, { objectType: 'user_account', objectId: id }, () =>
        inVendor(request, (tx) => decideVendorInvitation(tx, app.config, decision, idempotency)))
      return sendIdempotent(reply, { statusCode: 200, body: envelope({ user: decided.user }), replayed: decided.replayed })
    })
  }

  // 202 as for tenant users: the new link is mailed; the earlier one stops working.
  app.post('/v1/vendor-users/:id/invitation', vendor, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const user = await inVendor(request, (tx) => reissueVendorInvitation(tx, app.config, id, currentAuth(request).userId))
    return reply.code(202).send(envelope({ user }))
  })

  app.post('/v1/vendor-users/:id/deactivate', confirmed, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inVendor(request, (tx) => deactivateVendorUser(tx, id)))
  })
}
