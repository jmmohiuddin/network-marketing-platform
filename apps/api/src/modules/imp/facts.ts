import type { Tx } from '@nmp/db'
import type { DataQuality } from './batches.js'
import type { ResolvedMapping } from './mappings.js'
import type { ControlTotals, ImportRows, RowCounts } from './validate.js'

const str = (value: bigint): string => value.toString()

async function insertParticipants(tx: Tx, batchId: string, marketId: string, rows: ImportRows, mapping: ResolvedMapping) {
  const flags = rows.participants.map((row) => mapping.participantFlags(row.typeCode)!)
  await tx.query(
    `INSERT INTO cpl_fact_participant (tenant_id, source, batch_id, participant_ref, type_code, counts_as_end_customer,
       can_earn, enrolled_month, servicing_ref, market_id)
     SELECT app_tenant_id(), 'import', $1, p.ref, p.type_code, p.end_customer, p.can_earn, p.enrolled_month, p.servicing_ref, $2
     FROM unnest($3::text[], $4::text[], $5::boolean[], $6::boolean[], $7::date[], $8::text[])
       AS p(ref, type_code, end_customer, can_earn, enrolled_month, servicing_ref)`,
    [batchId, marketId, rows.participants.map((row) => row.ref), rows.participants.map((row) => row.typeCode),
      flags.map((flag) => flag.counts_as_end_customer), flags.map((flag) => flag.can_earn),
      rows.participants.map((row) => row.enrolledMonth), rows.participants.map((row) => row.servicingRef)],
  )
}

async function insertOrders(tx: Tx, batchId: string, rows: ImportRows, mapping: ResolvedMapping) {
  const orders = rows.orders
  await tx.query(
    `INSERT INTO cpl_fact_order (tenant_id, source, batch_id, order_ref, order_date, buyer_ref, amount_minor, volume_minor,
       purpose, is_starter_kit, refunded_minor, refund_month)
     SELECT app_tenant_id(), 'import', $1, o.ref, o.order_date, o.buyer_ref, o.amount, o.volume, o.purpose, o.kit, o.refunded, o.refund_month
     FROM unnest($2::text[], $3::date[], $4::text[], $5::bigint[], $6::bigint[], $7::text[], $8::boolean[], $9::bigint[], $10::date[])
       AS o(ref, order_date, buyer_ref, amount, volume, purpose, kit, refunded, refund_month)`,
    [batchId, orders.map((o) => o.ref), orders.map((o) => o.orderDate), orders.map((o) => o.buyerRef),
      orders.map((o) => str(o.amount)), orders.map((o) => str(o.volume)), orders.map((o) => mapping.purpose(o.purposeCode)),
      orders.map((o) => mapping.starterKit(o.starterKitCode)!), orders.map((o) => str(o.refunded)), orders.map((o) => o.refundMonth)],
  )
}

async function insertPayoutLines(tx: Tx, batchId: string, rows: ImportRows, mapping: ResolvedMapping) {
  const lines = rows.payoutLines
  await tx.query(
    `INSERT INTO cpl_fact_payout_line (tenant_id, source, batch_id, line_ref, pay_month, payee_ref, bonus_type, source_kind,
       source_order_ref, amount_minor)
     SELECT app_tenant_id(), 'import', $1, l.ref, l.pay_month, l.payee_ref, l.bonus_type, l.source_kind, l.source_order, l.amount
     FROM unnest($2::text[], $3::date[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[])
       AS l(ref, pay_month, payee_ref, bonus_type, source_kind, source_order, amount)`,
    [batchId, lines.map((l) => l.ref), lines.map((l) => l.payMonth), lines.map((l) => l.payeeRef), lines.map((l) => l.bonusType),
      lines.map((l) => mapping.sourceKind(l.sourceKindCode)), lines.map((l) => l.sourceOrderRef), lines.map((l) => str(l.amount))],
  )
}

/** Writes the batch's facts (FR-IMP-003). Participant types and starter-kit codes are covered (assertCovers). */
export async function insertFacts(tx: Tx, batchId: string, marketId: string, rows: ImportRows, mapping: ResolvedMapping): Promise<void> {
  await insertParticipants(tx, batchId, marketId, rows, mapping)
  await insertOrders(tx, batchId, rows, mapping)
  await insertPayoutLines(tx, batchId, rows, mapping)
}

interface LoadedFigures {
  participants: number
  orders: number
  order_amount_minor: string
  order_volume_minor: string
  order_refunded_minor: string
  orders_unknown_purpose: number
  refunded_orders: number
  refunds_without_month: number
  payout_lines: number
  payout_amount_minor: string
  payout_lines_without_source_order: number
  payout_lines_unknown_source_kind: number
}

/** Counts and sums of what the database now holds for the batch (sums as decimal text: no Number on money). */
async function loadedFigures(tx: Tx, batchId: string): Promise<LoadedFigures> {
  const { rows } = await tx.query<LoadedFigures>(
    `SELECT (SELECT count(*) FROM cpl_fact_participant WHERE batch_id = $1)::int AS participants, o.*, l.*
     FROM (SELECT count(*)::int AS orders, coalesce(sum(amount_minor), 0)::text AS order_amount_minor,
                  coalesce(sum(volume_minor), 0)::text AS order_volume_minor,
                  coalesce(sum(refunded_minor), 0)::text AS order_refunded_minor,
                  count(*) FILTER (WHERE purpose = 'unknown')::int AS orders_unknown_purpose,
                  count(*) FILTER (WHERE refunded_minor > 0)::int AS refunded_orders,
                  count(*) FILTER (WHERE refunded_minor > 0 AND refund_month IS NULL)::int AS refunds_without_month
           FROM cpl_fact_order WHERE batch_id = $1) o,
          (SELECT count(*)::int AS payout_lines, coalesce(sum(amount_minor), 0)::text AS payout_amount_minor,
                  count(*) FILTER (WHERE source_order_ref IS NULL)::int AS payout_lines_without_source_order,
                  count(*) FILTER (WHERE source_kind = 'unknown')::int AS payout_lines_unknown_source_kind
           FROM cpl_fact_payout_line WHERE batch_id = $1) l`,
    [batchId],
  )
  return rows[0]!
}

export interface Expected {
  readonly rowCounts: RowCounts
  readonly controlTotals: ControlTotals
}

/**
 * FR-IMP-003 "control totals after load = totals at validation". A difference means the load is wrong, so it
 * throws (the transaction rolls back and the batch stays mapped). Returns the data-quality counts.
 */
export async function reconcile(tx: Tx, batchId: string, expected: Expected): Promise<Omit<DataQuality, 'unmapped'>> {
  const figures = await loadedFigures(tx, batchId)
  const loaded = {
    rowCounts: { participants: figures.participants, orders: figures.orders, payout_lines: figures.payout_lines },
    controlTotals: {
      order_amount_minor: figures.order_amount_minor, order_volume_minor: figures.order_volume_minor,
      order_refunded_minor: figures.order_refunded_minor, payout_amount_minor: figures.payout_amount_minor,
    },
  }
  const same = (Object.keys(expected.rowCounts) as (keyof RowCounts)[]).every((key) => expected.rowCounts[key] === loaded.rowCounts[key])
    && (Object.keys(expected.controlTotals) as (keyof ControlTotals)[]).every((key) => expected.controlTotals[key] === loaded.controlTotals[key])
  if (!same) throw new Error(`import batch ${batchId}: loaded control totals differ from the validated ones`)
  return {
    orders: figures.orders, orders_unknown_purpose: figures.orders_unknown_purpose, refunded_orders: figures.refunded_orders,
    refunds_without_month: figures.refunds_without_month, payout_lines: figures.payout_lines,
    payout_lines_without_source_order: figures.payout_lines_without_source_order,
    payout_lines_unknown_source_kind: figures.payout_lines_unknown_source_kind,
  }
}
