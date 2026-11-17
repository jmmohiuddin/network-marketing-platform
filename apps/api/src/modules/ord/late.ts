import type { Tx } from '@nmp/db'
import type { Volumes } from './volumes.js'

export interface LateItem {
  readonly id: string
  readonly original_period_id: string
}

export interface EffectEstimate {
  readonly volumes: Volumes
  readonly amount_minor: string
  readonly attributed_position_id: string | null
}

/**
 * D-B2-12 / FR-ORD-005: an order or event whose order is credited inside a committed (paid, closed) period is late, once
 * per such period of the market's calendars; proposed handling adjust (BR-PER-04). The period itself is never edited.
 */
export async function recordLate(
  tx: Tx, origin: { orderId: string } | { eventId: string }, marketId: string, creditedAt: string | Date, estimate: EffectEstimate,
): Promise<LateItem[]> {
  const orderId = 'orderId' in origin ? origin.orderId : null
  const eventId = 'eventId' in origin ? origin.eventId : null
  const { rows } = await tx.query<LateItem>(
    `INSERT INTO late_transaction (tenant_id, order_id, order_event_id, original_period_id, effect_estimate, handling, state)
     SELECT app_tenant_id(), $1, $2, c.period_id, $5, 'adjust', 'pending'
     FROM committed_periods_overlapping($3, $4, $4::timestamptz + interval '1 microsecond') c
     RETURNING id, original_period_id`,
    [orderId, eventId, marketId, creditedAt, estimate],
  )
  return rows
}
