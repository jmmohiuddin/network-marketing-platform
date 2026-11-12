import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertStepUp, currentAuth, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { PERMISSIONS } from '../../lib/permissions.js'
import { decideGrant, grantRole, listGrantRequests, revokeAssignment } from './grants.js'
import { createRole, listRoles } from './roles.js'

const idParams = z.object({ id: z.uuid() })
const roleBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  mfa_required: z.boolean().default(false),
})
const grantBody = z.strictObject({
  role_id: z.uuid(),
  market_ids: z.array(z.uuid()).min(1).max(100).nullable().default(null),
  valid_to: z.iso.datetime({ offset: true })
    .refine((value) => Date.parse(value) > Date.now(), 'must be in the future')
    .nullable().default(null),
})
const decisionBody = z.strictObject({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).max(500).nullable().default(null),
})
const requestQuery = z.strictObject({ ...pageQuery, state: z.enum(['pending', 'approved', 'rejected']).optional() })
const requestCursor = z.object({ created_at: z.string(), id: z.uuid() })

const guard = { preHandler: [requireRealm('tenant'), requirePermission('user.manage')] }
// Deciding a privileged grant needs a fresh second factor (SEC-20) and an Idempotency-Key (TR-API-13).
const decisionGuard = { preHandler: [...guard.preHandler, requireStepUp()] }

/** API-40 roles: the catalogue (meta.permissions), base and tenant roles, new tenant roles. */
export function registerRoleRoutes(app: FastifyInstance): void {
  app.get('/v1/roles', guard, async (request) =>
    envelope(await inTenant(request, listRoles), { permissions: PERMISSIONS }))

  app.post('/v1/roles', guard, async (request, reply) => {
    const body = parse(roleBody, request.body)
    const role = { name: body.name, permissions: body.permissions, mfaRequired: body.mfa_required }
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await createRole(tx, role)) })),
    )
    return sendIdempotent(reply, result)
  })
}

/** API-40 grants: assign, second-admin approvals, revocation. */
export function registerGrantRoutes(app: FastifyInstance): void {
  app.post('/v1/users/:id/role-assignments', guard, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(grantBody, request.body)
    const input = { roleId: body.role_id, marketIds: body.market_ids, validTo: body.valid_to === null ? null : new Date(body.valid_to) }
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => {
        const outcome = await grantRole(tx, currentAuth(request), id, input)
        return outcome.kind === 'assignment'
          ? { statusCode: 201, body: envelope({ assignment: outcome.assignment, request: null }) }
          : { statusCode: 202, body: envelope({ assignment: null, request: outcome.request }) }
      }),
    )
    return sendIdempotent(reply, result)
  })

  app.post('/v1/role-assignments/:id/revoke', guard, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => revokeAssignment(tx, currentAuth(request), id, () => assertStepUp(request))))
  })

  app.get('/v1/role-grant-requests', guard, async (request) => {
    const query = parse(requestQuery, request.query)
    const after = decodeCursor(query.cursor, requestCursor)
    const rows = await inTenant(request, (tx) => listGrantRequests(tx, query.state, after, query.limit))
    return toPage(rows, query.limit, (row) => ({ created_at: row.created_at.toISOString(), id: row.id }))
  })

  app.post('/v1/role-grant-requests/:id/decision', decisionGuard, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const decision = parse(decisionBody, request.body)
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await decideGrant(tx, currentAuth(request), id, decision)) })),
    )
    return sendIdempotent(reply, result)
  })
}
