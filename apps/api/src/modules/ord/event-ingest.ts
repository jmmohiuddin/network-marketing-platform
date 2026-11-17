import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { envelope } from '../../lib/http.js'
import { getSetting } from '../ten/index.js'
import { recordLate } from './late.js'
import { assertNotFuture } from './order-checks.js'
import type { AttemptRefs, Outcome } from './outcome.js'
import { Refusal } from './refusal.js'
import type { EventInput } from './schemas.js'
import { eventView } from './views.js'
import { perUnit, proportional, sum, times, type Volumes } from './volumes.js'

interface OrderRow {
  readonly id: string
  readonly market_id: string
  readonly credited_at: Date
  readonly attributed_position_id: string | null
}

interface OrderLine {
  readonly line_no: number
  readonly quantity: number
  readonly volumes: Volumes
  readonly source_line_id: string | null
  /** Quantity not yet returned (returns, refunds with lines, chargebacks, cancellations minus re-credits). */
  readonly remaining: number
}

interface EventLine {
  readonly line_no: number
  readonly quantity: number
}

// The order row lock serialises every event of one order (the DB quantity guard takes the same lock).
async function lockOrder(tx: Tx, input: EventInput): Promise<OrderRow | null> {
  const { rows } = await tx.query<OrderRow>(
    `SELECT id, market_id, credited_at, attributed_position_id FROM sales_order
     WHERE source_system = $1 AND source_order_id = $2 FOR UPDATE`,
    [input.source_system, input.source_order_id],
  )
  return rows[0] ?? null
}

async function orderLines(tx: Tx, orderId: string): Promise<OrderLine[]> {
  const { rows } = await tx.query<OrderLine>(
    `SELECT l.line_no, l.quantity, l.volumes, l.source_line_id, l.quantity - coalesce((
       SELECT sum(CASE WHEN e.type = 'chargeback_reversed' THEN -1 ELSE 1 END * (x ->> 'quantity')::int)
       FROM order_event e CROSS JOIN jsonb_array_elements(e.lines) x
       WHERE e.order_id = l.order_id AND (x ->> 'line_no')::int = l.line_no
         AND (e.type IN ('return', 'refund', 'chargeback', 'cancelled', 'chargeback_reversed') OR (e.type = 'exchange' AND NOT e.equal_value))
     ), 0)::int AS remaining
     FROM order_line l WHERE l.order_id = $1 ORDER BY l.line_no`,
    [orderId],
  )
  return rows
}

async function reversedChargeback(tx: Tx, input: EventInput, orderId: string): Promise<{ id: string; lines: EventLine[] }> {
  const { rows } = await tx.query<{ id: string; lines: EventLine[]; reversed: boolean }>(
    `SELECT c.id, c.lines, EXISTS (SELECT 1 FROM order_event r WHERE r.reverses_event_id = c.id) AS reversed
     FROM order_event c WHERE c.source_system = $1 AND c.source_event_id = $2 AND c.order_id = $3 AND c.type = 'chargeback'`,
    [input.source_system, input.reverses_source_event_id, orderId],
  )
  const chargeback = rows[0]
  if (chargeback === undefined) throw new Refusal(422, 'EVENT_NOT_FOUND', 'The chargeback this event reverses was not received for the order.')
  if (chargeback.reversed) throw new Refusal(422, 'CHARGEBACK_ALREADY_REVERSED', 'The chargeback this event reverses was already reversed.')
  return { id: chargeback.id, lines: chargeback.lines }
}

/** The event's lines by order line number; omitted lines = every remaining quantity for chargebacks and cancellations. */
function resolveLines(input: EventInput, lines: readonly OrderLine[]): EventLine[] {
  const remaining = () => lines.filter((line) => line.remaining > 0).map((line) => ({ line_no: line.line_no, quantity: line.remaining }))
  if (input.lines === 'remaining') return remaining()
  if (input.lines === undefined) return input.type === 'chargeback' || input.type === 'cancelled' ? remaining() : []
  return input.lines.map((given) => {
    const line = lines.find((candidate) => ('line_no' in given ? candidate.line_no === given.line_no : candidate.source_line_id === given.source_line_id))
    if (line === undefined) throw new Refusal(422, 'LINE_UNKNOWN', 'The event names a line the order does not have.', { line: given })
    return { line_no: line.line_no, quantity: given.quantity }
  })
}

/** Volume direction: returns reverse (-1), a chargeback reversal re-credits (+1), an equal-value exchange has none (0). */
function direction(input: EventInput): -1 | 0 | 1 {
  if (input.type === 'chargeback_reversed') return 1
  if (input.type === 'exchange' && input.equal_value === true) return 0
  return -1
}

function assertWithinPurchased(input: EventInput, eventLines: readonly EventLine[], lines: readonly OrderLine[]): void {
  if (direction(input) !== -1) return
  const over = eventLines.find((given) => given.quantity > lines.find((line) => line.line_no === given.line_no)!.remaining)
  if (over !== undefined) {
    throw new Refusal(422, 'RETURN_EXCEEDS_PURCHASED', 'The event returns more than was purchased and not yet returned.', { line_no: over.line_no })
  }
}

/** D-B2-17: per line, per-unit volumes × moved quantity; a restocking fee scales a reversal per the tenant setting. */
interface VolumeEffect {
  readonly lines?: readonly { line_no: number; volumes: Volumes }[]
  readonly total?: Volumes
}

async function volumeEffect(tx: Tx, input: EventInput, eventLines: readonly EventLine[], lines: readonly OrderLine[]): Promise<VolumeEffect> {
  const sign = direction(input)
  if (sign === 0 || eventLines.length === 0) return {}
  let effects = eventLines.map((given) => {
    const line = lines.find((candidate) => candidate.line_no === given.line_no)!
    return { line_no: given.line_no, volumes: times(perUnit(line.volumes, line.quantity), sign * given.quantity) }
  })
  const fee = BigInt(input.fee_minor)
  if (sign < 0 && fee > 0n) {
    const effect = await getSetting(tx, 'orders.restocking_fee_volume_effect')
    if (effect === null) {
      throw new Refusal(422, 'RESTOCKING_FEE_EFFECT_NOT_CONFIGURED', 'Set orders.restocking_fee_volume_effect before sending events with a restocking fee.')
    }
    const refund = BigInt(input.refund_minor)
    if (effect === 'proportional') effects = effects.map((line) => ({ ...line, volumes: proportional(line.volumes, refund, refund + fee) }))
  }
  return { lines: effects, total: sum(effects.map((line) => line.volumes)) }
}

function assertEventShape(input: EventInput, toleranceSeconds: number): void {
  if (input.type === 'renewal_failed') {
    throw new Refusal(422, 'EVENT_TYPE_NOT_SUPPORTED', 'Subscription events (renewal_failed) are not supported yet.')
  }
  if ((input.type === 'return' || input.type === 'exchange') && input.lines === undefined) {
    throw new Refusal(422, 'LINES_REQUIRED', 'Returns and exchanges name their lines.')
  }
  assertNotFuture([input.occurred_at], toleranceSeconds)
}

/** FR-ORD-004: one order event; an event for an order not yet received is held ORDER_NOT_FOUND. */
export async function processEvent(tx: Tx, input: EventInput, refs: AttemptRefs, toleranceSeconds: number): Promise<Outcome> {
  assertEventShape(input, toleranceSeconds)
  const order = await lockOrder(tx, input)
  if (order === null) return { state: 'held', reason: 'ORDER_NOT_FOUND', ref: input.source_order_id }
  const lines = await orderLines(tx, order.id)
  const reversed = input.type === 'chargeback_reversed' ? await reversedChargeback(tx, input, order.id) : null
  const eventLines = reversed?.lines ?? resolveLines(input, lines)
  assertWithinPurchased(input, eventLines, lines)
  const effect = await volumeEffect(tx, input, eventLines, lines)
  await tx.query(
    `INSERT INTO order_event (id, tenant_id, order_id, source_system, source_event_id, type, occurred_at, lines, refund_minor,
       fee_minor, equal_value, volume_effect, period_id, reverses_event_id, inbound_event_id)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, market_period_at($12, $6), $13, $14)`,
    [refs.targetId, order.id, input.source_system, input.source_event_id, input.type, input.occurred_at, JSON.stringify(eventLines),
      input.refund_minor, input.fee_minor, input.equal_value === true, effect, order.market_id, reversed?.id ?? null, refs.inboundId],
  )
  const amount = BigInt(input.refund_minor) * BigInt(input.type === 'chargeback_reversed' ? 1 : -1)
  const late = await recordLate(tx, { eventId: refs.targetId }, order.market_id, order.credited_at, {
    volumes: effect.total ?? {}, amount_minor: amount.toString(), attributed_position_id: order.attributed_position_id,
  })
  await recordAudit(tx, {
    action: 'ORDER_EVENT.RECORDED', objectType: 'order_event', objectId: refs.targetId,
    after: { inbound_event_id: refs.inboundId, order_id: order.id, type: input.type, late_transaction_ids: late.map((item) => item.id) },
  })
  return { state: 'processed', result: { event_id: refs.targetId }, body: envelope({ event: await eventView(tx, refs.targetId), late: late.length > 0 }) }
}
