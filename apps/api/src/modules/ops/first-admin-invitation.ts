import { randomBytes } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { defineTenantJob } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { hashToken } from '../../lib/session.js'

const TOKEN_BYTES = 32

interface Invitee {
  email: string
  state: string
  tenant_name: string
}

async function findInvitee(tx: Tx, userId: string): Promise<Invitee | undefined> {
  const { rows } = await tx.query<Invitee>(
    `SELECT u.email, u.state, t.legal_name AS tenant_name FROM user_account u JOIN tenant t ON t.id = u.tenant_id
     WHERE u.id = $1`,
    [userId],
  )
  return rows[0]
}

// One open invitation per user: earlier links stop working. Only the token's SHA-256 is stored.
async function issueInvitation(tx: Tx, userId: string, ttlHours: number, invitedBy: string) {
  await tx.query(
    'UPDATE user_invitation SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL',
    [userId],
  )
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const { rows } = await tx.query<{ expires_at: Date }>(
    `INSERT INTO user_invitation (tenant_id, user_id, token_hash, expires_at, created_by)
     VALUES (app_tenant_id(), $1, $2, now() + make_interval(hours => $3), $4) RETURNING expires_at`,
    [userId, hashToken(token), ttlHours, invitedBy],
  )
  return { token, expiresAt: rows[0]!.expires_at }
}

/**
 * FR-TEN-001 "first admin invitation", queued when a second vendor user approves the provisioning. The
 * invitee sets a password through POST /v1/auth/invitations/accept, as for any invitation.
 * shortcut: repeats iam's invitation issue (iam/index.ts exports no invitation facade); enqueue iam's
 * invitation job instead once iam exports it.
 */
export const sendFirstAdminInvitationJob = defineTenantJob({
  name: 'ops.send-first-admin-invitation',
  payload: z.strictObject({ user_id: z.uuid(), invited_by: z.uuid() }),
  async run(tx, payload, ctx) {
    const invitee = await findInvitee(tx, payload.user_id)
    if (invitee === undefined || invitee.state !== 'invited') return
    const invitation = await issueInvitation(tx, payload.user_id, ctx.config.invitationTtlHours, payload.invited_by)
    await recordAudit(tx, {
      action: 'USER.INVITATION_SENT', objectType: 'user_account', objectId: payload.user_id,
      after: { invited_by: payload.invited_by, expires_at: invitation.expiresAt },
    })
    // Sent last: if sending fails, the invitation rolls back with it and the queue retries.
    await sendMail(ctx.config.mailDir, {
      to: invitee.email,
      subject: `Your administrator account at ${invitee.tenant_name}`,
      text: [
        `You are the first administrator of ${invitee.tenant_name}.`,
        '',
        `Choose your password with this link. It works once, until ${invitation.expiresAt.toISOString()}:`,
        `${ctx.config.webUrl}/invitation#token=${invitation.token}`,
        '',
        'If you did not expect this invitation, ignore this email.',
      ].join('\n'),
    })
  },
})
