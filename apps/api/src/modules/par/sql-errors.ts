import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'

// PLAN B2 section 4.3: the SQLSTATEs the shared SQL contracts raise, as API errors.
// shortcut: per-package copy of the SQLSTATE map; move to lib/errors.ts at the next integrator touch.
const SQLSTATES: Readonly<Record<string, readonly [number, string, string]>> = {
  GN001: [409, 'GEN_CYCLE', 'This placement would make a position its own ancestor.'],
  GN002: [409, 'GEN_OVERLAP', 'The position already has a parent for that time.'],
  GN003: [409, 'GEN_SLOT_TAKEN', 'That placement leg is taken.'],
  GN004: [422, 'PARENT_NOT_ELIGIBLE', 'The parent position does not exist or is terminated.'],
  GN005: [409, 'RELATIONSHIP_STATE_CONFLICT', 'The position\'s relationships do not allow this change at that date.'],
  GN006: [409, 'STATUS_TRANSITION_INVALID', 'The position cannot move to that status.'],
  GN007: [422, 'EFFECTIVE_IN_COMMITTED_PERIOD', 'The date lies before the end of the latest committed period, or in the future.'],
  GN008: [409, 'OWNERSHIP_CONFLICT', 'The position cannot change owner at that date.'],
  GN009: [409, 'POSITION_REF_TAKEN', 'This position reference is taken.'],
  PA001: [422, 'TYPE_CANNOT_HOLD_POSITIONS', 'The participant\'s type cannot hold positions.'],
  PA002: [422, 'TYPE_NOT_ELIGIBLE', 'The type is not an active end-customer type.'],
  PA003: [409, 'DUPLICATE_HOLD', 'A duplicate review holds this position until it is decided.'],
  CR001: [422, 'NOT_A_CUSTOMER', 'The participant is not an end customer.'],
  CR002: [422, 'SERVICER_NOT_ELIGIBLE', 'The servicing position does not exist or is not active.'],
  CR003: [422, 'REASSIGNMENT_RULE_NOT_CONFIGURED', 'Set customers.reassignment_rule before terminating a position that services customers.'],
}

export const pgCode = (error: unknown): unknown => (error as { code?: unknown }).code

/** The API error of a known SQLSTATE, else the error itself. */
export function translateSqlError(error: unknown): unknown {
  const known = SQLSTATES[String(pgCode(error))]
  return known === undefined ? error : new ApiError(known[0], known[1], known[2])
}

/** Runs a call of the shared SQL contracts, answering their SQLSTATEs as API errors. */
export async function sqlCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw translateSqlError(error)
  }
}

/** Runs fn in a savepoint: on failure the transaction continues from before fn and the error is rethrown. */
export async function inSavepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.query('SAVEPOINT par_attempt')
  try {
    const result = await fn()
    await tx.query('RELEASE SAVEPOINT par_attempt')
    return result
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT par_attempt')
    throw error
  }
}
