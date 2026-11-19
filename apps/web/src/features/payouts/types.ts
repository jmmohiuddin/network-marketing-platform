import type { EligibleApprover } from '../admin/settings/types'

// API-25 payout shapes (PLAN B4 2.3). Money is minor units as decimal strings, never numbers.

export const BATCHES_PATH = '/v1/payout-batches'
export const PROVIDERS_PATH = '/v1/provider-configs'
export const DORMANT_PATH = '/v1/payouts/dormant'
export const SUMMARY_PATH = '/v1/payout-reconciliation/summary'
export const ITEMS_PATH = '/v1/payout-reconciliation/items'
export const EXCEPTIONS_PATH = '/v1/payout-exceptions'

export interface PersonRef {
  readonly id: string
  readonly display_name: string | null
}

export interface PayeeRef {
  readonly id: string
  readonly external_ref: string | null
  readonly display_name: string | null
}

export type Adapter = 'sandbox' | 'bank_file_csv'
export type BatchState = 'draft' | 'reviewed' | 'approved' | 'instructing' | 'partially_settled' | 'settled' | 'failed' | 'cancelled'
export type InstructionState = 'pending' | 'instructed' | 'accepted' | 'settled' | 'returned' | 'failed' | 'cancelled'

/** One D-B4-12 exclusion reason; detail carries minimum_minor, until, case_id, hold_id + reason + placed_at or batch_id. */
export interface Reason {
  readonly reason: string
  readonly detail: Readonly<Record<string, unknown>>
}

export interface Exclusion {
  readonly participant: PayeeRef
  readonly reasons: readonly Reason[]
}

/** GET /v1/payout-batches(/:id). */
export interface Batch {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly provider: { readonly id: string; readonly provider: string; readonly adapter: Adapter | null; readonly state: 'recorded' | 'withdrawn' }
  readonly period: { readonly id: string; readonly starts_at: string; readonly ends_at: string; readonly state: string }
  readonly state: BatchState
  readonly total_minor: string
  readonly currency: string
  readonly line_count: number
  readonly exclusions: readonly Exclusion[]
  readonly instruction_counts: Readonly<Partial<Record<InstructionState, number>>>
  readonly prepared_by: PersonRef
  readonly submitted_by: PersonRef | null
  readonly approved_by: PersonRef | null
  readonly submitted_at: string | null
  readonly approved_at: string | null
  readonly cancelled_at: string | null
  readonly cancel_reason: string | null
  readonly created_at: string
  /** Detail only: who may approve while the batch is reviewed, else null. */
  readonly eligible_approvers?: readonly EligibleApprover[] | null
}

export interface BatchLine {
  readonly participant: PayeeRef
  readonly amount_minor: string
  readonly bank_detail: { readonly id: string; readonly masked: string }
}

export interface Instruction {
  readonly id: string
  readonly participant: PayeeRef
  readonly amount_minor: string
  readonly state: InstructionState
  readonly provider_ref: string | null
  readonly attempts: number
  readonly last_error: string | null
  readonly next_attempt_at: string | null
  readonly bank_detail_masked: string
  readonly updated_at: string
}

/** POST …/retry-failed. */
export interface RetryResult {
  readonly batch: Batch
  readonly reinstructed: readonly string[]
  readonly skipped: readonly Exclusion[]
}

/** GET /v1/payouts/dormant item. */
export interface DormantBalance {
  readonly market_id: string
  readonly participant: PayeeRef
  readonly payable_minor: string
  readonly payable_since: string
  readonly last_settled_at: string | null
}

export interface CountAmount {
  readonly count: number
  readonly amount_minor: string
}

/** GET /v1/payout-reconciliation/summary provider. */
export interface ProviderSummary {
  readonly id: string
  readonly provider: string
  readonly market_id: string
  readonly in_transit: CountAmount
  readonly settled: CountAmount
  readonly returned: CountAmount
  readonly failed: CountAmount
  readonly open_exceptions: number
}

export interface ItemEvent {
  readonly type: string
  readonly at: string
  readonly source: 'platform' | 'provider'
}

/** GET /v1/payout-reconciliation/items item: an instruction with its events. */
export interface ReconciliationItem {
  readonly id: string
  readonly batch_id: string
  readonly market_id: string
  readonly provider_config_id: string
  readonly participant: PayeeRef
  readonly amount_minor: string
  readonly currency: string
  readonly state: InstructionState
  readonly provider_ref: string | null
  readonly last_error: string | null
  readonly events: readonly ItemEvent[]
  readonly returned_case_id: string | null
}

export interface PayoutException {
  readonly id: string
  readonly provider_config_id: string
  readonly kind: 'unknown_reference' | 'amount_mismatch' | 'duplicate_settlement'
  readonly reference: string
  readonly amount_minor: string | null
  readonly instruction_id: string | null
  readonly state: 'open' | 'resolved'
  readonly created_at: string
  readonly resolved_by: PersonRef | null
  readonly resolved_at: string | null
  readonly resolution_note: string | null
}

/** POST /v1/payout-providers/:id/settlement-reports. */
export interface ImportResult {
  readonly rows: number
  readonly settled: number
  readonly returned: number
  readonly failed: number
  readonly exceptions: number
  readonly unchanged: number
}

/** GET /v1/ledger/entries item and GET /v1/ledger/entries/:id postings (LED, ledger.read). */
export interface LedgerEntry {
  readonly id: string
  readonly event_type: string
  readonly posted_at: string
  readonly postings?: readonly {
    readonly id: string
    readonly account: { readonly id: string; readonly type: string }
    readonly payee: PayeeRef | null
    readonly debit_minor: string
    readonly credit_minor: string
  }[]
}
