// Separation of duties (FR-IAM-004, D-B1-03): the one approval primitive every approvable object uses. The SQL CHECK
// approval_approver_is_not_preparer stays the database backstop.
import type { Tx } from './pool.js'

export interface EligibleApprover {
  readonly user_id: string
  readonly display_name: string | null
  readonly email: string
}

export interface ApprovalInput {
  /** 'setting_change_request' | 'market_go_live_request' | 'case' | later types. */
  readonly objectType: string
  readonly objectId: string
  readonly preparerId: string
  readonly contributorIds: readonly string[]
  /** Beneficiary payees and declared related parties; B1 callers pass []. */
  readonly excludedIds: readonly string[]
  readonly decision: 'approved' | 'rejected'
  readonly reason: string | null
  /** auth.stepUpAt of the approver. */
  readonly factorVerifiedAt: Date | null
  /** Used to list eligible approvers on refusal. */
  readonly approverPermission: string
  readonly marketId: string | null
  /** A tenant-wide object: only holders of approverPermission for all markets are eligible. */
  readonly allMarkets?: boolean
}

export type ApprovalOutcome =
  | { readonly ok: true; readonly approvalId: string; readonly decidedAt: Date }
  | { readonly ok: false; readonly reasonCode: 'SOD-01'; readonly eligibleApprovers: readonly EligibleApprover[] }

/**
 * Active users of the transaction's tenant who may approve with the permission over the market, minus the excluded.
 * allMarkets: only holders of the permission for all markets (tenant-wide objects); otherwise a null market means any.
 */
export async function eligibleApprovers(
  tx: Tx,
  q: { permission: string; marketId: string | null; excludeUserIds: readonly string[]; allMarkets?: boolean },
): Promise<EligibleApprover[]> {
  const { rows } = await tx.query<EligibleApprover>(
    'SELECT user_id, display_name, email FROM approval_eligible_users($1, $2, $3::uuid[], $4)',
    [q.permission, q.marketId, q.excludeUserIds, q.allMarkets ?? false],
  )
  return rows
}

/**
 * Approver = app.user_id of the transaction. Refuses (no row) when the approver is the preparer, a contributor or
 * excluded; eligibleApprovers then excludes all three, and an empty list is a valid refusal payload (AC-IAM4-4).
 */
export async function recordApproval(tx: Tx, input: ApprovalInput): Promise<ApprovalOutcome> {
  const { rows: acting } = await tx.query<{ id: string | null }>('SELECT app_user_id() AS id')
  const approverId = acting[0]?.id ?? null
  if (approverId === null) throw new Error('recordApproval needs a transaction with an acting user (app.user_id)')
  const barred = [...new Set([input.preparerId, ...input.contributorIds, ...input.excludedIds])]
  if (barred.includes(approverId)) {
    const eligible = await eligibleApprovers(tx, {
      permission: input.approverPermission, marketId: input.marketId, excludeUserIds: barred, allMarkets: input.allMarkets,
    })
    return { ok: false, reasonCode: 'SOD-01', eligibleApprovers: eligible }
  }
  const { rows } = await tx.query<{ id: string; decided_at: Date }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, reason,
                           factor_verified_at, decided_at, created_by)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, now(), $4) RETURNING id, decided_at`,
    [input.objectType, input.objectId, input.preparerId, approverId, input.decision, input.reason, input.factorVerifiedAt],
  )
  return { ok: true, approvalId: rows[0]!.id, decidedAt: rows[0]!.decided_at }
}
