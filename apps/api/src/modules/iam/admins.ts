import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'

const ADMIN_PERMISSION = 'user.manage'

/** What is about to stop counting as an admin grant: all of a user's grants, or one assignment. */
export type AdminLoss = { readonly userId: string } | { readonly assignmentId: string }

const ACTIVE = 'ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())'

/**
 * FR-IAM-003, QA E-SEC-03: admin rights cannot be removed (deactivation or revocation) when fewer than two active
 * admins would remain: with none, nobody could manage users (422 LAST_ADMIN);
 * with one, that admin could never get a privileged grant approved, since a grant needs a second admin who neither
 * requested nor receives it (422 SECOND_ADMIN_REQUIRED, BUG-014). Every admin-loss decision of the tenant takes the
 * same transaction lock first, so two removals at once are decided one after the other.
 */
export async function assertAdminRemains(tx: Tx, loss: AdminLoss): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('iam.admins:' || app_tenant_id(), 0))`)
  const [column, id] = 'userId' in loss ? ['ra.user_id', loss.userId] : ['ra.id', loss.assignmentId]
  const { rows } = await tx.query<{ loses_admin: boolean; admins_left: number }>(
    `SELECT
       EXISTS (SELECT 1 FROM role_assignment ra JOIN role r ON r.id = ra.role_id
               WHERE ${column} = $1 AND ${ACTIVE} AND $2 = ANY (r.permissions)) AS loses_admin,
       (SELECT count(DISTINCT ra.user_id)::int FROM role_assignment ra JOIN role r ON r.id = ra.role_id
               JOIN user_account u ON u.id = ra.user_id
               WHERE ${column} <> $1 AND u.state = 'active' AND ${ACTIVE} AND $2 = ANY (r.permissions)) AS admins_left`,
    [id, ADMIN_PERMISSION],
  )
  const row = rows[0]!
  if (!row.loses_admin) return
  if (row.admins_left === 0) throw new ApiError(422, 'LAST_ADMIN', 'This would leave the tenant without an administrator.')
  if (row.admins_left === 1) {
    throw new ApiError(422, 'SECOND_ADMIN_REQUIRED',
      'This would leave one administrator, who could not get admin or approver grants approved. Add another administrator first.')
  }
}
