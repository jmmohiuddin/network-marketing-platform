import { pgCode } from './pg.js'

/**
 * A business refusal of an order or event after authentication (D-B2-11): the attempt rolls back to its savepoint and
 * the refusal is persisted as a rejected inbound event, then answered as a stored response.
 */
export class Refusal extends Error {
  constructor(readonly status: 409 | 422, readonly code: string, message: string, readonly details: unknown = null) {
    super(message)
    this.name = 'Refusal'
  }
}

// PLAN B2 4.3, the SQLSTATEs the ingestion functions raise.
// shortcut: per-package copy of the SQLSTATE map; move to lib/errors.ts at the next integrator touch.
const SQLSTATE_REFUSALS: Readonly<Record<string, [409 | 422, string, string]>> = {
  OR001: [422, 'RETURN_EXCEEDS_PURCHASED', 'The event returns more than was purchased.'],
  PA002: [422, 'BUYER_TYPE_INVALID', 'The configured new-buyer type is not an active end-customer type.'],
  CR001: [422, 'NOT_A_CUSTOMER', 'The buyer is not an end customer.'],
  CR002: [422, 'SERVICER_NOT_ELIGIBLE', 'The attributed position cannot service customers.'],
}

// A unique violation on an ingested fact (a backstop: the natural-key lock and checks come first) is a conflict, never a 500.
const UNIQUE_REFUSALS: Readonly<Record<string, [409, string, string]>> = {
  sales_order: [409, 'ORDER_CONFLICT', 'This order was already ingested with a different body.'],
  order_event: [409, 'EVENT_CONFLICT', 'This event was already received with a different body.'],
}

// D-V1A-05: one dispute outcome per chargeback (a concurrent reversal or dispute_lost lost the race).
const DISPUTE_OUTCOME: [409 | 422, string, string] = [422, 'DISPUTE_CLOSED', 'The dispute of this chargeback was already won or lost.']

/** The error as a refusal (a Refusal, or a mapped SQLSTATE), or null for anything else. */
export function asRefusal(error: unknown): Refusal | null {
  if (error instanceof Refusal) return error
  const code = pgCode(error)
  const { table, constraint } = (error ?? {}) as { table?: string; constraint?: string }
  const mapped = code === '23505'
    ? (constraint === 'order_event_dispute_outcome' ? DISPUTE_OUTCOME : UNIQUE_REFUSALS[table ?? ''])
    : SQLSTATE_REFUSALS[code ?? '']
  return mapped === undefined ? null : new Refusal(...mapped)
}

/** The stored error body of a refusal (the house error envelope). */
export function refusalBody(refusal: Refusal, requestId: string): { error: Record<string, unknown> } {
  return { error: { code: refusal.code, message: refusal.message, details: refusal.details, request_id: requestId } }
}
