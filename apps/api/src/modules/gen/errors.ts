import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'

// shortcut: per-package copy of the SQLSTATE map (PLAN B2 4.3); move to lib/errors.ts at the next integrator touch.
const SQL_ERRORS: Readonly<Record<string, readonly [number, string, string]>> = {
  GN001: [409, 'GEN_CYCLE', 'This change would make the position its own ancestor.'],
  GN002: [409, 'GEN_OVERLAP', 'The position already has a parent of this kind for that period.'],
  GN003: [409, 'GEN_SLOT_TAKEN', 'That leg of the parent is taken.'],
  GN004: [422, 'PARENT_NOT_ELIGIBLE', 'The proposed parent cannot take positions (unknown or terminated).'],
  GN005: [409, 'RELATIONSHIP_STATE_CONFLICT', 'The position has no relationship row this change can apply to at that date.'],
  GN006: [409, 'STATUS_TRANSITION_INVALID', 'The position cannot change to this status from its current status at that date.'],
  GN007: [422, 'EFFECTIVE_IN_COMMITTED_PERIOD', 'The effective date lies in a committed period or in the future.'],
  GN008: [409, 'OWNERSHIP_CONFLICT', 'The position cannot change owner at that date.'],
  PA001: [422, 'TYPE_CANNOT_HOLD_POSITIONS', 'The participant\'s type cannot hold positions.'],
  PA003: [409, 'DUPLICATE_HOLD', 'The owner is under duplicate review: the position stays pending until the case is decided.'],
  CR001: [422, 'NOT_A_CUSTOMER', 'A serviced participant is no longer an end customer at that date.'],
  CR002: [422, 'SERVICER_NOT_ELIGIBLE', 'The new servicing position cannot service customers.'],
  CR003: [422, 'REASSIGNMENT_RULE_NOT_CONFIGURED', 'Set the customer reassignment rule before terminating a position that services customers.'],
}

/** The API error of a refusal raised by the genealogy SQL contracts, or null for any other error. */
export function sqlError(error: unknown): ApiError | null {
  const code = (error as { code?: unknown }).code
  const entry = typeof code === 'string' ? SQL_ERRORS[code] : undefined
  return entry === undefined ? null : new ApiError(entry[0], entry[1], entry[2])
}

/** Runs a SQL contract call; its refusals leave as API errors (the transaction rolls back). */
export async function withSqlErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw sqlError(error) ?? error
  }
}

/**
 * Runs `attempt` inside a savepoint that is always rolled back (PLAN B2 4.2: callers dry-run the contracts): returns
 * the refusal as an API error, or null when the attempt would succeed. Other errors are rethrown.
 */
export async function dryRun(tx: Tx, attempt: () => Promise<unknown>): Promise<ApiError | null> {
  await tx.query('SAVEPOINT gen_dry_run')
  try {
    await attempt()
    return null
  } catch (error) {
    const refusal = sqlError(error)
    if (refusal === null) throw error
    return refusal
  } finally {
    await tx.query('ROLLBACK TO SAVEPOINT gen_dry_run; RELEASE SAVEPOINT gen_dry_run')
  }
}
