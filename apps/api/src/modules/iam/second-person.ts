import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordVendorAudit } from '../../lib/audit.js'
import { currentAuth } from '../../lib/auth.js'
import { runInVendor } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'

/** A vendor second-person step: who does it, who started what it completes, and the action it records. */
export interface SecondPersonStep {
  readonly actorId: string
  /** null = nothing to be independent of (a seeded tenant, a bootstrap vendor user). */
  readonly initiatorId: string | null
  readonly action: string
}

interface RefusalDetails {
  readonly action: string
  readonly initiator_id: string
}

const REFUSAL_CODES: ReadonlySet<string> = new Set(['SOD_SELF_APPROVAL', 'APPROVER_NOT_INDEPENDENT'])

/**
 * BUG-031: the second person is neither the initiator nor tied to them along the invitation line: an inviter-ancestor
 * either way, or the approver of either one's invitation or of an inviter-ancestor's (database function
 * vendor_users_linked, transitive since 0044; the 0043 triggers enforce the same on the rows).
 */
export async function assertSecondPerson(tx: Tx, step: SecondPersonStep): Promise<void> {
  if (step.initiatorId === null) return
  const details: RefusalDetails = { action: step.action, initiator_id: step.initiatorId }
  if (step.actorId === step.initiatorId) {
    throw new ApiError(422, 'SOD_SELF_APPROVAL', 'A second vendor user must do this step.', details)
  }
  const { rows } = await tx.query<{ linked: boolean }>('SELECT vendor_users_linked($1, $2) AS linked', [step.actorId, step.initiatorId])
  if (rows[0]!.linked) {
    throw new ApiError(403, 'APPROVER_NOT_INDEPENDENT',
      'You are in the invitation line of the vendor user who started this (you invited them or someone who invited them, were invited through them, or approved one of those invitations). Another vendor user must do this step.',
      details)
  }
}

/**
 * Runs a second-person step; a refusal is written to the vendor log in a transaction of its own (the step's own
 * transaction rolls back), then rethrown.
 */
export async function loggingSecondPersonRefusals<T>(
  request: FastifyRequest, object: { objectType: string; objectId: string }, step: () => Promise<T>,
): Promise<T> {
  try {
    return await step()
  } catch (error) {
    if (!(error instanceof ApiError) || !REFUSAL_CODES.has(error.code)) throw error
    const details = error.details as RefusalDetails | null
    if (details?.initiator_id === undefined) throw error
    const actor = { actorType: 'vendor_user' as const, requestId: request.id, supportSessionId: null }
    await runInVendor(currentAuth(request).userId, actor, (tx) =>
      recordVendorAudit(tx, { action: 'SECOND_PERSON.REFUSED', ...object, after: { ...details, refusal: error.code } }),
    )
    throw error
  }
}
