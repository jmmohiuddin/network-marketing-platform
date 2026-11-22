import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'
import type { OrderListRow, OrderSort } from './order-list.js'

// Order columns shared by the ingestion response, the list and the detail. Amounts and volumes are text (bigint).
const VOLUME_TOTALS = `coalesce((
    SELECT jsonb_object_agg(v.measure, v.total::text ORDER BY v.measure) FROM (
      SELECT e.key AS measure, sum((e.value #>> '{}')::numeric) AS total
      FROM order_line l CROSS JOIN jsonb_each(l.volumes) e WHERE l.order_id = o.id GROUP BY e.key) v), '{}'::jsonb)`
const ORDER_COLUMNS = `
  o.id, o.source_system, o.source_order_id, jsonb_build_object('id', m.id, 'code', m.code) AS market,
  jsonb_build_object('code', t.code) AS buyer_type, o.purpose, o.purpose_missing,
  CASE WHEN o.attributed_position_id IS NULL THEN NULL
       ELSE jsonb_build_object('id', p.id, 'position_ref', p.position_ref) END AS attributed_position,
  o.attribution_source, o.attribution_conflict, o.credited_at, o.period_id, o.amount_minor, o.tax_minor, o.currency,
  ${VOLUME_TOTALS} AS volumes, o.subscription_ref,
  (SELECT jsonb_build_object('currency', o.original_currency, 'amount_minor', o.original_amount_minor::text, 'tax_minor',
     o.original_tax_minor::text, 'rate', f.rate::text, 'rate_valid_from', json_instant(f.valid_from), 'rate_id', f.id)
   FROM fx_rate f WHERE f.id = o.fx_rate_id) AS original`
const ORDER_FROM = `
  FROM sales_order o JOIN market m ON m.id = o.market_id JOIN participant b ON b.id = o.buyer_id
  JOIN participant_type t ON t.id = o.buyer_type_id LEFT JOIN position p ON p.id = o.attributed_position_id`
const LINES = `(SELECT jsonb_agg(jsonb_build_object('line_no', l.line_no, 'sku', l.sku, 'item_class', l.item_class,
    'quantity', l.quantity, 'amount_minor', l.amount_minor::text, 'original_amount_minor', l.original_amount_minor::text,
    'volumes', l.volumes, 'source_line_id', l.source_line_id)
    ORDER BY l.line_no) FROM order_line l WHERE l.order_id = o.id)`

/** The order as fixed at ingestion (key responses: ids and refs, no personal data). */
export async function orderFacts(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query(
    `SELECT ${ORDER_COLUMNS}, jsonb_build_object('id', b.id, 'external_ref', b.external_ref) AS buyer, o.ordered_at,
            ${LINES} AS lines
     ${ORDER_FROM} WHERE o.id = $1`,
    [id],
  )
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

const EVENT_COLUMNS = `e.id, e.order_id, e.source_system, e.source_event_id, e.type, e.occurred_at, e.lines,
  e.refund_minor, e.fee_minor, e.equal_value, e.volume_effect, e.period_id, e.dispute_of_event_id,
  EXISTS (SELECT 1 FROM late_transaction x WHERE x.order_event_id = e.id) AS late,
  (SELECT jsonb_build_object('refund_minor', e.original_refund_minor::text, 'fee_minor', e.original_fee_minor::text,
     'currency', so.original_currency)
   FROM sales_order so WHERE so.id = e.order_id AND e.original_refund_minor IS NOT NULL) AS original`

export async function eventView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query(`SELECT ${EVENT_COLUMNS} FROM order_event e WHERE e.id = $1`, [id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

/** GET /v1/orders/:id: the facts plus the buyer's name, events, late items and the inbound event (scope: null = all). */
export async function orderDetail(tx: Tx, id: string, scope: readonly string[] | null): Promise<Record<string, unknown>> {
  const { rows } = await tx.query(
    `SELECT ${ORDER_COLUMNS}, o.ordered_at, ${LINES} AS lines,
       jsonb_build_object('id', b.id, 'external_ref', b.external_ref, 'display_name', b.display_name) AS buyer,
       jsonb_build_object('inbound_event_id', i.id, 'received_at', i.received_at, 'source', i.source) AS source
     ${ORDER_FROM} JOIN inbound_event i ON i.id = o.inbound_event_id
     WHERE o.id = $1 AND ($2::uuid[] IS NULL OR o.market_id = ANY ($2))`,
    [id, scope],
  )
  if (rows[0] === undefined) throw notFound()
  const events = await tx.query(`SELECT ${EVENT_COLUMNS} FROM order_event e WHERE e.order_id = $1 ORDER BY e.occurred_at, e.id`, [id])
  const late = await tx.query(
    `SELECT x.id, x.origin_type, coalesce(x.order_id, x.order_event_id) AS origin_id, x.original_period_id, x.effect_estimate,
            x.handling, x.state, x.decided_at
     FROM late_transaction x LEFT JOIN order_event e ON e.id = x.order_event_id
     WHERE x.order_id = $1 OR e.order_id = $1 ORDER BY x.created_at, x.id`,
    [id],
  )
  return { ...rows[0], events: events.rows, late_transactions: late.rows }
}

export interface OrderFilter {
  readonly market_id?: string | undefined
  readonly source_system?: string | undefined
  readonly purpose?: string | undefined
  readonly buyer_id?: string | undefined
  readonly attributed_position_id?: string | undefined
  readonly period_id?: string | undefined
  readonly late?: boolean | undefined
  readonly flag?: 'purpose_missing' | 'attribution_conflict' | undefined
  readonly from?: string | undefined
  readonly to?: string | undefined
  /** An order's source_order_id or subscription_ref, exactly. */
  readonly q?: string | undefined
}

/** The sort value of the last row (ISO instant or minor units) and its id. */
export interface OrderCursor {
  readonly value: string
  readonly id: string
}

// Instants at millisecond precision: the cursor carries an ISO string.
const SORT_SQL: Readonly<Record<OrderSort, { readonly key: string; readonly type: string; readonly direction: 'ASC' | 'DESC' }>> = {
  credited_at_desc: { key: "date_trunc('milliseconds', o.credited_at)", type: 'timestamptz', direction: 'DESC' },
  credited_at_asc: { key: "date_trunc('milliseconds', o.credited_at)", type: 'timestamptz', direction: 'ASC' },
  amount_desc: { key: 'o.amount_minor', type: 'bigint', direction: 'DESC' },
  amount_asc: { key: 'o.amount_minor', type: 'bigint', direction: 'ASC' },
}

/** The cursor value of a row under the sort. */
export const sortValueOf = (sort: OrderSort, row: OrderListRow): string =>
  sort.startsWith('credited_at') ? row.credited_at.toISOString() : row.amount_minor

const LATE_ORDER = 'EXISTS (SELECT 1 FROM late_transaction x WHERE x.order_id = o.id)'

// $1 scope, $2..$12 filters; credited_at in [from, to).
const FILTERS = `($1::uuid[] IS NULL OR o.market_id = ANY ($1)) AND ($2::uuid IS NULL OR o.market_id = $2)
  AND ($3::text IS NULL OR o.source_system = $3) AND ($4::text IS NULL OR o.purpose = $4)
  AND ($5::uuid IS NULL OR o.buyer_id = $5) AND ($6::uuid IS NULL OR o.attributed_position_id = $6)
  AND ($7::uuid IS NULL OR o.period_id = $7) AND ($8::boolean IS NULL OR ${LATE_ORDER})
  AND ($9::text IS NULL OR ($9 = 'purpose_missing' AND o.purpose_missing) OR ($9 = 'attribution_conflict' AND o.attribution_conflict))
  AND ($10::timestamptz IS NULL OR o.credited_at >= $10) AND ($11::timestamptz IS NULL OR o.credited_at < $11)
  AND ($12::text IS NULL OR o.source_order_id = $12 OR o.subscription_ref = $12)`

function filterParams(scope: readonly string[] | null, f: OrderFilter): unknown[] {
  return [scope, f.market_id ?? null, f.source_system ?? null, f.purpose ?? null, f.buyer_id ?? null,
    f.attributed_position_id ?? null, f.period_id ?? null, f.late === true ? true : null, f.flag ?? null, f.from ?? null, f.to ?? null, f.q ?? null]
}

/** GET /v1/orders and its export: in the sort's order, then id; at most limit + 1 rows (the + 1 tells a next page or an export over the cap). */
export async function listOrders(
  tx: Tx, scope: readonly string[] | null, filter: OrderFilter, sort: OrderSort, after: OrderCursor | undefined, limit: number,
): Promise<OrderListRow[]> {
  const { key, type, direction } = SORT_SQL[sort]
  const { rows } = await tx.query<OrderListRow>(
    `SELECT ${ORDER_COLUMNS},
       jsonb_build_object('id', b.id, 'external_ref', b.external_ref, 'display_name', b.display_name) AS buyer,
       (SELECT count(*)::int FROM order_event e WHERE e.order_id = o.id) AS events, ${LATE_ORDER} AS late, o.ordered_at,
       round(o.amount_minor / 10::numeric ^ m.minor_unit, m.minor_unit::int)::text AS amount,
       round(o.tax_minor / 10::numeric ^ m.minor_unit, m.minor_unit::int)::text AS tax
     ${ORDER_FROM}
     WHERE ${FILTERS} AND ($13::${type} IS NULL OR (${key}, o.id) ${direction === 'DESC' ? '<' : '>'} ($13::${type}, $14::uuid))
     ORDER BY ${key} ${direction}, o.id ${direction} LIMIT $15`,
    [...filterParams(scope, filter), after?.value ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

/** How many orders match (the row count of an export refused over the cap). */
export async function countOrders(tx: Tx, scope: readonly string[] | null, filter: OrderFilter): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM sales_order o WHERE ${FILTERS}`, filterParams(scope, filter))
  return rows[0]!.n
}

/** GET /v1/orders/summary: counts only (SC-31 KPI cards). The exception queue is tenant-wide (PLAN 2.6). */
export async function orderSummary(tx: Tx, scope: readonly string[] | null, filter: OrderFilter): Promise<Record<string, number>> {
  const { rows } = await tx.query<Record<string, number>>(
    `SELECT count(*)::int AS orders,
       (SELECT count(*)::int FROM inbound_event WHERE state = 'held') AS held,
       (SELECT count(*)::int FROM late_transaction x
          LEFT JOIN order_event e ON e.id = x.order_event_id
          JOIN sales_order lo ON lo.id = coalesce(x.order_id, e.order_id)
        WHERE x.state = 'pending' AND ($1::uuid[] IS NULL OR lo.market_id = ANY ($1)) AND ($2::uuid IS NULL OR lo.market_id = $2)
          AND ($10::timestamptz IS NULL OR lo.credited_at >= $10) AND ($11::timestamptz IS NULL OR lo.credited_at < $11)) AS late_pending,
       count(*) FILTER (WHERE o.purpose_missing)::int AS purpose_missing,
       count(*) FILTER (WHERE o.attribution_conflict)::int AS attribution_conflict
     FROM sales_order o WHERE ${FILTERS}`,
    filterParams(scope, filter),
  )
  return rows[0]!
}

export interface InboundCursor {
  readonly received_at: string
  readonly id: string
}

/** GET /v1/inbound-events: the exception queue and history, newest first, never the payload. */
export async function listInbound(
  tx: Tx, filter: { state?: string | undefined; source?: string | undefined }, after: InboundCursor | undefined, limit: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await tx.query(
    `SELECT id, source, idempotency_key, received_at, processed_at, state, hold_reason, hold_ref, attempts, result
     FROM inbound_event
     WHERE ($1::text IS NULL OR state = $1) AND ($2::text IS NULL OR source = $2)
       AND ($3::timestamptz IS NULL OR (date_trunc('milliseconds', received_at), id) < ($3, $4::uuid))
     ORDER BY date_trunc('milliseconds', received_at) DESC, id DESC LIMIT $5`,
    [filter.state ?? null, filter.source ?? null, after?.received_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}
