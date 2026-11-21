import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm, requireStepUp, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { inScope } from '../ten/index.js'

const MANAGE = 'legal_hold.manage'
const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({ participant_id: z.uuid().optional(), active: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })
const placeBody = z.strictObject({ participant_id: z.uuid(), reason: z.string().trim().min(1).max(500) })

const HOLD_SELECT = `
  SELECT h.id, jsonb_build_object('id', x.id, 'external_ref', x.external_ref) AS participant, x.market_id, h.reason,
         jsonb_build_object('id', p.id, 'display_name', p.display_name) AS placed_by, h.placed_at,
         CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id', r.id, 'display_name', r.display_name) END AS released_by, h.released_at
  FROM legal_hold h JOIN participant x ON x.id = h.participant_id JOIN user_account p ON p.id = h.placed_by
  LEFT JOIN user_account r ON r.id = h.released_by`

async function holdView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  return (await tx.query(`${HOLD_SELECT} WHERE h.id = $1`, [id])).rows[0]!
}

async function place(tx: Tx, request: FastifyRequest, body: z.infer<typeof placeBody>) {
  const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [body.participant_id])
  if (rows[0] === undefined || !inScope(marketScope(currentAuth(request), MANAGE), rows[0].market_id)) {
    throw new ApiError(422, 'PARTICIPANT_NOT_FOUND', 'No member with this id.')
  }
  let id: string
  try {
    id = (await tx.query<{ id: string }>(
      'INSERT INTO legal_hold (tenant_id, participant_id, reason) VALUES (app_tenant_id(), $1, $2) RETURNING id', [body.participant_id, body.reason],
    )).rows[0]!.id
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'HOLD_ACTIVE', 'This member already has an active legal hold.')
    throw error
  }
  // Ids only: the reason may describe a claim against the member.
  await recordAudit(tx, { action: 'LEGAL_HOLD.PLACED', objectType: 'legal_hold', objectId: id, after: { participant_id: body.participant_id } })
  return holdView(tx, id)
}

/** AC-PRV3-4: released once, by someone other than the placer (422 SOD_SELF_APPROVAL). */
async function release(tx: Tx, request: FastifyRequest, id: string) {
  const { rows } = await tx.query<{ placed_by: string; released_at: Date | null; market_id: string }>(
    'SELECT h.placed_by, h.released_at, x.market_id FROM legal_hold h JOIN participant x ON x.id = h.participant_id WHERE h.id = $1 FOR UPDATE OF h', [id],
  )
  const hold = rows[0]
  const auth = currentAuth(request)
  if (hold === undefined || !inScope(marketScope(auth, MANAGE), hold.market_id)) throw notFound()
  if (hold.released_at !== null) throw new ApiError(409, 'HOLD_RELEASED', 'This legal hold is already released.')
  if (hold.placed_by === auth.userId) throw new ApiError(422, 'SOD_SELF_APPROVAL', 'Someone other than the person who placed it must release this hold.')
  await tx.query('UPDATE legal_hold SET released_by = $2, released_at = now() WHERE id = $1', [id, auth.userId])
  await recordAudit(tx, { action: 'LEGAL_HOLD.RELEASED', objectType: 'legal_hold', objectId: id })
  return holdView(tx, id)
}

/** D-V1A-08 legal holds (SC-15): a held member is skipped by retention, its erasure deferred and the tenant purge blocked. */
export function registerLegalHoldRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requireAnyPermission(MANAGE, 'privacy.manage')] }
  const manage = { preHandler: [requireRealm('tenant'), requirePermission(MANAGE), requireStepUp()] }

  app.get('/v1/legal-holds', read, async (request) => {
    const query = parse(listQuery, request.query)
    const scope = scopeOfAny(currentAuth(request), [MANAGE, 'privacy.manage'])
    return envelope(await inTenant(request, async (tx) => (await tx.query(
      `${HOLD_SELECT} WHERE ($1::uuid[] IS NULL OR x.market_id = ANY ($1)) AND ($2::uuid IS NULL OR h.participant_id = $2)
         AND ($3::boolean IS NULL OR (h.released_at IS NULL) = $3)
       ORDER BY h.placed_at DESC, h.id`,
      [scope, query.participant_id ?? null, query.active ?? null],
    )).rows))
  })

  app.post('/v1/legal-holds', manage, async (request, reply) => {
    const body = parse(placeBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await place(tx, request, body)) })))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/legal-holds/:id/release', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => release(tx, request, id)))
  })
}
