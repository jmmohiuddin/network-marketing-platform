// API-23/24 shapes of SC-33 (PLAN B4 §2.1, apps/api/src/modules/led). Money is a minor-unit decimal string; times ISO strings.

export type AccountType =
  | 'commission_expense' | 'payee_payable' | 'withholding_payable' | 'payout_in_transit' | 'clawback_receivable' | 'rounding_residue'
  | 'write_off' | 'credit_liability' | 'breakage' | 'settled_clearing' | 'migration_clearing'

export interface PersonRef {
  readonly id: string
  readonly display_name: string | null
}

export interface PayeeRef {
  readonly id: string
  readonly external_ref: string
  readonly display_name: string | null
}

export interface PeriodBounds {
  readonly id: string
  readonly starts_at: string
  readonly ends_at: string
}

/** GET /v1/ledger/summary?market_id. */
export interface LedgerSummary {
  readonly market: { readonly id: string; readonly code: string; readonly currency: string; readonly minor_digits: number }
  readonly by_type: readonly {
    readonly type: AccountType
    readonly normal: 'debit' | 'credit'
    readonly debit_minor: string
    readonly credit_minor: string
    readonly balance_minor: string
  }[]
  readonly balanced: boolean
  readonly entry_count: number
}

/** GET /v1/ledger/entries rows. */
export interface JournalEntry {
  readonly id: string
  readonly event_type: string
  readonly origin_type: 'run' | 'payout_instruction' | 'case' | 'migration' | 'credit_redemption' | 'credit_award'
  readonly origin_id: string
  readonly idempotency_key: string
  readonly period: PeriodBounds
  readonly posted_at: string
  readonly approved_by: PersonRef | null
  readonly debit_total_minor: string
  readonly credit_total_minor: string
  readonly posting_count: number
  readonly market: { readonly id: string; readonly code: string }
  readonly approval_id: string | null
}

/** GET /v1/ledger/entries/:id. */
export interface EntryDetail extends Omit<JournalEntry, 'debit_total_minor' | 'credit_total_minor' | 'posting_count' | 'market' | 'approval_id'> {
  readonly postings: readonly {
    readonly id: string
    readonly account: { readonly id: string; readonly type: AccountType }
    readonly payee: PayeeRef | null
    readonly debit_minor: string
    readonly credit_minor: string
  }[]
}

/** GET /v1/ledger/accounts rows. */
export interface LedgerAccount {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly type: AccountType
  readonly payee: PayeeRef | null
  readonly currency: string
  readonly debit_minor: string
  readonly credit_minor: string
  readonly balance_minor: string
  readonly gl_code: string | null
}

/** GET /v1/ledger/accounts/:id/postings rows. */
export interface AccountPosting {
  readonly id: string
  readonly debit_minor: string
  readonly credit_minor: string
  readonly entry: {
    readonly id: string
    readonly event_type: string
    readonly origin_type: string
    readonly origin_id: string
    readonly period_id: string
    readonly posted_at: string
    readonly approved_by: PersonRef | null
  }
}

export type AgeBucket = '0_30' | '31_60' | '61_90' | 'over_90'

/** GET /v1/ledger/receivables rows (meta.totals_by_bucket). */
export interface Receivable {
  readonly participant: PayeeRef
  readonly market: { readonly id: string; readonly code: string }
  /** The payee's clawback_receivable account: the subject of a write_off case. */
  readonly account_id: string
  readonly balance_minor: string
  readonly outstanding_since: string
  readonly age_days: number
  readonly bucket: AgeBucket
  /** null while write_offs.policy is not set. */
  readonly write_off_eligible: boolean | null
  readonly open_write_off_case_id: string | null
}

export interface BucketTotal {
  readonly bucket: AgeBucket
  readonly count: number
  readonly amount_minor: string
}

/** GET /v1/ledger/gl-mappings rows (all ten types). */
export interface GlMapping {
  readonly account_type: AccountType
  readonly gl_code: string | null
  readonly updated_by: PersonRef | null
  readonly updated_at: string | null
}

/** GET /v1/ledger/journal-exports rows and POST 201. */
export interface JournalExport {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly period: PeriodBounds
  readonly line_count: number
  readonly debit_total_minor: string
  readonly credit_total_minor: string
  readonly content_sha256: string
  readonly created_by: { readonly id: string | null; readonly type: string }
  readonly created_at: string
  /** The export the period's close generated (PLAN B6 2.2). */
  readonly created_at_close: boolean
}

/** GET /v1/payees/:id/balances rows. */
export interface PayeeBalance {
  readonly market: { readonly id: string; readonly code: string; readonly currency: string }
  readonly payable_minor: string
  readonly in_transit_minor: string
  readonly receivable_minor: string
}

// API-23 credits and FX (PLAN V1-A 2.1, 2.2; apps/api/src/modules/led credit-types.ts, credits.ts, fx-rates.ts).

export interface CreditScope {
  readonly markets?: readonly string[]
  readonly item_classes?: readonly string[]
}

/** GET /v1/credit-types rows (tenant-wide). */
export interface CreditType {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly unit_value_minor: string | null
  readonly expiry_days: number | null
  readonly expiry_notice_days: number | null
  readonly redemption_scope: CreditScope | null
  readonly taxable: boolean
  readonly active: boolean
  readonly updated_at: string
}

export interface CreditTypeRef {
  readonly id: string
  readonly code: string
  readonly name: string
}

/** GET /v1/credits/balances rows (meta.totals per currency). */
export interface CreditBalance {
  readonly participant: { readonly id: string; readonly external_ref: string }
  readonly credit_type: CreditTypeRef
  readonly market_id: string
  readonly currency: string
  readonly balance_minor: string
  readonly available_minor: string
  readonly next_expiry: { readonly on: string; readonly amount_minor: string } | null
}

/** GET /v1/credits/lots rows: one award each. */
export interface CreditLot {
  readonly award_id: string
  readonly run_id: string
  readonly committed_at: string
  /** YYYY-MM-DD (date text from the API). */
  readonly expires_on: string | null
  readonly amount_minor: string
  readonly remaining_minor: string
  readonly notified_at: string | null
  readonly expired_at: string | null
}

/** GET /v1/credits/redemptions rows. */
export interface CreditRedemption {
  readonly id: string
  readonly participant: { readonly id: string; readonly external_ref: string }
  readonly credit_type: CreditTypeRef
  readonly amount_minor: string
  readonly currency: string
  readonly item_class: string | null
  readonly occurred_at: string
  readonly source_system: string
  readonly source_redemption_id: string
  readonly entry_id: string | null
}

/** GET /v1/fx-rates rows; rates are 10-dp decimal strings. */
export interface FxRate {
  readonly id: string
  readonly base: string
  readonly quote: string
  readonly rate: string
  readonly source: string
  readonly valid_from: string
  readonly batch_id: string
  readonly in_force: boolean
}

export interface FxRateRow {
  readonly base: string
  readonly quote: string
  readonly rate: string
  readonly valid_from: string
}

export type FxBatchState = 'proposed' | 'approved' | 'rejected'

/** GET /v1/fx-rate-batches rows and the POST/decision answers. */
export interface FxBatch {
  readonly id: string
  readonly source: string
  readonly rows: readonly FxRateRow[]
  readonly state: FxBatchState
  readonly proposed_by: { readonly id: string; readonly name: string }
  readonly proposed_at: string
  readonly decided_at: string | null
  readonly approver: { readonly id: string; readonly name: string } | null
}
