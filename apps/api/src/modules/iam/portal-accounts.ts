import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { maskContact } from '../../lib/contact.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { enqueue } from '../../lib/jobs.js'
import type { Permission } from '../../lib/permissions.js'
import { sendInvitationJob } from './invitations.js'

const idParams = z.object({ id: z.uuid() })
const deactivateBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })
const UNIQUE_VIOLATION = '23505'
// 0500: one non-deactivated portal account per email and per participant of a tenant.
const EMAIL_INDEX = 'user_account_portal_email_open'

interface Target {
  market_id: string
  email: string | null
  can_earn: boolean
  active: boolean
  pseudonymised: boolean
}

// The participant within the caller's scope of the permission, else 404 (D-B5-23: outside scope reads as unknown).
async function targetOf(tx: Tx, request: FastifyRequest, participantId: string, permission: Permission): Promise<Target> {
  const { rows } = await tx.query<Target>('SELECT * FROM portal_invite_target($1)', [participantId])
  const scope = marketScope(currentAuth(request), permission)
  const target = rows[0]
  if (target === undefined || (scope !== null && !scope.includes(target.market_id))) throw notFound()
  return target
}

interface Account {
  id: string
  state: 'invited' | 'active' | 'deactivated'
  email: string
  invited_at: Date | null
  last_sign_in_at: Date | null
  mfa_enrolled: boolean
}

// The participant's open account, else its latest deactivated one (a deactivated account is never reopened, D-B5-05).
async function accountOf(tx: Tx, participantId: string, lock = false): Promise<Account | undefined> {
  const { rows } = await tx.query<Account>(
    `SELECT u.id, u.state, u.email, u.last_sign_in_at, u.mfa_enrolled,
            (SELECT max(i.created_at) FROM user_invitation i WHERE i.user_id = u.id) AS invited_at
     FROM user_account u WHERE u.realm = 'portal' AND u.participant_id = $1
     ORDER BY u.state = 'deactivated', u.created_at DESC LIMIT 1${lock ? ' FOR UPDATE OF u' : ''}`,
    [participantId],
  )
  return rows[0]
}

function view(account: Account | undefined) {
  if (account === undefined) return { state: 'none', email_masked: null, invited_at: null, last_sign_in_at: null, mfa_enrolled: false }
  return {
    state: account.state, email_masked: maskContact({ email: account.email })!.email!, invited_at: account.invited_at,
    last_sign_in_at: account.last_sign_in_at, mfa_enrolled: account.mfa_enrolled,
  }
}

const notEligible = (reason: string) =>
  new ApiError(422, 'PORTAL_NOT_ELIGIBLE', 'This member cannot have a portal account.', { reason })

function assertEligible(target: Target): string {
  if (target.pseudonymised) throw notEligible('pseudonymised')
  if (!target.active) throw notEligible('inactive')
  if (!target.can_earn) throw notEligible('not_can_earn')
  if (target.email === null) throw notEligible('no_contact_email')
  return target.email.toLowerCase()
}

/**
 * Two people: whoever chose the member's contact e-mail never also sends the portal invitation to it, else one agent could
 * hand a member's account (and its payouts) to their own address. The address on record came from PARTICIPANT.CONTACT_RECORDED
 * when there is one (BUG-133 only records when none is on record), otherwise from the enrolment (PARTICIPANT.ENROLLED).
 */
async function assertNotContactRecorder(tx: Tx, participantId: string): Promise<void> {
  const { rows } = await tx.query<{ chose: boolean }>(
    `SELECT actor_id IS NOT DISTINCT FROM app_user_id() AS chose FROM audit.audit_event
      WHERE object_type = 'participant' AND object_id = $1 AND action IN ('PARTICIPANT.CONTACT_RECORDED', 'PARTICIPANT.ENROLLED')
      ORDER BY action = 'PARTICIPANT.CONTACT_RECORDED' DESC, occurred_at DESC LIMIT 1`,
    [participantId],
  )
  if (rows[0]?.chose === true) {
    throw new ApiError(422, 'SOD_SELF_APPROVAL', 'You entered this member’s contact e-mail, so another colleague sends the portal invitation.')
  }
}

// D-B5-05: an invited portal account with the contact email of now; the invitation mail goes to that address.
async function invite(tx: Tx, request: FastifyRequest, participantId: string) {
  const email = assertEligible(await targetOf(tx, request, participantId, 'participant.manage'))
  const existing = await accountOf(tx, participantId)
  if (existing !== undefined && existing.state !== 'deactivated') {
    throw new ApiError(409, 'PORTAL_ACCOUNT_EXISTS', 'This member already has a portal account.')
  }
  await assertNotContactRecorder(tx, participantId)
  let userId: string
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, realm, idp_subject, email, state, participant_id, created_by)
       VALUES (app_tenant_id(), 'portal', $1, $2, 'invited', $3, app_user_id()) RETURNING id`,
      [`local:${randomUUID()}`, email, participantId],
    )
    userId = rows[0]!.id
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string }
    if (code === UNIQUE_VIOLATION && constraint === EMAIL_INDEX) {
      throw new ApiError(409, 'PORTAL_EMAIL_IN_USE', "Another member's portal account uses this email.")
    }
    if (code === UNIQUE_VIOLATION) throw new ApiError(409, 'PORTAL_ACCOUNT_EXISTS', 'This member already has a portal account.')
    throw error
  }
  const invitedBy = currentAuth(request).userId
  await enqueue(tx, sendInvitationJob, { user_id: userId, invited_by: invitedBy })
  await recordAudit(tx, { action: 'PORTAL_ACCOUNT.INVITED', objectType: 'user_account', objectId: userId, after: { participant_id: participantId } })
  return { state: 'invited' as const }
}

/** D-B5-05 portal accounts on participants (SC-09 "Portal access"): status, invite, re-send, deactivate. */
export function registerPortalAccountRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')
  const manage = { preHandler: [tenant, requirePermission('participant.manage')] }

  app.get('/v1/participants/:id/portal-account', { preHandler: [tenant, requirePermission('participant.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, async (tx) => {
      await targetOf(tx, request, id, 'participant.read')
      return view(await accountOf(tx, id))
    }))
  })

  app.post('/v1/participants/:id/portal-account', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await invite(tx, request, id)) })))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participants/:id/portal-account/invitation', manage, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    await inTenant(request, async (tx) => {
      await targetOf(tx, request, id, 'participant.manage')
      const account = await accountOf(tx, id)
      if (account === undefined || account.state === 'deactivated') throw notFound()
      if (account.state === 'active') throw new ApiError(409, 'PORTAL_ACCOUNT_ACTIVE', 'This member has already set a password.')
      await enqueue(tx, sendInvitationJob, { user_id: account.id, invited_by: currentAuth(request).userId })
      await recordAudit(tx, { action: 'USER.INVITATION_REISSUED', objectType: 'user_account', objectId: account.id })
    })
    return reply.code(202).send(envelope({ state: 'invited' }))
  })

  // The state change revokes the account's sessions and the open invitation stops working (0040 trigger, SEC-34).
  app.post('/v1/participants/:id/portal-account/deactivate', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const { reason } = parse(deactivateBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      await targetOf(tx, request, id, 'participant.manage')
      const account = await accountOf(tx, id, true)
      if (account === undefined || account.state === 'deactivated') throw notFound()
      await tx.query(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [account.id])
      await tx.query('UPDATE user_invitation SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [account.id])
      await recordAudit(tx, {
        action: 'PORTAL_ACCOUNT.DEACTIVATED', objectType: 'user_account', objectId: account.id,
        before: { state: account.state }, after: { state: 'deactivated' }, reason,
      })
      return view({ ...account, state: 'deactivated' })
    }))
  })
}
