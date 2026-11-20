// API-38 response shapes (apps/api/src/modules/mig): money as minor-unit decimal strings, instants ISO strings.

export type MigrationState = 'draft' | 'applied' | 'opening_submitted' | 'opening_posted' | 'signed_off' | 'cancelled'
export type ParallelRunState = 'calculating' | 'compared' | 'failed' | 'superseded'
export type DifferenceClass = 'rule' | 'data' | 'rounding'

export interface Person {
  readonly id: string
  readonly display_name: string | null
}

export interface ApprovalRef {
  readonly id: string
  readonly by: Person
  readonly at: string
}

/** GET /v1/migrations(/:id). */
export interface Migration {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string; readonly currency: string }
  /** period_from / period_to: YYYY-MM. */
  readonly batch: { readonly id: string; readonly period_from: string; readonly period_to: string; readonly row_counts: Readonly<Record<string, number>> | null }
  readonly cutover_period: { readonly id: string; readonly starts_at: string; readonly ends_at: string; readonly state: string }
  readonly volume_key: string
  readonly state: MigrationState
  readonly applied_counts: Readonly<Record<string, number>> | null
  readonly applied_at: string | null
  readonly opening: {
    readonly balances: { readonly count: number; readonly total_minor: string }
    readonly state_rows: number
    readonly submitted_by: string | null
    readonly submitted_at: string | null
    readonly approval: ApprovalRef | null
    readonly journal_entry_id: string | null
  }
  readonly latest_parallel_run: { readonly id: string; readonly state: ParallelRunState; readonly unexplained: number } | null
  readonly signoff: ApprovalRef | null
  /** The bonus types of the batch's legacy payouts in the cutover month, sorted ('' = lines without one). */
  readonly legacy_bonus_types: readonly string[]
  readonly created_by: string
  readonly created_at: string
}

/** GET /v1/migrations/:id/parallel-runs (newest first). */
export interface ParallelRun {
  readonly id: string
  readonly state: ParallelRunState
  readonly bonus_map: Readonly<Record<string, string>>
  readonly legacy_total_minor: string | null
  readonly platform_total_minor: string | null
  readonly error: { readonly code: string } | null
  readonly requested_at: string
  readonly compared_at: string | null
  readonly summary: {
    readonly payees: number
    readonly zero: number
    readonly by_class: Readonly<Record<DifferenceClass | 'unclassified', number>>
    readonly accepted: number
    readonly unexplained: number
  }
  readonly bonus_detail_missing: boolean
}

/** GET …/parallel-runs/:runId/differences. */
export interface Difference {
  readonly id: string
  readonly participant: { readonly id: string; readonly external_ref: string; readonly display_name: string | null } | null
  readonly payee_ref: string
  /** null: the payee-level row (legacy file lacks bonus detail). */
  readonly rule_key: string | null
  readonly legacy_bonus_types: readonly string[]
  readonly bonus_detail: boolean
  readonly legacy_minor: string
  readonly platform_minor: string
  readonly delta_minor: string
  readonly class: DifferenceClass | null
  readonly class_note: string | null
  readonly classified_by: string | null
  readonly accepted_at: string | null
}

/** GET /v1/migrations/:id/opening. */
export interface OpeningRow {
  readonly participant: { readonly id: string; readonly external_ref: string }
  readonly amount_minor: string | null
  readonly state: {
    readonly paid_as: readonly { readonly ladder: string; readonly rank: string }[]
    readonly titles: readonly { readonly ladder: string; readonly rank: string }[]
    readonly counters: readonly { readonly key: string; readonly value: number }[]
    readonly carry: readonly { readonly key: string; readonly amountMinor: string }[]
    readonly one_time_flags: readonly string[]
    readonly banked: readonly { readonly key: string; readonly amountMinor: string }[]
  } | null
}

export interface Finding {
  readonly row?: number | null
  readonly code: string
  readonly ref?: string
  readonly detail: string
}
