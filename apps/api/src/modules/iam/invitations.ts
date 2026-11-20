import { randomBytes } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import { z } from 'zod'
import type { Config } from '../../config.js'
import { auditInRealm, recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { defineTenantJob } from '../../lib/jobs.js'
import { sendMail, type Mail } from '../../lib/mailer.js'
import { hashPassword } from '../../lib/passwords.js'
import { hashToken } from '../../lib/session.js'
import { asUser } from './realm.js'

const TOKEN_BYTES = 32

export interface IssuedInvitation {
  readonly token: string
  readonly expires_at: Date
}

// Revokes the user's open invitations; stores only the token's SHA-256 and the inviter (created_by). In the vendor
// realm app_tenant_id() is NULL: a vendor user's invitation has no tenant (0042). invitedBy null = operator bootstrap
// (scripts/create-vendor-user.ts).
export async function issueInvitation(tx: Tx, userId: string, ttlHours: number, invitedBy: string | null): Promise<IssuedInvitation> {
  await tx.query(
    'UPDATE user_invitation SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL',
    [userId],
  )
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const { rows } = await tx.query<{ expires_at: Date }>(
    `INSERT INTO user_invitation (tenant_id, user_id, token_hash, expires_at, created_by)
     VALUES (app_tenant_id(), $1, $2, now() + make_interval(hours => $3), $4)
     RETURNING expires_at`,
    [userId, hashToken(token), ttlHours, invitedBy],
  )
  return { token, expires_at: rows[0]!.expires_at }
}

interface Invitee {
  email: string
  state: string
  tenant_name: string
  tenant_slug: string
  realm: string
  inviter: string | null
  time_zone: string
}

/**
 * The accept page's link. The token travels in the URL fragment, which browsers never send to a server or put in a
 * Referer; the tenant slug in the query lets the web prefill the company on sign-in after accepting, and realm=portal sends
 * a portal account to the portal sign-in (D-B5-03).
 */
export function invitationLink(webUrl: string, tenantSlug: string, token: string, portal = false): string {
  return `${webUrl}/invitation?tenant=${encodeURIComponent(tenantSlug)}${portal ? '&realm=portal' : ''}#token=${token}`
}

async function findInvitee(tx: Tx, userId: string, invitedBy: string): Promise<Invitee | undefined> {
  const { rows } = await tx.query<Invitee>(
    `SELECT u.email, u.state, u.realm, t.legal_name AS tenant_name, t.slug AS tenant_slug,
            (SELECT coalesce(i.display_name, i.email) FROM user_account i WHERE i.id = $2) AS inviter,
            coalesce((SELECT m.time_zone FROM market m WHERE m.tenant_id = t.id ORDER BY m.created_at, m.id LIMIT 1), 'UTC') AS time_zone
     FROM user_account u JOIN tenant t ON t.id = u.tenant_id WHERE u.id = $1`,
    [userId, invitedBy],
  )
  return rows[0]
}

/** BUG-112: a readable time in the tenant's first market zone, named (a tenant without a market reads UTC). */
const zonedTime = (at: Date, timeZone: string): string =>
  `${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(at)} (${timeZone})`

function invitationMail(config: Config, invitee: Invitee, invitation: IssuedInvitation): Mail {
  return {
    to: invitee.email,
    subject: `Your account at ${invitee.tenant_name}`,
    text: [
      `${invitee.inviter ?? 'An administrator'} invited you to ${invitee.tenant_name}.`,
      '',
      `Choose your password with this link. It works once, until ${zonedTime(invitation.expires_at, invitee.time_zone)}:`,
      invitationLink(config.webUrl, invitee.tenant_slug, invitation.token, invitee.realm === 'portal'),
      '',
      'If you did not expect this invitation, ignore this email.',
    ].join('\n'),
  }
}

/**
 * Initial password by one-time token, delivered only to the invitee's own address (FR-IAM-003 invite, SC-28
 * "Invitation sent"): the inviting admin never sees the token, so cannot choose the invitee's password. Users
 * no longer invited (accepted or deactivated meanwhile) are skipped. The mail is sent last: if sending fails,
 * the invitation rolls back with it and the queue retries.
 */
export const sendInvitationJob = defineTenantJob({
  name: 'iam.send-invitation',
  payload: z.strictObject({ user_id: z.uuid(), invited_by: z.uuid() }),
  async run(tx, payload, ctx) {
    const invitee = await findInvitee(tx, payload.user_id, payload.invited_by)
    if (invitee === undefined || invitee.state !== 'invited') return
    const invitation = await issueInvitation(tx, payload.user_id, ctx.config.invitationTtlHours, payload.invited_by)
    await recordAudit(tx, {
      action: 'USER.INVITATION_SENT', objectType: 'user_account', objectId: payload.user_id,
      after: { invited_by: payload.invited_by, expires_at: invitation.expires_at },
    })
    await sendMail(ctx.config.mailDir, invitationMail(ctx.config, invitee, invitation))
  },
})

const invalidInvitation = (): ApiError =>
  new ApiError(422, 'INVITATION_INVALID', 'This invitation link is not valid. Ask your administrator for a new one.')

/** Sets the invitee's password and activates the account, tenant or vendor user; the token works once (FR-IAM-003 invite). */
export async function acceptInvitation(token: string, password: string, requestId: string): Promise<void> {
  const { rows } = await withSystem((tx) =>
    tx.query<{ invitation_id: string; tenant_id: string | null; user_id: string }>(
      'SELECT * FROM auth_find_invitation($1)',
      [hashToken(token)],
    ),
  )
  const invitation = rows[0]
  if (invitation === undefined) throw invalidInvitation()
  const passwordHash = await hashPassword(password) // slow: hashed before the transaction opens
  const realm = invitation.tenant_id === null ? 'vendor' as const : 'tenant' as const
  // A portal invitee is activated in a staff transaction of its tenant (no session yet, so no participant scope).
  const user = { userId: invitation.user_id, tenantId: invitation.tenant_id, realm, participantId: null }
  await asUser(user, requestId, async (tx) => {
    const used = await tx.query(
      'UPDATE user_invitation SET used_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL',
      [invitation.invitation_id],
    )
    if (used.rowCount !== 1) throw invalidInvitation() // a concurrent request used it first
    await tx.query(
      `INSERT INTO password_credential (user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [invitation.user_id, passwordHash],
    )
    await tx.query(`UPDATE user_account SET state = 'active' WHERE id = $1 AND state = 'invited'`, [invitation.user_id])
    await auditInRealm(tx, realm, { action: 'USER.ACTIVATED', objectType: 'user_account', objectId: invitation.user_id })
  })
}
