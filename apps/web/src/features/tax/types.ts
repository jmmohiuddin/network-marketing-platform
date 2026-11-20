// API shapes of SC-12 (PLAN B-MKT §2.1). Money is minor-unit decimal strings, rates 6-dp decimal strings.
import type { BasisStatus } from '../markets/types'

export interface BasisFields {
  readonly basis: string
  readonly basis_status: BasisStatus
  readonly source_ref: string
  readonly reviewed_by: string | null
  readonly reviewed_at: string | null
  readonly effective_from: string
  readonly effective_to: string | null
}

export type ThresholdBasis = 'prior_year_payer_total' | 'current_year_cumulative'

export interface WithholdingRule extends BasisFields {
  readonly id: string
  readonly title: string
  readonly conditions: { readonly entity_types?: readonly string[]; readonly residency?: readonly string[] }
  /** null: no withholding duty in this market. */
  readonly rate: string | null
  readonly threshold_minor: string | null
  readonly threshold_basis: ThresholdBasis | null
  readonly missing_id_rate: string | null
  readonly rounding: string
  readonly in_force: boolean
}

export interface YearEndFormRule extends BasisFields {
  readonly id: string
  readonly form_type: string
  readonly title: string
  readonly min_gross_minor: string | null
  readonly in_force: boolean
}

export interface TaxYearRule extends BasisFields {
  readonly id: string
  readonly start_month: number
  readonly start_day: number
}

export interface TaxIdFormatRule extends BasisFields {
  readonly id: string
  readonly label: string
  readonly pattern: string
}

/** GET /v1/tax/rules?market_id. */
export interface TaxRules {
  readonly market: { readonly id: string; readonly code: string; readonly market_pack: string }
  readonly withholding: readonly WithholdingRule[]
  readonly year_end_forms: readonly YearEndFormRule[]
  readonly tax_year: TaxYearRule | null
  readonly tax_id_format: TaxIdFormatRule | null
}

export type RateBasis = 'rate' | 'missing_id_rate' | 'below_threshold' | 'no_duty'

/** GET /v1/tax/lines?run_id rows; meta {totals, run}. */
export interface TaxLine {
  readonly id: string
  readonly payee: { readonly id: string; readonly external_ref: string }
  readonly rule_id: string
  readonly rate: string
  readonly rate_basis: RateBasis
  readonly taxable_minor: string
  readonly withheld_minor: string
  readonly tax_year: number
  readonly tax_date: string
}

export type YearEndReason = 'FORM_NOT_DEFINED' | 'TAX_YEAR_NOT_DEFINED' | 'TAX_YEAR_NOT_ENDED' | 'TAX_YEAR_NOT_CLOSED'

export interface YearEndPayee {
  readonly participant: { readonly id: string; readonly external_ref: string }
  readonly gross_minor: string
  readonly taxable_minor: string
  readonly withheld_minor: string
  readonly tax_id: 'present' | 'missing'
  readonly included: boolean
  readonly latest_version: number | null
}

/** GET /v1/tax/year-end?market_id&tax_year (payees paged by external ref; totals over all). */
export interface YearEnd {
  readonly bounds: { readonly starts_on: string; readonly ends_on: string } | null
  readonly ended: boolean
  readonly open_period_ids: readonly string[]
  readonly form_rule: { readonly id: string; readonly form_type: string; readonly title: string; readonly min_gross_minor: string | null } | null
  readonly reasons: readonly YearEndReason[]
  readonly totals: { readonly withheld_minor: string; readonly ledger_withheld_minor: string; readonly equal: boolean; readonly included: number; readonly held: number }
  readonly payees: readonly YearEndPayee[]
}

export interface HeldPayee {
  readonly participant_id: string
  readonly external_ref: string
}

/** POST /v1/tax/year-end-forms answer. */
export interface GenerationResult {
  readonly generation_id: string
  readonly generated: number
  readonly unchanged: number
  readonly held: readonly HeldPayee[]
}

/** GET /v1/tax/year-end-generations rows, newest first. */
export interface Generation {
  readonly id: string
  readonly form_type: string
  readonly generated: number
  readonly unchanged: number
  readonly held: readonly HeldPayee[]
  readonly withheld_total_minor: string
  readonly created_by: { readonly id: string; readonly display_name: string | null }
  readonly created_at: string
}

export interface FormTotals {
  readonly gross_minor: string
  readonly taxable_minor: string
  readonly withheld_minor: string
  readonly by_rule: readonly { readonly rule_id: string; readonly rate: string; readonly taxable_minor: string; readonly withheld_minor: string }[]
}

/** GET /v1/tax/year-end-forms rows: the latest version per payee. */
export interface TaxForm {
  readonly id: string
  readonly participant: { readonly id: string; readonly external_ref: string }
  readonly form_type: string
  readonly version: number
  readonly versions: number
  readonly tax_id_masked: string
  readonly currency: string
  readonly totals: FormTotals
  readonly created_at: string
}
