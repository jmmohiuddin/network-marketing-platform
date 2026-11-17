import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { getSetting } from '../ten/index.js'
import type { BuyerType } from './order-checks.js'
import { pgCode } from './pg.js'
import { Refusal } from './refusal.js'
import type { OrderInput } from './schemas.js'

type Precedence = readonly ('link' | 'code' | 'servicing')[]

export interface Attribution {
  readonly positionId: string | null
  readonly source: 'link' | 'code' | 'servicing' | 'buyer' | null
  readonly conflict: boolean
}

/** D-B2-13: orders.attribution_precedence, no default. */
export async function attributionPrecedence(tx: Tx): Promise<Precedence> {
  const precedence = await getSetting(tx, 'orders.attribution_precedence')
  if (precedence === null) {
    throw new Refusal(422, 'ATTRIBUTION_NOT_CONFIGURED', 'Set orders.attribution_precedence before sending orders.')
  }
  return precedence
}

async function ownActivePosition(tx: Tx, buyerId: string, at: string): Promise<string | null> {
  const { rows } = await tx.query<{ position_id: string }>(
    `SELECT position_id FROM gen_positions_of($1, $2) WHERE status = 'active' ORDER BY owned_from, position_id LIMIT 1`,
    [buyerId, at],
  )
  return rows[0]?.position_id ?? null
}

/**
 * The positions the hints name by kind, when they could be credited at the crediting time: active then per their status
 * history (every position has its first row from creation). A position pending (duplicate-held), suspended or terminated
 * then takes no credit: its hint is dropped and reported as a conflict. An unknown ref is no hint.
 */
async function hintedPositions(
  tx: Tx, hints: NonNullable<OrderInput['attribution']>, at: string,
): Promise<{ hinted: Map<'link' | 'code', string>; dropped: boolean }> {
  const hinted = new Map<'link' | 'code', string>()
  let dropped = false
  for (const hint of hints) {
    const { rows } = await tx.query<{ id: string; status: string | null }>(
      `SELECT p.id, (SELECT h.to_status FROM position_status_history h
                     WHERE h.position_id = p.id AND h.effective_from <= $2
                     ORDER BY h.effective_from DESC, h.recorded_at DESC, h.id DESC LIMIT 1) AS status
       FROM position p WHERE p.position_ref = $1`,
      [hint.position_ref, at],
    )
    // No status then: the position did not exist yet, so no hint (as an unknown ref).
    const position = rows[0]
    if (position?.status === 'active') hinted.set(hint.kind, position.id)
    else if (position?.status != null) dropped = true
  }
  return { hinted, dropped }
}

/**
 * FR-CRM-001 at ingestion: a buyer who can hold positions is credited to their own earliest active position; otherwise
 * the first usable source in the precedence wins. A hint that differs from the servicer at the crediting time, or names
 * a position not active then, flags a conflict (AC-CRM1-3).
 */
export async function attribute(
  tx: Tx, buyerId: string, type: BuyerType, hints: OrderInput['attribution'], precedence: Precedence, at: string,
): Promise<Attribution> {
  if (type.can_hold_positions) {
    const own = await ownActivePosition(tx, buyerId, at)
    if (own !== null) return { positionId: own, source: 'buyer', conflict: false }
  }
  const servicing = await tx.query<{ position_id: string | null }>('SELECT position_id FROM crm_servicer_at($1, $2)', [buyerId, at])
  const servicer = servicing.rows[0]
  const { hinted, dropped } = await hintedPositions(tx, hints ?? [], at)
  const conflict = dropped || (servicer !== undefined && [...hinted.values()].some((positionId) => positionId !== servicer.position_id))
  for (const source of precedence) {
    if (source === 'servicing' && servicer?.position_id != null) return { positionId: servicer.position_id, source, conflict }
    const positionId = source === 'servicing' ? undefined : hinted.get(source)
    if (positionId !== undefined) return { positionId, source, conflict }
  }
  return { positionId: null, source: null, conflict }
}

/** D-B2-13: the first attributed order of a customer without any servicer makes the attributed position its servicer. */
export async function servicingFromFirstOrder(tx: Tx, customerId: string, type: BuyerType, positionId: string | null, at: string): Promise<void> {
  if (!type.counts_as_end_customer || positionId === null) return
  // Only a position active now services customers (C1): one terminated, suspended or held since the crediting time does not.
  const { rowCount } = await tx.query(
    `SELECT 1 FROM crm_servicer_at($1, $2) UNION ALL SELECT 1 FROM crm_servicer_at($1, 'infinity')
     UNION ALL SELECT 1 FROM position WHERE id = $3 AND status <> 'active'`, [customerId, at, positionId],
  )
  if (rowCount !== 0) return
  // OI-4: C1 refuses (23514) when a servicer row starting at or after `at` appeared since the check above (a concurrent change).
  const { rows } = await tx.query<{ id: string }>(
    `SELECT crm_set_servicer($1, $2, 'first_order', $3, NULL, NULL) AS id`, [customerId, positionId, at],
  ).catch((error: unknown) => {
    if (pgCode(error) !== '23514') throw error
    throw new Refusal(409, 'SERVICING_CHANGE_PENDING', 'A servicing change of this customer is pending; send the order again.')
  })
  await recordAudit(tx, {
    action: 'SERVICING.CHANGED', objectType: 'customer_servicing', objectId: rows[0]!.id,
    after: { customer_id: customerId, position_id: positionId, source: 'first_order', valid_from: at },
  })
}
