import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { Config } from '../../config.js'
import { recordVendorAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { sendMail } from '../../lib/mailer.js'
import { assertSameRequest, type VendorIdempotency } from '../support/index.js'
import { issueInvitation } from './invitations.js'
import { assertSecondPerson } from './second-person.js'

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
  /** BUG-031: null for bootstrap users (seed, CLI), who have no inviter. */
  invitation_status: 'pending_approval' | 'approved' | 'rejected' | null
  invitation_decided_by: string | null
  invitation_decided_at: Date | null
}

const VENDOR_USER_SELECT = `SELECT id, email, display_name, state, mfa_enrolled, last_sign_in_at, created_at, created_by,
  CASE WHEN created_by IS NOT NULL AND invitation_decision IS NULL AND state = 'invited' THEN 'pending_approval'
       ELSE invitation_decision END AS invitation_status,
  invitation_decided_by, invitation_decided_at
  FROM user_account`
const UNIQUE_VIOLATION = '23505'

/** Sort key of the vendor-user list: an address may recur (a closed user re-invited, 0044), so the id breaks ties. */
export type VendorUserCursor = readonly [email: string, id: string]

/** One page of vendor users, ordered by email, then id. */
export async function listVendorUsers(tx: Tx, after: VendorUserCursor | undefined, limit: number): Promise<VendorUserView[]> {
  const { rows } = await tx.query<VendorUserView>(
    `${VENDOR_USER_SELECT} WHERE realm = 'vendor' AND ($1::text IS NULL OR (email, id) > ($1, $2::uuid)) ORDER BY email, id LIMIT $3`,
    [after?.[0] ?? null, after?.[1] ?? null, limit + 1],
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
      throw new ApiError(409, 'EMAIL_TAKEN', 'A vendor user with this email already exists and is not deactivated.')
    }
    throw error
  }
}

/**
 * BUG-011: a vendor user invites another one (step-up checked by the route), so FR-TEN-001's second person exists in
 * the product. BUG-031: the invitation stays pending, with no token and no mail, until an independent second vendor
 * user approves it (decideVendorInvitation). Logged in the vendor log. A replay returns the user as it is now.
 */
export async function inviteVendorUser(
  tx: Tx, config: Config, input: NewVendorUser, idempotency: VendorIdempotency,
): Promise<{ user: VendorUserView; replayed: boolean }> {
  const earlier = await replay(tx, input.invitedBy, idempotency)
  if (earlier !== null) return { user: earlier, replayed: true }
  const id = await insertVendorUser(tx, input, idempotency)
  if (id === null) return { user: (await replay(tx, input.invitedBy, idempotency))!, replayed: true }
  const user = await getVendorUser(tx, id)
  await recordVendorAudit(tx, { action: 'USER.INVITED', objectType: 'user_account', objectId: id, after: { invitation_status: 'pending_approval' } })
  return { user, replayed: false }
}

export interface InvitationDecision {
  readonly userId: string
  readonly deciderId: string
  readonly approved: boolean
}

async function decisionReplay(tx: Tx, deciderId: string, idempotency: VendorIdempotency): Promise<VendorUserView | null> {
  const { rows } = await tx.query<{ id: string; decision_request_hash: Buffer }>(
    'SELECT id, decision_request_hash FROM user_account WHERE invitation_decided_by = $1 AND decision_idempotency_key = $2',
    [deciderId, idempotency.key],
  )
  if (rows[0] === undefined) return null
  assertSameRequest(rows[0].decision_request_hash, idempotency)
  return getVendorUser(tx, rows[0].id)
}

// Rejection closes the account (0043: a rejected vendor user is deactivated and can never be approved).
async function recordDecision(tx: Tx, decision: InvitationDecision, idempotency: VendorIdempotency): Promise<void> {
  try {
    await tx.query(
      `UPDATE user_account SET invitation_decision = $2, invitation_decided_by = $3, invitation_decided_at = now(),
         decision_idempotency_key = $4, decision_request_hash = $5,
         state = CASE WHEN $2 = 'rejected' THEN 'deactivated' ELSE state END
       WHERE id = $1`,
      [decision.userId, decision.approved ? 'approved' : 'rejected', decision.deciderId, idempotency.key, idempotency.hash],
    )
  } catch (error) {
    // The same key is being used at this moment to decide another invitation.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.')
    }
    throw error
  }
}

/**
 * BUG-031: a vendor user other than the inviter, and independent of them, approves or rejects a pending vendor-user
 * invitation (step-up and Idempotency-Key checked by the route). Approval sends the invitation mail; rejection closes
 * the account. Both are logged in the vendor log; a replay returns the user as it is now and sends nothing.
 */
export async function decideVendorInvitation(
  tx: Tx, config: Config, decision: InvitationDecision, idempotency: VendorIdempotency,
): Promise<{ user: VendorUserView; replayed: boolean }> {
  const locked = await tx.query(`SELECT 1 FROM user_account WHERE id = $1 AND realm = 'vendor' FOR UPDATE`, [decision.userId])
  if (locked.rowCount !== 1) throw notFound()
  const earlier = await decisionReplay(tx, decision.deciderId, idempotency)
  if (earlier !== null) return { user: earlier, replayed: true }
  const user = await getVendorUser(tx, decision.userId)
  if (user.invitation_status !== 'pending_approval') {
    throw new ApiError(409, 'REQUEST_ALREADY_DECIDED', 'This invitation is not waiting for a decision.')
  }
  const action = decision.approved ? 'USER.INVITATION_APPROVED' : 'USER.INVITATION_REJECTED'
  await assertSecondPerson(tx, { actorId: decision.deciderId, initiatorId: user.created_by, action })
  await recordDecision(tx, decision, idempotency)
  const decided = await getVendorUser(tx, decision.userId)
  await recordVendorAudit(tx, {
    action, objectType: 'user_account', objectId: user.id,
    before: { state: user.state, invitation_status: user.invitation_status },
    after: { state: decided.state, invitation_status: decided.invitation_status, invited_by: user.created_by },
  })
  if (decision.approved) await sendVendorInvitation(tx, config, decided, decision.deciderId)
  return { user: decided, replayed: false }
}

export interface BootstrapVendorUser {
  readonly email: string
  readonly displayName: string | null
  /** Who ran the CLI, for the vendor log: the OS account and host (the system actor names no person). */
  readonly operator: { readonly osUser: string; readonly host: string }
}

/** Two independent vendor users are the minimum for two-person control; past that, vendor users are invited in-product. */
export const MAX_BOOTSTRAP_USERS = 2

// Vendor users who can sign in or are about to: all but the closed ones and invitations still waiting for approval.
async function usableVendorUsers(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ usable: number }>(
    `SELECT count(*)::int AS usable FROM user_account
     WHERE realm = 'vendor' AND state <> 'deactivated'
       AND NOT (state = 'invited' AND created_by IS NOT NULL AND invitation_decision IS NULL)`,
  )
  return rows[0]!.usable
}

/**
 * BUG-031 bootstrap, for the operator CLI only (scripts/create-vendor-user.ts; the seed writes its users directly): a
 * vendor user with no inviter, so no approval, and a one-time password-set link returned to the caller, never mailed.
 * The account is active once the password is set (the accept page); MFA enrolment follows at first sign-in. Must run
 * as the system actor: the database refuses an inviter-less vendor user created by a vendor user (0043). Refused once
 * MAX_BOOTSTRAP_USERS usable vendor users exist, so server access alone cannot mint a supply of "second persons".
 */
export async function bootstrapVendorUser(tx: Tx, config: Config, input: BootstrapVendorUser): Promise<{ userId: string; link: string }> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('iam.vendor-users', 0))`)
  if ((await usableVendorUsers(tx)) >= MAX_BOOTSTRAP_USERS) {
    throw new Error(`${MAX_BOOTSTRAP_USERS} vendor users already exist; invite further vendor users in the console (a second vendor user approves)`)
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by)
     VALUES (NULL, 'vendor', $1, $2, $3, 'invited', NULL) ON CONFLICT DO NOTHING RETURNING id`,
    [`local:${randomUUID()}`, input.email, input.displayName],
  )
  const userId = rows[0]?.id
  if (userId === undefined) throw new Error(`a vendor user with the email ${input.email} already exists`)
  const invitation = await issueInvitation(tx, userId, config.invitationTtlHours, null)
  await recordVendorAudit(tx, {
    action: 'USER.BOOTSTRAPPED', objectType: 'user_account', objectId: userId,
    after: { method: 'operator_cli', os_user: input.operator.osUser, host: input.operator.host, password_link_expires_at: invitation.expires_at },
  })
  return { userId, link: vendorInvitationLink(config.webUrl, invitation.token) }
}

/** A new link for a vendor user who has not accepted yet; earlier links stop working. */
export async function reissueVendorInvitation(tx: Tx, config: Config, userId: string, invitedBy: string): Promise<VendorUserView> {
  const user = await getVendorUser(tx, userId)
  if (user.state !== 'invited') {
    throw new ApiError(409, 'USER_NOT_INVITED', 'This user has already accepted an invitation or is not active.')
  }
  if (user.invitation_status === 'pending_approval') {
    throw new ApiError(409, 'INVITATION_NOT_APPROVED', 'A second vendor user must approve this invitation before it is sent.')
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
