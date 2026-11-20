import { z } from 'zod'

// SC-31 orders list (PLAN B6 2.5, D-B6-08): its filters, sort keys and export columns. RPT's saved-view registry reads
// them through ord/index, so a saved orders view validates exactly as the list route does.

const instant = z.iso.datetime({ offset: true })

/** The list's filters as query strings (pagination, sort and columns apart). */
export const orderFilters = {
  from: instant.optional(), to: instant.optional(), market_id: z.uuid().optional(), source_system: z.string().min(1).max(100).optional(),
  purpose: z.enum(['resale', 'personal', 'unspecified', 'customer']).optional(), buyer_id: z.uuid().optional(),
  attributed_position_id: z.uuid().optional(), period_id: z.uuid().optional(), late: z.literal('true').transform(() => true).optional(),
  flag: z.enum(['purpose_missing', 'attribution_conflict']).optional(),
}

export const ORDER_SORTS = ['credited_at_desc', 'credited_at_asc', 'amount_desc', 'amount_asc'] as const
export type OrderSort = (typeof ORDER_SORTS)[number]

/** A list row as views.listOrders returns it. */
export interface OrderListRow {
  readonly id: string
  readonly source_system: string
  readonly source_order_id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly buyer: { readonly id: string; readonly external_ref: string }
  readonly buyer_type: { readonly code: string }
  readonly purpose: string
  readonly purpose_missing: boolean
  readonly attributed_position: { readonly id: string; readonly position_ref: string } | null
  readonly attribution_source: string | null
  readonly attribution_conflict: boolean
  readonly ordered_at: Date
  readonly credited_at: Date
  readonly period_id: string | null
  readonly amount_minor: string
  readonly tax_minor: string
  /** amount_minor and tax_minor as decimals of the market currency. */
  readonly amount: string
  readonly tax: string
  readonly currency: string
  readonly volumes: Record<string, string>
  readonly events: number
  readonly late: boolean
}

/**
 * Export columns (PLAN B6 2.5): exactly the list's fields, participants by external reference (names stay on the order
 * detail, D-B6-08); amounts as decimals of the market currency.
 */
export const ORDER_COLUMNS: Readonly<Record<string, (row: OrderListRow) => unknown>> = {
  source_order_id: (r) => r.source_order_id,
  ordered_at: (r) => r.ordered_at,
  credited_at: (r) => r.credited_at,
  market: (r) => r.market.code,
  buyer_ref: (r) => r.buyer.external_ref,
  buyer_type: (r) => r.buyer_type.code,
  purpose: (r) => r.purpose,
  attributed_position_ref: (r) => r.attributed_position?.position_ref ?? null,
  amount: (r) => r.amount,
  tax: (r) => r.tax,
  currency: (r) => r.currency,
  period: (r) => r.period_id,
  late: (r) => r.late,
  flags: (r) => [r.purpose_missing ? 'purpose_missing' : null, r.attribution_conflict ? 'attribution_conflict' : null].filter((f) => f !== null).join(';'),
}
