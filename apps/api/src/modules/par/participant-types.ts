import { eligibleApprovers, type EligibleApprover, type Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertStepUp, currentAuth, requireAllMarkets, requireAnyPermission, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { approveOrRefuse, decideWithSod } from '../ten/index.js'
import { typeCode } from './schemas.js'

// D-B2-09: types are proposed by a Tenant admin and approved by a Compliance officer; flags never change afterwards.
const APPROVER = 'participant_type.approve'
const OBJECT_TYPE = 'participant_type'
const STATES = ['pending', 'active', 'rejected', 'withdrawn'] as const
const reason = z.string().trim().min(1).max(500)
const proposeBody = z.strictObject({
  code: typeCode, name: z.string().trim().min(1).max(100), can_earn: z.boolean(), counts_as_end_customer: z.boolean(),
  can_sponsor: z.boolean(), can_hold_positions: z.boolean(), reason,
})
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), reason })
const withdrawBody = z.strictObject({ reason })
const listQuery = z.strictObject({ state: z.enum(STATES).optional() })
const idParams = z.object({ id: z.uuid() })

interface TypeRow {
  id: string
  code: string
  name: string
  can_earn: boolean
  counts_as_end_customer: boolean
  can_sponsor: boolean
  can_hold_positions: boolean
  state: (typeof STATES)[number]
  reason: string
  requested_by: { id: string; display_name: string | null }
  requested_at: Date
  decided_by: { id: string; display_name: string | null } | null
  decided_at: Date | null
  decision_reason: string | null
}

const SELECT = `
  SELECT t.id, t.code, t.name, t.can_earn, t.counts_as_end_customer, t.can_sponsor, t.can_hold_positions, t.state, t.reason,
         jsonb_build_object('id', ru.id, 'display_name', ru.display_name) AS requested_by, t.requested_at,
         CASE WHEN du.id IS NULL THEN NULL ELSE jsonb_build_object('id', du.id, 'display_name', du.display_name) END AS decided_by,
         t.decided_at, t.decision_reason
  FROM participant_type t
  JOIN user_account ru ON ru.id = t.requested_by
  LEFT JOIN user_account du ON du.id = t.decided_by`

async function view(tx: Tx, row: TypeRow): Promise<TypeRow & { eligible_approvers: EligibleApprover[] | null }> {
  const eligible = row.state === 'pending'
    ? await eligibleApprovers(tx, { permission: APPROVER, marketId: null, excludeUserIds: [row.requested_by.id], allMarkets: true })
    : null
  return { ...row, eligible_approvers: eligible }
}

async function typeView(tx: Tx, id: string) {
  const { rows } = await tx.query<TypeRow>(`${SELECT} WHERE t.id = $1`, [id])
  if (rows[0] === undefined) throw notFound()
  return view(tx, rows[0])
}

async function lockPending(tx: Tx, id: string, requesterOnly: boolean): Promise<{ requested_by: string; code: string }> {
  const { rows } = await tx.query<{ requested_by: string; code: string; state: string }>(
    `SELECT requested_by, code, state FROM participant_type
     WHERE id = $1 AND (NOT $2 OR requested_by = app_user_id()) FOR UPDATE`,
    [id, requesterOnly],
  )
  const row = rows[0]
  if (row === undefined) throw notFound()
  if (row.state !== 'pending') throw new ApiError(409, 'TYPE_NOT_PENDING', 'This type is already decided or withdrawn.', { state: row.state })
  return row
}

async function decide(tx: Tx, id: string, body: z.infer<typeof decisionBody>, factorVerifiedAt: Date | null) {
  const pending = await lockPending(tx, id, false)
  const approve = body.decision === 'approve'
  const approval = await approveOrRefuse(tx, {
    objectType: OBJECT_TYPE, objectId: id, preparerId: pending.requested_by, contributorIds: [], excludedIds: [],
    decision: approve ? 'approved' : 'rejected', reason: body.reason, factorVerifiedAt, approverPermission: APPROVER,
    marketId: null, allMarkets: true,
  })
  await tx.query(
    `UPDATE participant_type SET state = $2, decided_by = app_user_id(), decided_at = $3, decision_reason = $4, approval_id = $5
     WHERE id = $1`,
    [id, approve ? 'active' : 'rejected', approval.decidedAt, body.reason, approval.approvalId],
  )
  await recordAudit(tx, {
    action: approve ? 'PARTICIPANT_TYPE.APPROVED' : 'PARTICIPANT_TYPE.REJECTED', objectType: OBJECT_TYPE, objectId: id,
    before: { state: 'pending' }, after: { state: approve ? 'active' : 'rejected', approval_id: approval.approvalId }, reason: body.reason,
  })
  return typeView(tx, id)
}

async function propose(tx: Tx, body: z.infer<typeof proposeBody>) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions,
       state, reason, requested_by)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, 'pending', $7, app_user_id())
     ON CONFLICT (tenant_id, code) WHERE state IN ('pending', 'active') DO NOTHING RETURNING id`,
    [body.code, body.name, body.can_earn, body.counts_as_end_customer, body.can_sponsor, body.can_hold_positions, body.reason],
  )
  if (rows[0] === undefined) throw new ApiError(409, 'TYPE_CODE_TAKEN', 'A pending or active type has this code.')
  await recordAudit(tx, {
    action: 'PARTICIPANT_TYPE.PROPOSED', objectType: OBJECT_TYPE, objectId: rows[0].id, after: { code: body.code }, reason: body.reason,
  })
  return typeView(tx, rows[0].id)
}

/** PLAN B2 2.2: participant types with proposal, approval (SoD, step-up) and withdrawal. */
export function registerParticipantTypeRoutes(app: FastifyInstance): void {
  const readers = requireAnyPermission('participant.read', 'settings.manage', APPROVER)
  app.get('/v1/participant-types', { preHandler: [requireRealm('tenant'), readers] }, async (request) => {
    const { state } = parse(listQuery, request.query)
    return envelope(await inTenant(request, async (tx) => {
      const { rows } = await tx.query<TypeRow>(`${SELECT} WHERE ($1::text IS NULL OR t.state = $1) ORDER BY t.code, t.requested_at`, [state ?? null])
      const views = []
      for (const row of rows) views.push(await view(tx, row)) // one query at a time on the transaction's client
      return views
    }))
  })

  const manage = [requireRealm('tenant'), requirePermission('settings.manage'), requireAllMarkets('settings.manage')]
  app.post('/v1/participant-types', { preHandler: manage }, async (request, reply) => {
    const body = parse(proposeBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 201, body: envelope(await propose(tx, body)),
    })))
    return sendIdempotent(reply, result)
  })

  const approve = [requireRealm('tenant'), requirePermission(APPROVER), requireAllMarkets(APPROVER)]
  app.post('/v1/participant-types/:id/decision', { preHandler: approve }, async (request, reply) => {
    assertStepUp(request)
    const { id } = parse(idParams, request.params)
    const body = parse(decisionBody, request.body)
    const factorVerifiedAt = currentAuth(request).stepUpAt
    const result = await decideWithSod(request, async (tx) => ({ statusCode: 200, body: envelope(await decide(tx, id, body, factorVerifiedAt)) }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participant-types/:id/withdraw', { preHandler: manage }, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(withdrawBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      await lockPending(tx, id, true)
      await tx.query(`UPDATE participant_type SET state = 'withdrawn', decided_at = now(), decision_reason = $2 WHERE id = $1`, [id, body.reason])
      await recordAudit(tx, {
        action: 'PARTICIPANT_TYPE.WITHDRAWN', objectType: OBJECT_TYPE, objectId: id, before: { state: 'pending' },
        after: { state: 'withdrawn' }, reason: body.reason,
      })
      return typeView(tx, id)
    }))
  })
}
