import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertStepUp, currentAuth, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { emailSchema } from './auth-routes.js'
import { deactivateUser, getUser, inviteUser, listUsers, reissueInvitation } from './users.js'

const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject(pageQuery)
const inviteBody = z.strictObject({ email: emailSchema, display_name: z.string().trim().min(1).max(200).optional() })
const emailCursor = z.string().max(320)

/**
 * API-40 users: list, read, invite and re-invite (the one-time link is mailed to the invitee, never returned),
 * deactivate. Permission user.manage.
 */
export function registerUserRoutes(app: FastifyInstance): void {
  const guard = { preHandler: [requireRealm('tenant'), requirePermission('user.manage')] }

  app.get('/v1/users', guard, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, emailCursor)
    const rows = await inTenant(request, (tx) => listUsers(tx, after, query.limit))
    return toPage(rows, query.limit, (user) => user.email)
  })

  app.get('/v1/users/:id', guard, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => getUser(tx, id)))
  })

  app.post('/v1/users', guard, async (request, reply) => {
    const body = parse(inviteBody, request.body)
    const input = { email: body.email, displayName: body.display_name ?? null, invitedBy: currentAuth(request).userId }
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope({ user: await inviteUser(tx, input) }) })),
    )
    return sendIdempotent(reply, result)
  })

  // 202: the new link is mailed by a job; the earlier one stops working when it is issued.
  app.post('/v1/users/:id/invitation', guard, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const invitedBy = currentAuth(request).userId
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 202, body: envelope({ user: await reissueInvitation(tx, id, invitedBy) }) })),
    )
    return sendIdempotent(reply, result)
  })

  app.post('/v1/users/:id/deactivate', guard, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => deactivateUser(tx, currentAuth(request), id, () => assertStepUp(request))))
  })
}
