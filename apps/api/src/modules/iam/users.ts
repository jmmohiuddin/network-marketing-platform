import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { enqueue } from '../../lib/jobs.js'
import { assertAdminRemains } from './admins.js'
import { sendInvitationJob } from './invitations.js'

export interface UserView {
  id: string
  email: string
  display_name: string | null
  state: string
  mfa_enrolled: boolean
  last_sign_in_at: Date | null
  created_at: Date
  roles: { assignment_id: string; role_id: string; name: string; market_ids: string[] | null; valid_to: string | null }[]
}

const USER_SELECT = `
  SELECT u.id, u.email, u.display_name, u.state, u.mfa_enrolled, u.last_sign_in_at, u.created_at,
    coalesce((SELECT json_agg(json_build_object('assignment_id', ra.id, 'role_id', r.id, 'name', r.name,
                'market_ids', ra.market_ids, 'valid_to', ra.valid_to) ORDER BY r.name, ra.id)
              FROM role_assignment ra JOIN role r ON r.id = ra.role_id
              WHERE ra.user_id = u.id AND ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())),
             '[]'::json) AS roles
  FROM user_account u`

/** One page of the tenant's users, ordered by email (RLS limits rows to the caller's tenant). */
export async function listUsers(tx: Tx, afterEmail: string | undefined, limit: number): Promise<UserView[]> {
  const { rows } = await tx.query<UserView>(
    `${USER_SELECT} WHERE ($1::text IS NULL OR u.email > $1) ORDER BY u.email LIMIT $2`,
    [afterEmail ?? null, limit + 1],
  )
  return rows
}

export async function getUser(tx: Tx, userId: string): Promise<UserView> {
  const { rows } = await tx.query<UserView>(`${USER_SELECT} WHERE u.id = $1`, [userId])
  const user = rows[0]
  if (user === undefined) throw notFound()
  return user
}

const UNIQUE_VIOLATION = '23505'

export interface InviteInput {
  readonly email: string
  readonly displayName: string | null
  readonly invitedBy: string
}

/** API-40 invite: an invited user (no password, no roles); sendInvitationJob mails the one-time link to them. */
export async function inviteUser(tx: Tx, input: InviteInput): Promise<UserView> {
  let userId: string
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO user_account (tenant_id, realm, idp_subject, email, display_name, state, created_by)
       VALUES (app_tenant_id(), 'tenant', $1, $2, $3, 'invited', current_setting('app.user_id')::uuid)
       RETURNING id`,
      [`local:${randomUUID()}`, input.email, input.displayName],
    )
    userId = rows[0]!.id
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'A user with this email already exists in this tenant.')
    }
    throw error
  }
  await enqueue(tx, sendInvitationJob, { user_id: userId, invited_by: input.invitedBy })
  await recordAudit(tx, { action: 'USER.INVITED', objectType: 'user_account', objectId: userId })
  return getUser(tx, userId)
}

/** Mails a new invitation to a user who has not accepted yet; earlier links stop working once it is issued. */
export async function reissueInvitation(tx: Tx, userId: string, invitedBy: string): Promise<UserView> {
  const user = await getUser(tx, userId)
  if (user.state !== 'invited') {
    throw new ApiError(409, 'USER_NOT_INVITED', 'This user has already accepted an invitation or is not active.')
  }
  await enqueue(tx, sendInvitationJob, { user_id: userId, invited_by: invitedBy })
  await recordAudit(tx, { action: 'USER.INVITATION_REISSUED', objectType: 'user_account', objectId: userId })
  return user
}

/** Deactivates a user, revokes their sessions and open invitations (SEC-34). Not the last admin. */
export async function deactivateUser(tx: Tx, userId: string): Promise<UserView> {
  const user = await getUser(tx, userId)
  if (user.state === 'deactivated') return user
  await assertAdminRemains(tx, { userId })
  await tx.query(`UPDATE user_account SET state = 'deactivated' WHERE id = $1`, [userId])
  await tx.query('UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId])
  await tx.query(
    'UPDATE user_invitation SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL',
    [userId],
  )
  await recordAudit(tx, {
    action: 'USER.DEACTIVATED', objectType: 'user_account', objectId: userId, before: { state: user.state }, after: { state: 'deactivated' },
  })
  return getUser(tx, userId)
}
