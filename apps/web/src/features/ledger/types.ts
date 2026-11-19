// API-23/24 shapes of SC-33 (PLAN B4 §2.1, apps/api/src/modules/led). Money is a minor-unit decimal string; times ISO strings.

export type AccountType =
  | 'commission_expense' | 'payee_payable' | 'withholding_payable' | 'payout_in_transit' | 'clawback_receivable' | 'rounding_residue'
  | 'write_off' | 'credit_liability' | 'breakage' | 'settled_clearing'

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
  readonly origin_type: 'run' | 'payout_instruction' | 'case'
  readonly origin_id: string
  readonly idempotency_key: string
  readonly period: PeriodBounds
  readonly posted_at: string
  readonly approved_by: PersonRef | null
  readonly debit_total_minor: string
  readonly posting_count: number
}

/** GET /v1/ledger/entries/:id. */
export interface EntryDetail extends Omit<JournalEntry, 'debit_total_minor' | 'posting_count'> {
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
}

/** GET /v1/payees/:id/balances rows. */
export interface PayeeBalance {
  readonly market: { readonly id: string; readonly code: string; readonly currency: string }
  readonly payable_minor: string
  readonly in_transit_minor: string
  readonly receivable_minor: string
}
