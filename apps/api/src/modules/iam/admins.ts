import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'

const ADMIN_PERMISSION = 'user.manage'

/** What is about to stop counting as an admin grant: all of a user's grants, or one assignment. */
export type AdminLoss = { readonly userId: string } | { readonly assignmentId: string }

const ACTIVE = 'ra.valid_from <= now() AND (ra.valid_to IS NULL OR ra.valid_to > now())'

/**
 * FR-IAM-003: the sole remaining admin cannot lose admin rights (deactivation or revocation), or nobody
 * could manage users or approve privileged grants again. 422 LAST_ADMIN. Every admin-loss decision of the
 * tenant takes the same transaction lock first, so two admins removing each other at once are decided one
 * after the other: the second check sees the first change committed.
 */
export async function assertAdminRemains(tx: Tx, loss: AdminLoss): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('iam.admins:' || app_tenant_id(), 0))`)
  const [column, id] = 'userId' in loss ? ['ra.user_id', loss.userId] : ['ra.id', loss.assignmentId]
  const { rows } = await tx.query<{ loses_admin: boolean; admin_remains: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM role_assignment ra JOIN role r ON r.id = ra.role_id
               WHERE ${column} = $1 AND ${ACTIVE} AND $2 = ANY (r.permissions)) AS loses_admin,
       EXISTS (SELECT 1 FROM role_assignment ra JOIN role r ON r.id = ra.role_id
               JOIN user_account u ON u.id = ra.user_id
               WHERE ${column} <> $1 AND u.state = 'active' AND ${ACTIVE} AND $2 = ANY (r.permissions)) AS admin_remains`,
    [id, ADMIN_PERMISSION],
  )
  const row = rows[0]!
  if (row.loses_admin && !row.admin_remains) {
    throw new ApiError(422, 'LAST_ADMIN', 'This would leave the tenant without an administrator.')
  }
}
