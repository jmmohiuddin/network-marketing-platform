import { recordApproval, type ApprovalInput, type EligibleApprover, type Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit } from '../../lib/audit.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { idempotent, type IdempotentResult, type StoredResponse } from '../../lib/idempotency.js'

class SodRefusal extends Error {
  constructor(readonly objectType: string, readonly objectId: string, readonly eligible: readonly EligibleApprover[]) {
    super('SOD-01')
  }
}

/**
 * FR-IAM-004 through the @nmp/db primitive (D-B1-03): records the acting user's approval or rejection of the object, or
 * throws a refusal decideWithSod turns into 422 SOD_SELF_APPROVAL (preparer, contributor or excluded).
 */
export async function approveOrRefuse(tx: Tx, input: ApprovalInput): Promise<{ approvalId: string; decidedAt: Date }> {
  const outcome = await recordApproval(tx, input)
  if (!outcome.ok) throw new SodRefusal(input.objectType, input.objectId, outcome.eligibleApprovers)
  return { approvalId: outcome.approvalId, decidedAt: outcome.decidedAt }
}

/**
 * Runs an idempotent decision in the caller's tenant transaction. A separation-of-duties refusal rolls the decision
 * (and its Idempotency-Key) back to a savepoint, writes APPROVAL.REFUSED in the same transaction, lets it commit
 * (AC-IAM4-1) and then answers 422 SOD_SELF_APPROVAL with the eligible approvers (AC-IAM4-4).
 */
export async function decideWithSod(request: FastifyRequest, decide: (tx: Tx) => Promise<StoredResponse>): Promise<IdempotentResult> {
  type Outcome = { decided: IdempotentResult; refused?: never } | { refused: SodRefusal; decided?: never }
  const result = await inTenant(request, async (tx): Promise<Outcome> => {
    await tx.query('SAVEPOINT sod_decision')
    try {
      return { decided: await idempotent(tx, request, () => decide(tx)) }
    } catch (error) {
      if (!(error instanceof SodRefusal)) throw error
      await tx.query('ROLLBACK TO SAVEPOINT sod_decision')
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
