import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertStepUp, currentAuth, hasPermission, marketScope, requireRealm, type AuthContext } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { instant, instantMs, toInstant } from './dates.js'
import { downlineNodes, hiddenLevels, levelsBelow, policyInForce } from './downline.js'
import { modelState, modelVersionFor, readModelMeta } from './read-model.js'
import { changeStatus, lockPositionStatus, positionDetail } from './positions.js'
import { childrenPage } from './tree.js'
import { childCursor, genealogyReader, nextCursor, pageLimit } from './tree-routes.js'

const idParams = z.object({ id: z.uuid() })
const statusBody = z.strictObject({
  status: z.enum(['active', 'suspended', 'terminated']),
  effective_from: instant,
  reason: z.string().trim().min(1).max(500),
})
const downlineQuery = z.object({ viewer: z.uuid(), kind: z.literal('sponsor').default('sponsor'), ...pageQuery })

const positionId = (request: FastifyRequest): string => parse(idParams, request.params).id

const inScope = (auth: AuthContext, permission: Permission, marketId: string): boolean => {
  const scope = marketScope(auth, permission)
  return scope === null || scope.includes(marketId)
}

/** genealogy.read for all markets, or participant.read over the position's market (PLAN B2 2.5). */
async function readablePosition(tx: Tx, auth: AuthContext, id: string) {
  const allMarkets = hasPermission(auth, 'genealogy.read') && marketScope(auth, 'genealogy.read') === null
  const detail = await positionDetail(tx, id)
  if (detail === null) throw notFound()
  if (!allMarkets && !inScope(auth, 'participant.read', detail.market.id)) throw notFound()
  return detail
}

function registerPositionRead(app: FastifyInstance): void {
  app.get('/v1/positions/:id', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = positionId(request)
    const auth = currentAuth(request)
    if (!hasPermission(auth, 'genealogy.read') && !hasPermission(auth, 'participant.read')) throw permissionDenied()
    return envelope(await inTenant(request, (tx) => readablePosition(tx, auth, id)))
  })
}

function registerStatusChange(app: FastifyInstance): void {
  app.post('/v1/positions/:id/status', { preHandler: [requireRealm('tenant')] }, async (request, reply) => {
    const id = positionId(request)
    const auth = currentAuth(request)
    const body = parse(statusBody, request.body)
    // FR-PAR-005: termination, and reinstating a terminated position (its reversal), are a Compliance officer's action
    // with step-up; other changes are participant.manage.
    if (body.status === 'terminated' ? !hasPermission(auth, 'participant.terminate')
      : !hasPermission(auth, 'participant.manage') && !hasPermission(auth, 'participant.terminate')) throw permissionDenied()
    if (instantMs(body.effective_from) > Date.now()) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'A status change takes effect now or earlier (no future-dated status).')
    }
    const result = await inTenant(request, async (tx) => {
      const position = await lockPositionStatus(tx, id)
      if (position === null) throw notFound()
      const market = position.market_id
      if (!inScope(auth, 'participant.manage', market) && !inScope(auth, 'participant.terminate', market)) throw notFound()
      // Checked after the replay lookup: a replayed reinstatement finds the position active.
      return idempotent(tx, request, async () => {
        const guarded = body.status === 'terminated' || position.status === 'terminated'
        if (!inScope(auth, guarded ? 'participant.terminate' : 'participant.manage', market)) throw permissionDenied()
        if (guarded) assertStepUp(request)
        const change = { status: body.status, effectiveFrom: toInstant(body.effective_from), reason: body.reason }
        const reassigned = await changeStatus(tx, id, change)
        return { statusCode: 200, body: envelope({ position: await positionDetail(tx, id), reassigned_customers: reassigned }) }
      })
    })
    return sendIdempotent(reply, result)
  })
}

/**
 * API-13 for a staff viewer position (D-B2-08): the target as the viewer would see it, its visible children (one
 * page) and per-level counts beyond the named depth. Outside the viewer's downline is 404, exactly as an unknown id.
 */
async function downline(tx: Tx, request: FastifyRequest, target: string, query: z.infer<typeof downlineQuery>) {
  const state = await modelState(tx, 'sponsor')
  const modelVersion = await modelVersionFor(tx, 'sponsor', state, target)
  const maxDepth = request.server.config.genealogyFallbackMaxDepth
  const levels = await levelsBelow(tx, modelVersion, query.viewer, target, maxDepth)
  if (levels === null) throw notFound()
  const policy = await policyInForce(tx)
  const childLevels = levels + 1
  const page = childLevels > policy.named_depth
    ? { ids: [], last: null, more: false }
    : await childrenPage(tx, { kind: 'sponsor', asOf: null, knownAt: null, modelVersion }, target,
      decodeCursor(query.cursor, childCursor), pageLimit(request, query.limit))
  const [node] = await downlineNodes(tx, [target], levels, policy)
  const children = await downlineNodes(tx, page.ids, childLevels, policy)
  const fromLevel = Math.max(0, policy.named_depth + 1 - levels)
  const aggregates = await hiddenLevels(tx, modelVersion, target, fromLevel, levels, maxDepth)
  await recordAudit(tx, {
    action: 'GENEALOGY.DOWNLINE_VIEWED', objectType: 'position', objectId: target,
    after: { viewer: query.viewer, target, policy_version: policy.version_id, rows: (node === undefined ? 0 : 1) + children.length },
  })
  return envelope(
    { node: node ?? null, children, aggregates, policy },
    { next_cursor: nextCursor(page.last, page.more), read_model: readModelMeta(state, modelVersion !== null) },
  )
}

function registerDownline(app: FastifyInstance): void {
  app.get('/v1/positions/:id/downline', { preHandler: genealogyReader }, async (request) => {
    const id = positionId(request)
    const query = parse(downlineQuery, request.query)
    return inTenant(request, (tx) => downline(tx, request, id, query))
  })
}

export function registerPositionRoutes(app: FastifyInstance): void {
  registerPositionRead(app)
  registerStatusChange(app)
  registerDownline(app)
}
