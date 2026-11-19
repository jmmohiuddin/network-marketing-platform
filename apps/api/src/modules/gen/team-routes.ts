import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertPortalActive, currentAuth, requirePortal } from '../../lib/auth.js'
import { inPortal } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { pageQuery } from '../../lib/pagination.js'
import { downlineNodes, policyInForce, type Policy } from './downline.js'
import { downlineView } from './position-routes.js'
import { CURRENT } from './read-model.js'

// D-B5-10 team view (FR-DIST-004, API-34): API-13 with the viewer = one of the session participant's own positions.
// Search looks only within the named depth, so it never reveals a deeper position.

const PAGE_MAX = 50
const SEARCH_MIN = 2

const teamQuery = z.strictObject({
  position_id: z.uuid().optional(),
  node: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: pageQuery.cursor,
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_MAX),
})

interface Owned {
  readonly position_id: string
  readonly position_ref: string
}

/** The viewer: the named position if the participant owns it now, else its first own position by reference; 404 otherwise. */
async function viewerOf(tx: Tx, participantId: string, positionId: string | undefined): Promise<Owned> {
  const { rows } = await tx.query<Owned>(
    `SELECT p.id AS position_id, p.position_ref FROM position_ownership o JOIN position p ON p.tenant_id = o.tenant_id AND p.id = o.position_id
     WHERE o.participant_id = $1 AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now()) AND ($2::uuid IS NULL OR p.id = $2)
     ORDER BY p.position_ref, p.id LIMIT 1`,
    [participantId, positionId ?? null],
  )
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/**
 * Positions 1..named_depth levels below the viewer (sponsor tree valid and known now) whose owner's name or reference
 * matches: the first `limit`, and whether more matched (the caller narrows the search; no paging).
 */
async function search(tx: Tx, viewer: string, q: string, policy: Policy, limit: number) {
  const { rows } = await tx.query<{ id: string; lvl: number }>(
    `WITH RECURSIVE down (id, lvl) AS (
       SELECT $1::uuid, 0
       UNION ALL
       SELECT r.child_position_id, down.lvl + 1 FROM down
       JOIN relationship r ON r.kind = 'sponsor' AND r.parent_position_id = down.id AND ${CURRENT('r')}
       WHERE down.lvl < $2)
     SELECT d.id, d.lvl FROM down d
     JOIN position p ON p.id = d.id
     LEFT JOIN position_ownership o ON o.position_id = p.id AND o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now())
     LEFT JOIN participant x ON x.tenant_id = o.tenant_id AND x.id = o.participant_id
     WHERE d.lvl >= 1 AND (p.position_ref = $3 OR x.display_name ILIKE $4)
     ORDER BY d.lvl, p.position_ref, p.id LIMIT $5`,
    [viewer, policy.named_depth, q, likePattern(q), limit + 1],
  )
  const shown = rows.slice(0, limit)
  const levels = [...new Set(shown.map((row) => row.lvl))]
  const matches = []
  for (const level of levels) matches.push(...await downlineNodes(tx, shown.filter((row) => row.lvl === level).map((row) => row.id), level, policy))
  return { matches, truncated: rows.length > limit }
}

const policyView = (policy: Policy) =>
  ({ named_depth: policy.named_depth, contact_for_personally_sponsored: policy.contact_for_personally_sponsored, default: policy.default })

export function registerTeamRoutes(app: FastifyInstance): void {
  app.get('/v1/me/team', { preHandler: [requirePortal()] }, async (request) => {
    const auth = currentAuth(request)
    assertPortalActive(auth)
    const query = parse(teamQuery, request.query)
    if (query.q !== undefined && query.q.length < SEARCH_MIN) {
      throw new ApiError(422, 'VALIDATION_FAILED', `Search needs at least ${SEARCH_MIN} characters.`, { issues: [{ path: 'q', message: 'too short' }] })
    }
    return inPortal(request, async (tx) => {
      const viewer = await viewerOf(tx, auth.participantId!, query.position_id)
      const q = query.q
      if (q !== undefined) {
        const policy = await policyInForce(tx)
        const { matches, truncated } = await search(tx, viewer.position_id, q, policy, query.limit)
        await recordAudit(tx, {
          action: 'GENEALOGY.DOWNLINE_VIEWED', objectType: 'position', objectId: viewer.position_id,
          after: { viewer: viewer.position_id, target: viewer.position_id, policy_version: policy.version_id, rows: matches.length, search: true },
        })
        return envelope({ viewer, matches, policy: policyView(policy) }, { truncated })
      }
      const view = await downlineView(tx, request, { viewer: viewer.position_id, target: query.node ?? viewer.position_id, cursor: query.cursor, limit: query.limit })
      return envelope(
        { viewer, node: view.node, children: view.children, hidden_levels: view.aggregates, policy: policyView(view.policy) },
        view.meta,
      )
    })
  })
}
