// API shapes of SC-35 and the SC-33 KPI row (PLAN B6 2.4, apps/api/src/modules/rpt). Money is a minor-unit decimal string.

/** meta.definitions entries: what each figure counts and where it comes from. */
export interface Definition {
  readonly key: string
  readonly label: string
  readonly definition: string
  readonly source: string
}

export interface DashboardMarket {
  readonly id: string
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
}

export interface PeriodRef {
  readonly id: string
  readonly starts_at: string
  readonly ends_at: string
}

/** Figures of one finished period. Percentages are decimal strings with 2 places; null when not defined. */
export interface PeriodFigures {
  readonly net_sales_minor: string
  readonly payout_minor: string | null
  readonly payout_share_pct: string | null
  readonly active_earners: number
}

export interface ExecutiveRow extends PeriodFigures {
  readonly market: DashboardMarket
  readonly calendar_id: string
  readonly period: PeriodRef & { readonly state: string }
  readonly run_id: string | null
  readonly retail_share_pct: string | null
  readonly retail_share_reason: 'no_snapshot' | 'no_value' | null
  readonly retail_snapshot_id: string | null
  readonly partial: boolean
  readonly partial_reasons: readonly { readonly source: string; readonly name: string; readonly state: string }[]
}

/** GET /v1/dashboards/executive: the trend only when one market (or period) is selected. */
export interface ExecutiveDashboard {
  readonly rows: readonly ExecutiveRow[]
  readonly trend?: readonly (PeriodFigures & { readonly period: PeriodRef })[]
}

/** GET /v1/dashboards/finance?market_id. */
export interface FinanceDashboard {
  readonly market: DashboardMarket
  readonly payables_minor: string
  readonly in_transit_minor: string
  readonly receivables_minor: string
  readonly withholding_minor: string
  readonly failed_payouts: { readonly count: number; readonly amount_minor: string }
}
