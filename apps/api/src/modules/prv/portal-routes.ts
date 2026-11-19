import { withSystem, type Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertStepUp, currentAuth, requirePortal } from '../../lib/auth.js'
import { inPortal, runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { signInRateLimit } from '../../lib/web-security.js'
import { erasureBlockers } from './privacy-case.js'
import { sendExport } from './staff-routes.js'
import { createRequest, digestBody, exportOf, referenceOf, REQUEST_TYPES, STATE_SQL } from './requests.js'

const idParams = z.object({ id: z.uuid() })
const details = z.string().trim().min(1).max(2000)
const needsDetails = (body: { type: string; details?: string | undefined }) => body.type !== 'correction' || body.details !== undefined
const DETAILS_FOR_CORRECTION = { message: 'Say what should be corrected', path: ['details'] }
const portalBody = z.strictObject({ type: z.enum(REQUEST_TYPES), details: details.optional() }).refine(needsDetails, DETAILS_FOR_CORRECTION)
const publicBody = z.strictObject({
  tenant: z.string().min(1).max(63),
  type: z.enum(REQUEST_TYPES),
  full_name: z.string().trim().min(1).max(200),
  email: z.email().max(320).transform((value) => value.toLowerCase()),
  participant_ref: z.string().trim().min(1).max(100).optional(),
  details: details.optional(),
}).refine(needsDetails, DETAILS_FOR_CORRECTION)
const ACCOUNT_KEY_MAX = 400

// Rate-limit key of the public form from the raw body (validation runs later): one counter per tenant and email.
function requesterOf(request: FastifyRequest): string {
  const body = (request.body ?? {}) as { tenant?: unknown; email?: unknown }
  return `privacy:${String(body.tenant ?? '')}:${String(body.email ?? '')}`.toLowerCase().slice(0, ACCOUNT_KEY_MAX)
}

async function portalCreate(tx: Tx, participantId: string, body: z.infer<typeof portalBody>) {
  // One open request of a type per participant: check and insert take turns.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('privacy_request:' || app_tenant_id() || ':' || $1, 0))", [participantId])
  const open = await tx.query(
    'SELECT 1 FROM privacy_request WHERE subject_participant_id = $1 AND type = $2 AND outcome IS NULL', [participantId, body.type])
  if (open.rowCount !== 0) throw new ApiError(409, 'REQUEST_OPEN', 'You already have an open request of this type.')
  const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [participantId])
  const requester = body.details === undefined ? null : { details: body.details }
  const { id } = await createRequest(tx, { type: body.type, channel: 'portal', subjectId: participantId, marketId: rows[0]!.market_id, requester })
  const created = await tx.query<{ due_at: Date | null }>('SELECT due_at FROM privacy_request WHERE id = $1', [id])
  return { id, state: 'in_progress', due_at: created.rows[0]!.due_at }
}

interface OwnRequest {
  id: string
  type: string
  state: string
  due_at: Date | null
  retention_basis: string | null
  closed_at: Date | null
}

// The session participant's requests (self-scope policies); an erasure under review lists what still defers it, as codes.
async function ownRequests(tx: Tx, participantId: string) {
  const { rows } = await tx.query<OwnRequest>(
    `SELECT r.id, r.type, ${STATE_SQL} AS state, r.due_at,
            coalesce(r.retention_basis, c.payload ->> 'retention_basis') AS retention_basis, r.closed_at
     FROM privacy_request r JOIN case_file c ON c.id = r.case_id
     ORDER BY r.received_at DESC, r.id DESC`,
  )
  const pendingErasure = rows.some((row) => row.type === 'erasure' && row.closed_at === null)
  const reasons = pendingErasure ? [...new Set((await erasureBlockers(tx, participantId)).map((b) => b.reason))].map((reason) => ({ reason })) : []
  return rows.map((row) =>
    row.type === 'erasure' && row.closed_at === null ? { ...row, deferred_reasons: reasons } : row)
}

/** API-31 for the subject (portal, terminated participants too) and the public form SC-41. */
export function registerPortalRoutes(app: FastifyInstance): void {
  const portal = { preHandler: [requirePortal()] }

  app.post('/v1/me/privacy-requests', portal, async (request, reply) => {
    const body = parse(portalBody, request.body)
    if (body.type === 'erasure') assertStepUp(request)
    const participantId = currentAuth(request).participantId!
    digestBody(request, `privacy-portal:${participantId}`)
    const result = await inPortal(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await portalCreate(tx, participantId, body)) })))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/me/privacy-requests', portal, async (request) => {
    const participantId = currentAuth(request).participantId!
    return envelope(await inPortal(request, (tx) => ownRequests(tx, participantId)))
  })

  app.get('/v1/me/privacy-requests/:id/export', portal, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const content = await inPortal(request, async (tx) => {
      const own = await tx.query('SELECT 1 FROM privacy_request WHERE id = $1', [id])
      if (own.rowCount === 0) throw notFound()
      return exportOf(tx, id)
    })
    return sendExport(reply, id, content)
  })

  // Same answer whether or not a member matches (C-B5-22): identity is verified by the DPO before any data leaves.
  const publicRoute = { config: { rateLimit: false as const }, preHandler: [signInRateLimit(app, requesterOf)] }
  app.post('/v1/public/privacy-requests', publicRoute, async (request, reply) => {
    const { tenant, type, ...requester } = parse(publicBody, request.body)
    const tenantId = (await withSystem((tx) => tx.query<{ id: string | null }>('SELECT tenant_by_slug($1) AS id', [tenant]))).rows[0]!.id
    if (tenantId === null) throw new ApiError(404, 'TENANT_NOT_FOUND', 'No company uses this address.')
    digestBody(request, `privacy-public:${tenantId}`)
    const actor = { actorType: 'system' as const, requestId: request.id, supportSessionId: null }
    const result = await runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, actor, (tx) => idempotent(tx, request, async () => {
      const { id } = await createRequest(tx, { type, channel: 'public_form', subjectId: null, marketId: null, requester })
      return { statusCode: 202, body: envelope({ reference: referenceOf(id) }) }
    }))
    return sendIdempotent(reply, result)
  })
}
