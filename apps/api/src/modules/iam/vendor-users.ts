import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { Config } from '../../config.js'
import { recordVendorAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { sendMail } from '../../lib/mailer.js'
import { assertSameRequest, type VendorIdempotency } from '../support/index.js'
import { issueInvitation } from './invitations.js'

/** A vendor operations user (realm vendor, no tenant). Runs in the vendor realm: policy vendor_users. */
export interface VendorUserView {
  id: string
  email: string
  display_name: string | null
  state: string
  mfa_enrolled: boolean
  last_sign_in_at: Date | null
  created_at: Date
  created_by: string | null
}

const VENDOR_USER_SELECT =
  'SELECT id, email, display_name, state, mfa_enrolled, last_sign_in_at, created_at, created_by FROM user_account'
const UNIQUE_VIOLATION = '23505'

/** One page of vendor users, ordered by email. */
export async function listVendorUsers(tx: Tx, afterEmail: string | undefined, limit: number): Promise<VendorUserView[]> {
  const { rows } = await tx.query<VendorUserView>(
    `${VENDOR_USER_SELECT} WHERE realm = 'vendor' AND ($1::text IS NULL OR email > $1) ORDER BY email LIMIT $2`,
    [afterEmail ?? null, limit + 1],
  )
  return rows
}

async function getVendorUser(tx: Tx, userId: string): Promise<VendorUserView> {
  const { rows } = await tx.query<VendorUserView>(`${VENDOR_USER_SELECT} WHERE id = $1 AND realm = 'vendor'`, [userId])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

/** The accept page's link for a vendor user: no tenant to prefill, so the web signs them in at /signin/vendor. */
export function vendorInvitationLink(webUrl: string, token: string): string {
  return `${webUrl}/invitation?realm=vendor#token=${token}`
}

/**
 * A one-time invitation mailed to the vendor user, sent last in the transaction: a failed send rolls the invitation
 * back. shortcut: sent in the request, not by a job (jobs run in a tenant); a commit failing after the send leaves a
 * dead link, as for tenant invitations. Move to a vendor job if mail ever leaves the local drop.
 */
async function sendVendorInvitation(tx: Tx, config: Config, user: VendorUserView, invitedBy: string): Promise<void> {
  const invitation = await issueInvitation(tx, user.id, config.invitationTtlHours, invitedBy)
  await recordVendorAudit(tx, {
    action: 'USER.INVITATION_SENT', objectType: 'user_account', objectId: user.id,
    after: { invited_by: invitedBy, expires_at: invitation.expires_at },
  })
  await sendMail(config.mailDir, {
    to: user.email,
    subject: 'Your vendor operations account',
    text: [
      'You were invited to the vendor operations console.',
      '',
      `Choose your password with this link. It works once, until ${invitation.expires_at.toISOString()}:`,
      vendorInvitationLink(config.webUrl, invitation.token),
      '',
      'If you did not expect this invitation, ignore this email.',
    ].join('\n'),
  })
}

export interface NewVendorUser {
  readonly email: string
  readonly displayName: string | null
  readonly invitedBy: string
}

async function replay(tx: Tx, invitedBy: string, idempotency: VendorIdempotency): Promise<VendorUserView | null> {
  const { rows } = await tx.query<{ id: string; request_hash: Buffer }>(
    'SELECT id, request_hash FROM user_account WHERE created_by = $1 AND idempotency_key = $2',
    [invitedBy, idempotency.key],
  )
  if (rows[0] === undefined) return null
  assertSameRequest(rows[0].request_hash, idempotency)
  return getVendorUser(tx, rows[0].id)
}

async function insertVendorUser(tx: Tx, input: NewVendorUser, idempotency: VendorIdempotency): Promise<string | null> {
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by, idempotency_key, request_hash)
       VALUES (NULL, 'vendor', $1, $2, $3, 'invited', $4, $5, $6)
       ON CONFLICT (created_by, idempotency_key) DO NOTHING RETURNING id`,
      [`local:${randomUUID()}`, input.email, input.displayName, input.invitedBy, idempotency.key, idempotency.hash],
    )
    return rows[0]?.id ?? null
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'A vendor user with this email already exists.')
    }
    throw error
  }
}

/**
 * BUG-011: a vendor user invites another one (step-up checked by the route), so FR-TEN-001's second person exists in
 * the product. The invitee sets a password through the invitation and enrols MFA at first sign-in (SEC-03). Logged in
 * the vendor log. A replay of the same request returns the user as it is now and sends nothing.
 */
export async function inviteVendorUser(
  tx: Tx, config: Config, input: NewVendorUser, idempotency: VendorIdempotency,
): Promise<{ user: VendorUserView; replayed: boolean }> {
  const earlier = await replay(tx, input.invitedBy, idempotency)
  if (earlier !== null) return { user: earlier, replayed: true }
  const id = await insertVendorUser(tx, input, idempotency)
  if (id === null) return { user: (await replay(tx, input.invitedBy, idempotency))!, replayed: true }
  const user = await getVendorUser(tx, id)
  await recordVendorAudit(tx, { action: 'USER.INVITED', objectType: 'user_account', objectId: id })
  await sendVendorInvitation(tx, config, user, input.invitedBy)
  return { user, replayed: false }
}

/** A new link for a vendor user who has not accepted yet; earlier links stop working. */
export async function reissueVendorInvitation(tx: Tx, config: Config, userId: string, invitedBy: string): Promise<VendorUserView> {
  const user = await getVendorUser(tx, userId)
  if (user.state !== 'invited') {
    throw new ApiError(409, 'USER_NOT_INVITED', 'This user has already accepted an invitation or is not active.')
  }
  await sendVendorInvitation(tx, config, user, invitedBy)
  return user
}

/**
 * Deactivates a vendor user (step-up checked by the route); the database revokes their sessions (0040). Never the last
 * active vendor user, or nobody could sign in to the console (422 LAST_VENDOR_USER). Serialised like admin removals.
 */
export async function deactivateVendorUser(tx: Tx, userId: string): Promise<VendorUserView> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('iam.vendor-users', 0))`)
  const user = await getVendorUser(tx, userId)
  if (user.state === 'deactivated') return user
  const { rows } = await tx.query<{ others: number }>(
    `SELECT count(*)::int AS others FROM user_account WHERE realm = 'vendor' AND state = 'active' AND id <> $1`,
    [userId],
  )
  if (rows[0]!.others === 0) throw new ApiError(422, 'LAST_VENDOR_USER', 'This would leave no vendor user who can sign in.')
  await tx.query(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [userId])
  await tx.query('UPDATE user_invitation SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [userId])
  await recordVendorAudit(tx, {
    action: 'USER.DEACTIVATED', objectType: 'user_account', objectId: userId, before: { state: user.state }, after: { state: 'deactivated' },
  })
  return getVendorUser(tx, userId)
}
