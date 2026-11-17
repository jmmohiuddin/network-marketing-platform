import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { getSetting } from '../ten/index.js'
import type { BuyerType } from './order-checks.js'
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

/** The positions the hints name by kind, when they can be credited (not terminated); an unknown ref is no hint. */
async function hintedPositions(tx: Tx, hints: NonNullable<OrderInput['attribution']>): Promise<Map<'link' | 'code', string>> {
  const hinted = new Map<'link' | 'code', string>()
  for (const hint of hints) {
    const { rows } = await tx.query<{ id: string }>(`SELECT id FROM position WHERE position_ref = $1 AND status <> 'terminated'`, [hint.position_ref])
    if (rows[0] !== undefined) hinted.set(hint.kind, rows[0].id)
  }
  return hinted
}

/**
 * FR-CRM-001 at ingestion: a buyer who can hold positions is credited to their own earliest active position; otherwise
 * the first usable source in the precedence wins. A hint that differs from the servicer at the crediting time flags a
 * conflict (AC-CRM1-3).
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
  const hinted = await hintedPositions(tx, hints ?? [])
  const conflict = servicer !== undefined && [...hinted.values()].some((positionId) => positionId !== servicer.position_id)
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
  const { rowCount } = await tx.query(
    `SELECT 1 FROM crm_servicer_at($1, $2) UNION ALL SELECT 1 FROM crm_servicer_at($1, 'infinity')`, [customerId, at],
  )
  if (rowCount !== 0) return
  const { rows } = await tx.query<{ id: string }>(
    `SELECT crm_set_servicer($1, $2, 'first_order', $3, NULL, NULL) AS id`, [customerId, positionId, at],
  )
  await recordAudit(tx, {
    action: 'SERVICING.CHANGED', objectType: 'customer_servicing', objectId: rows[0]!.id,
    after: { customer_id: customerId, position_id: positionId, source: 'first_order', valid_from: at },
  })
}
