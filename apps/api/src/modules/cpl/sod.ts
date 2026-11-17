import { eligibleApprovers, recordApproval, type ApprovalInput, type EligibleApprover, type Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit } from '../../lib/audit.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { idempotent, type IdempotentResult, type StoredResponse } from '../../lib/idempotency.js'

// Separation of duties for plan objects spanning several markets (PLAN B3 D-B3-04, D-B3-23): recordApproval lists
// eligible approvers for one market, so a refusal lists only users holding the permission over EVERY plan market.

class MultiMarketRefusal extends Error {
  constructor(readonly objectType: string, readonly objectId: string, readonly eligible: readonly EligibleApprover[]) {
    super('SOD-01')
  }
}

export type MultiMarketApproval = Omit<ApprovalInput, 'marketId'> & { readonly marketIds: readonly string[] }

/** Users eligible over every market (by user id), minus the excluded. */
export async function eligibleOverMarkets(tx: Tx, permission: string, marketIds: readonly string[], excludeUserIds: readonly string[]): Promise<EligibleApprover[]> {
  let common: EligibleApprover[] | null = null
  for (const marketId of marketIds) {
    const list = await eligibleApprovers(tx, { permission, marketId, excludeUserIds })
    common = common === null ? list : common.filter((u) => list.some((l) => l.user_id === u.user_id))
  }
  return common ?? []
}

/** Records the acting user's decision, or throws a refusal decideAcrossMarkets turns into 422 SOD_SELF_APPROVAL. */
export async function approveAcrossMarkets(tx: Tx, input: MultiMarketApproval): Promise<{ approvalId: string }> {
  const outcome = await recordApproval(tx, { ...input, marketId: input.marketIds[0] ?? null })
  if (outcome.ok) return { approvalId: outcome.approvalId }
  const barred = [...new Set([input.preparerId, ...input.contributorIds, ...input.excludedIds])]
  throw new MultiMarketRefusal(input.objectType, input.objectId, await eligibleOverMarkets(tx, input.approverPermission, input.marketIds, barred))
}

/**
 * An idempotent decision in the caller's tenant transaction (same contract as TEN decideWithSod): a refusal rolls the
 * decision and its Idempotency-Key back to a savepoint, commits APPROVAL.REFUSED and answers 422 SOD_SELF_APPROVAL.
 */
export async function decideAcrossMarkets(request: FastifyRequest, decide: (tx: Tx) => Promise<StoredResponse>): Promise<IdempotentResult> {
  type Outcome = { decided: IdempotentResult; refused?: never } | { refused: MultiMarketRefusal; decided?: never }
  const result = await inTenant(request, async (tx): Promise<Outcome> => {
    await tx.query('SAVEPOINT plan_sod_decision')
    try {
      return { decided: await idempotent(tx, request, () => decide(tx)) }
    } catch (error) {
      if (!(error instanceof MultiMarketRefusal)) throw error
      await tx.query('ROLLBACK TO SAVEPOINT plan_sod_decision')
      await recordAudit(tx, {
        action: 'APPROVAL.REFUSED', objectType: error.objectType, objectId: error.objectId,
        after: { object_type: error.objectType, object_id: error.objectId, reason_code: 'SOD-01' },
      })
      return { refused: error }
    }
  })
  if (result.refused !== undefined) {
    const eligible = result.refused.eligible
    throw new ApiError(422, 'SOD_SELF_APPROVAL', 'You prepared or contributed to this, so someone else must decide it.', {
      reason_code: 'SOD-01', eligible_approvers: eligible, no_eligible_approver: eligible.length === 0,
    })
  }
  return result.decided
}
