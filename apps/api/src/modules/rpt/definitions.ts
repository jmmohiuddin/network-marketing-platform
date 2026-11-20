import { z } from 'zod'
import type { Permission } from '../../lib/permissions.js'
import { ORDER_COLUMNS, ORDER_SORTS, orderFilters } from '../ord/index.js'

// RPT reporting catalogue (D-B6-07): every dashboard figure with its definition and source, returned in meta.definitions.
// No projections, targets, rankings or per-person figures (BR-HON-01; TS-53 pattern test in dashboards.test.ts).

export interface Definition {
  readonly key: string
  readonly label: string
  readonly definition: string
  readonly source: string
}

const COMMITTED = 'Committed data only: the period is committed, paid or closed.'

export const EXECUTIVE_DEFINITIONS: readonly Definition[] = [
  {
    key: 'net_sales_minor', label: 'Net sales',
    definition: 'Order amounts credited in the period, minus money returned to buyers by refunds, returns, chargebacks, cancellations and exchanges '
      + 'that occurred in it, plus chargebacks reversed in it. Minor units.',
    source: 'sales_order.amount_minor by credited_at; order_event.refund_minor by occurred_at',
  },
  { key: 'payout_minor', label: 'Commission payout', definition: `Gross of the period's committed run. ${COMMITTED}`, source: 'run.totals.gross_minor' },
  {
    key: 'payout_share_pct', label: 'Payout as share of sales',
    definition: 'Commission payout over net sales, in percent, rounded half up to 2 decimals; empty when net sales are zero or less.', source: 'payout_minor / net_sales_minor',
  },
  { key: 'active_earners', label: 'Active earners', definition: 'Payees of the committed run with a gross amount above zero.', source: 'run_settlement.gross_minor > 0' },
  {
    key: 'retail_share_pct', label: 'Retail share',
    definition: 'Net sales to end customers over net sales, from the newest ready compliance snapshot that covers the month the period starts in '
      + '(in the market\'s time zone). Empty with reason no_snapshot when no such snapshot exists, no_value when its figure has no value.',
    source: 'compliance figure R1 customer_share_pct',
  },
  {
    key: 'partial', label: 'Order sync behind',
    definition: 'An order source of the market is behind or failing, so the period may lack orders.', source: 'integrations sync health (the run gate\'s evaluation)',
  },
]

const balance = (key: string, label: string, type: string): Definition => ({
  key, label, definition: `Balance of every ${type} account of the market (normal side). Minor units.`, source: `ledger accounts of type ${type}`,
})

export const FINANCE_DEFINITIONS: readonly Definition[] = [
  balance('payables_minor', 'Payables', 'payee_payable'),
  balance('in_transit_minor', 'In transit', 'payout_in_transit'),
  balance('receivables_minor', 'Receivables', 'clawback_receivable'),
  balance('withholding_minor', 'Withholding', 'withholding_payable'),
  {
    key: 'failed_payouts', label: 'Failed payouts',
    definition: 'Payout instructions that failed and that no later instruction retries; count and amount in minor units.', source: 'payout_instruction state failed, retry_of',
  },
]

export const COMPLIANCE_DEFINITIONS: readonly Definition[] = [
  {
    key: 'guardrail_warnings', label: 'Guardrail warnings',
    definition: 'Outstanding guardrail decisions of plan versions that are not retired and cover a market in scope.', source: 'guardrail_outstanding(plan version)',
  },
  { key: 'open_cases', label: 'Open cases', definition: 'Cases not yet decided (open or submitted), by type.', source: 'case_file state open, submitted' },
  { key: 'overdue_cases', label: 'Overdue cases', definition: 'Submitted cases past their due time.', source: 'case_file state submitted, due_at < now' },
]

export interface ListColumn {
  readonly key: string
  readonly permission: Permission
}

export interface ListDefinition {
  /** The list route's read permission: saved views of the list need it. */
  readonly permission: Permission
  readonly filters: z.ZodType
  readonly columns: readonly ListColumn[]
  readonly sorts: readonly string[]
}

const columnsOf = (keys: readonly string[], permission: Permission): ListColumn[] => keys.map((key) => ({ key, permission }))

/**
 * D-B6-08 saved-view registry: the lists with saved views, their filter schemas (mirroring the route query), columns
 * (each readable with the list's read permission: no column is masked today) and sort keys (PLAN B6 2.5).
 * shortcut: ledger entries mirror LED's route query and list fields here (LED exports no registry); take them from
 * led/index when LED exports one.
 */
export const LISTS = {
  orders: {
    permission: 'order.read', filters: z.strictObject(orderFilters), columns: columnsOf(Object.keys(ORDER_COLUMNS), 'order.read'), sorts: ORDER_SORTS,
  },
  ledger_entries: {
    permission: 'ledger.read',
    filters: z.strictObject({
      market_id: z.uuid().optional(), period_id: z.uuid().optional(),
      origin_type: z.enum(['run', 'payout_instruction', 'case', 'migration']).optional(), origin_id: z.uuid().optional(),
    }),
    columns: columnsOf(['posted_at', 'entry_id', 'market', 'period', 'event_type', 'origin_type', 'origin_id', 'debit_total', 'credit_total',
      'approval_id'], 'ledger.read'),
    sorts: ['posted_at_desc', 'posted_at_asc'],
  },
} as const satisfies Record<string, ListDefinition>

export type ListName = keyof typeof LISTS
export const LIST_NAMES = Object.keys(LISTS) as [ListName, ...ListName[]]
