import { eligibleApprovers, type EligibleApprover, type Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertAllMarkets, hasPermission, type AuthContext } from '../../lib/auth.js'
import { ApiError, notFound, permissionDenied } from '../../lib/errors.js'
import type { Envelope } from '../../lib/http.js'
import { decodeCursor, toPage } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { CHANGE_REQUEST_COLUMNS, assertEffectiveFrom, type ChangeRequestRow } from './settings-write.js'
import { approveOrRefuse } from './sod.js'
import { isSettingKey, SETTINGS } from './settings.js'
import { appendVersion } from './versions.js'

const OBJECT_TYPE = 'setting_change_request'

interface Person {
  id: string
  display_name: string | null
}

export interface ChangeRequestView {
  id: string
  key: string
  value: unknown
  effective_from: Date
  reason: string
  base_version: number
  state: ChangeRequestRow['state']
  requested_by: Person
  requested_at: Date
  decided_by: Person | null
  decided_at: Date | null
  decision_reason: string | null
  version: number | null
  eligible_approvers: readonly EligibleApprover[]
  no_eligible_approver: boolean
}

const VIEW_SELECT = `
  SELECT r.id, r.key, r.value, r.effective_from, r.reason, r.base_version, r.state, r.requested_by, r.requested_at,
         r.decided_by, r.decided_at, r.decision_reason, ru.display_name AS requested_by_name,
         du.display_name AS decided_by_name, v.version
  FROM setting_change_request r
  JOIN user_account ru ON ru.id = r.requested_by
  LEFT JOIN user_account du ON du.id = r.decided_by
  LEFT JOIN tenant_setting_version v ON v.id = r.version_id`

type ViewRow = Omit<ChangeRequestRow, 'approval_id' | 'version_id'> & {
  requested_by_name: string | null
  decided_by_name: string | null
  version: number | null
}

/** Who decides a change of the key (D-B2-08); null for a key no longer needing (or no longer having) an approval. */
function approverOf(key: string): Permission | null {
  return isSettingKey(key) ? SETTINGS[key].approverPermission : null
}

/** The key's approver permission, held by the caller for all markets (else 403). */
function approverFor(auth: AuthContext, key: string): Permission {
  const permission = approverOf(key)
  if (permission === null || !hasPermission(auth, permission)) throw permissionDenied()
  assertAllMarkets(auth, permission)
  return permission
}

async function toView(tx: Tx, row: ViewRow): Promise<ChangeRequestView> {
  const permission = approverOf(row.key)
  const eligible = row.state === 'pending' && permission !== null
    ? await eligibleApprovers(tx, { permission, marketId: null, excludeUserIds: [row.requested_by], allMarkets: true })
    : []
  return {
    id: row.id, key: row.key, value: row.value, effective_from: row.effective_from, reason: row.reason,
    base_version: row.base_version, state: row.state,
    requested_by: { id: row.requested_by, display_name: row.requested_by_name }, requested_at: row.requested_at,
    decided_by: row.decided_by === null ? null : { id: row.decided_by, display_name: row.decided_by_name },
    decided_at: row.decided_at, decision_reason: row.decision_reason, version: row.version,
    eligible_approvers: eligible, no_eligible_approver: row.state === 'pending' && eligible.length === 0,
  }
}

export async function changeRequestView(tx: Tx, id: string): Promise<ChangeRequestView> {
  const { rows } = await tx.query<ViewRow>(`${VIEW_SELECT} WHERE r.id = $1`, [id])
  if (rows[0] === undefined) throw notFound()
  return toView(tx, rows[0])
}

const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()])

/** GET /v1/setting-change-requests: newest first, of the keys the caller reads; pending only unless state=all. */
export async function listChangeRequests(
  tx: Tx, query: { state: 'pending' | 'all'; cursor?: string; limit: number; keys: readonly string[] },
): Promise<Envelope<ChangeRequestView[]>> {
  const after = decodeCursor(query.cursor, cursorSchema)
  const { rows } = await tx.query<ViewRow>(
    `${VIEW_SELECT}
     WHERE ($1 = 'all' OR r.state = 'pending') AND r.key = ANY ($5::text[])
       AND ($2::timestamptz IS NULL OR (r.requested_at, r.id) < ($2::timestamptz, $3::uuid))
     ORDER BY r.requested_at DESC, r.id DESC LIMIT $4`,
    [query.state, after?.[0] ?? null, after?.[1] ?? null, query.limit + 1, query.keys],
  )
  const views = await Promise.all(rows.map((row) => toView(tx, row)))
  return toPage(views, query.limit, (view) => [view.requested_at.toISOString(), view.id])
}

async function lockRequest(tx: Tx, id: string): Promise<ChangeRequestRow> {
  const { rows } = await tx.query<ChangeRequestRow>(`SELECT ${CHANGE_REQUEST_COLUMNS} FROM setting_change_request WHERE id = $1 FOR UPDATE`, [id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

function assertPending(row: ChangeRequestRow): void {
  if (row.state !== 'pending') throw new ApiError(409, 'CHANGE_NOT_PENDING', 'This change request is already decided or withdrawn.', { state: row.state })
}

async function lockPending(tx: Tx, id: string): Promise<ChangeRequestRow> {
  const row = await lockRequest(tx, id)
  assertPending(row)
  return row
}

export interface Decision {
  readonly decision: 'approve' | 'reject'
  readonly reason: string
  /** auth.stepUpAt of the approver. */
  readonly factorVerifiedAt: Date | null
}

/**
 * AC-TEN3-2/3: a holder of the key's approverPermission for all markets (Finance approver for money keys, DPO for the
 * visibility policy, D-B2-08) who did not request it decides; approval re-validates the date (a request whose date has
 * passed or fallen into a committed period stays pending) and appends the version carrying the approval.
 */
export async function decideChangeRequest(
  tx: Tx, id: string, decision: Decision, auth: AuthContext,
): Promise<{ change_request: ChangeRequestView; version: number | null }> {
  const request = await lockRequest(tx, id)
  const permission = approverFor(auth, request.key) // before the state: a caller who may not decide learns no state
  assertPending(request)
  const approve = decision.decision === 'approve'
  const approval = await approveOrRefuse(tx, {
    objectType: OBJECT_TYPE, objectId: request.id, preparerId: request.requested_by, contributorIds: [], excludedIds: [],
    decision: approve ? 'approved' : 'rejected', reason: decision.reason, factorVerifiedAt: decision.factorVerifiedAt,
    approverPermission: permission, marketId: null, allMarkets: true,
  })
  let versionId: string | null = null
  let version: number | null = null
  if (approve) {
    await assertEffectiveFrom(tx, request.effective_from)
    const appended = await appendVersion(tx, {
      effectiveFrom: request.effective_from, patch: { [request.key]: request.value }, reason: request.reason,
      approvalId: approval.approvalId, key: request.key, createdBy: request.requested_by,
    })
    versionId = appended.id
    version = appended.version
  }
  await tx.query(
    `UPDATE setting_change_request SET state = $2, decided_by = current_setting('app.user_id')::uuid, decided_at = $3,
       decision_reason = $4, approval_id = $5, version_id = $6 WHERE id = $1`,
    [id, approve ? 'approved' : 'rejected', approval.decidedAt, decision.reason, approval.approvalId, versionId],
  )
  await recordAudit(tx, {
    action: approve ? 'SETTINGS.CHANGE_APPROVED' : 'SETTINGS.CHANGE_REJECTED', objectType: OBJECT_TYPE, objectId: id,
    before: { state: 'pending' }, after: { state: approve ? 'approved' : 'rejected', key: request.key, approval_id: approval.approvalId, version },
    reason: decision.reason,
  })
  return { change_request: await changeRequestView(tx, id), version }
}

/** The requester withdraws its own pending request (decided_by stays NULL); other users see 404. */
export async function withdrawChangeRequest(tx: Tx, id: string, reason: string): Promise<ChangeRequestView> {
  const { rows } = await tx.query<{ requested_by: string }>(
    `SELECT requested_by FROM setting_change_request WHERE id = $1 AND requested_by = current_setting('app.user_id')::uuid`,
    [id],
  )
  if (rows[0] === undefined) throw notFound()
  const request = await lockPending(tx, id)
  await tx.query(`UPDATE setting_change_request SET state = 'withdrawn', decided_at = now(), decision_reason = $2 WHERE id = $1`, [id, reason])
  await recordAudit(tx, {
    action: 'SETTINGS.CHANGE_WITHDRAWN', objectType: OBJECT_TYPE, objectId: id,
    before: { state: 'pending' }, after: { state: 'withdrawn', key: request.key }, reason,
  })
  return changeRequestView(tx, id)
}
