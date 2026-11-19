// D-B4-11 related-party declarations: a staff user's own (`self`) or a relative's participant account, recorded and
// withdrawn by a Tenant admin (user.manage for all markets: declarations are tenant-wide). staff_related_users reads
// them for the manual-adjustment block/escalation and the excluded approvers (BR-ADJ-03).
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { requireAllMarkets, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { getUser } from './users.js'

const userParams = z.object({ id: z.uuid() })
const declarationParams = z.object({ id: z.uuid(), rid: z.uuid() })
const declareBody = z.strictObject({ participant_id: z.uuid(), relation: z.enum(['self', 'relative']) })
const withdrawBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })

interface Declaration {
  readonly id: string
  readonly participant: { readonly id: string; readonly external_ref: string; readonly display_name: string | null }
  readonly relation: 'self' | 'relative'
  readonly declared_by: string
  readonly declared_at: Date
  readonly withdrawn_at: Date | null
}

const SELECT = `SELECT r.id, jsonb_build_object('id', p.id, 'external_ref', p.external_ref, 'display_name', p.display_name) AS participant,
  r.relation, r.declared_by, r.declared_at, r.withdrawn_at
  FROM user_related_participant r JOIN participant p ON p.tenant_id = r.tenant_id AND p.id = r.participant_id`

// shortcut: no pagination, a user has a handful of declarations; page it if one ever lists more than 200.
async function declarations(tx: Tx, userId: string): Promise<Declaration[]> {
  const { rows } = await tx.query<Declaration>(`${SELECT} WHERE r.user_id = $1 ORDER BY r.declared_at DESC, r.id`, [userId])
  return rows
}

async function declaration(tx: Tx, userId: string, id: string): Promise<Declaration> {
  const { rows } = await tx.query<Declaration>(`${SELECT} WHERE r.user_id = $1 AND r.id = $2`, [userId, id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

async function declare(tx: Tx, userId: string, body: z.infer<typeof declareBody>): Promise<Declaration> {
  await getUser(tx, userId)
  const { rows: participants } = await tx.query('SELECT 1 FROM participant WHERE id = $1', [body.participant_id])
  if (participants.length === 0) throw new ApiError(422, 'PARTICIPANT_NOT_FOUND', 'The participant does not exist.')
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by)
     VALUES (app_tenant_id(), $1, $2, $3, app_user_id()) RETURNING id`,
    [userId, body.participant_id, body.relation],
  ).catch((error: { code?: string }) => {
    if (error.code === '23505') throw new ApiError(409, 'ALREADY_DECLARED', 'This participant is already declared for the user.')
    throw error
  })
  const id = rows[0]!.id
  await recordAudit(tx, {
    action: 'IAM.RELATED_PARTY_DECLARED', objectType: 'user_related_participant', objectId: id,
    after: { user_id: userId, participant_id: body.participant_id, relation: body.relation },
  })
  return declaration(tx, userId, id)
}

async function withdraw(tx: Tx, userId: string, id: string, reason: string): Promise<Declaration> {
  const { rows } = await tx.query<{ withdrawn_at: Date | null; participant_id: string; relation: string; own: boolean }>(
    'SELECT withdrawn_at, participant_id, relation, user_id = app_user_id() AS own FROM user_related_participant WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, id],
  )
  const row = rows[0]
  if (row === undefined) throw notFound()
  // BR-ADJ-02/03: withdrawing your own declaration would lift your own adjustment block and approver exclusion (0411 backstop).
  if (row.own) throw new ApiError(422, 'SOD_SELF_APPROVAL', 'Another administrator withdraws a declaration about you.')
  if (row.withdrawn_at !== null) throw new ApiError(409, 'ALREADY_WITHDRAWN', 'This declaration is already withdrawn.')
  const { rows: updated } = await tx.query<{ withdrawn_at: Date }>(
    'UPDATE user_related_participant SET withdrawn_at = now(), withdrawn_by = app_user_id(), withdraw_reason = $2 WHERE id = $1 RETURNING withdrawn_at',
    [id, reason],
  )
  await recordAudit(tx, {
    action: 'IAM.RELATED_PARTY_WITHDRAWN', objectType: 'user_related_participant', objectId: id,
    before: { user_id: userId, participant_id: row.participant_id, relation: row.relation, withdrawn_at: null },
    after: { user_id: userId, participant_id: row.participant_id, relation: row.relation, withdrawn_at: updated[0]!.withdrawn_at }, reason,
  })
  return declaration(tx, userId, id)
}

export function registerRelatedPartyRoutes(app: FastifyInstance): void {
  const guard = { preHandler: [requireRealm('tenant'), requirePermission('user.manage'), requireAllMarkets('user.manage')] }
  const base = '/v1/users/:id/related-participants'

  app.get(base, guard, async (request) => {
    const { id } = parse(userParams, request.params)
    return envelope(await inTenant(request, async (tx) => {
      await getUser(tx, id)
      return declarations(tx, id)
    }))
  })

  app.post(base, guard, async (request, reply) => {
    const { id } = parse(userParams, request.params)
    const body = parse(declareBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await declare(tx, id, body)) })))
    return sendIdempotent(reply, result)
  })

  app.post(`${base}/:rid/withdraw`, guard, async (request) => {
    const { id, rid } = parse(declarationParams, request.params)
    const { reason } = parse(withdrawBody, request.body)
    return envelope(await inTenant(request, (tx) => withdraw(tx, id, rid, reason)))
  })
}
