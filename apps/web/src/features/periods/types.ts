// API shapes of SC-01 / SC-02 (PLAN B3 §2.3). Money and volumes are minor-unit decimal strings; timestamps ISO strings.
import type { EligibleApprover } from '../admin/settings/types'

export type PeriodState = 'open' | 'calculating' | 'calculated' | 'committed' | 'paid' | 'closed'
export type RunState = 'queued' | 'running' | 'calculated' | 'committed' | 'discarded' | 'failed'

export interface Calendar {
  readonly id: string
  readonly name: string
  readonly cadence: string
  readonly cutoff_time_zone: string
  readonly market: { readonly id: string; readonly code: string }
  readonly plan: { readonly id: string; readonly name: string } | null
  /** D-V1A-02 (PLAN V1-A 2.5): the final calendar this one pays advances for, and the provisional calendars of this one. */
  readonly provisional_for: CalendarRef | null
  readonly provisional_calendars: readonly CalendarRef[]
}

export interface CalendarRef {
  readonly id: string
  readonly name: string
}

/** §2.4 preflight refusal, as a blocker of the period. */
export interface Blocker {
  readonly code: string
  readonly message: string
  readonly details: Readonly<Record<string, unknown>>
}

export interface PeriodRow {
  readonly id: string
  readonly calendar_id: string
  readonly starts_at: string
  readonly ends_at: string
  readonly cut_off_passed: boolean
  readonly state: PeriodState
  readonly committed_run_id: string | null
  /** true_up_runs: the provisional runs the latest run trues up (D-V1A-02; 0 outside final calendars). */
  readonly latest_run: {
    readonly id: string; readonly state: RunState; readonly gross_minor: string | null; readonly finished_at: string | null; readonly true_up_runs: number
  } | null
  readonly blockers: readonly Blocker[]
  readonly late: { readonly pending: number; readonly decided: number }
  /** D-B6-04: set once the period is closed (user id). */
  readonly closed_at: string | null
  readonly closed_by: string | null
}

/** GET /v1/periods/:id/close-check: what stops the close (D-B6-04); each blocker names its object in `id`. */
export interface CloseCheck {
  readonly state: PeriodState
  readonly closable: boolean
  readonly blockers: readonly { readonly kind: string; readonly id: string }[]
  readonly gl_unmapped: readonly string[]
}

/** GET /v1/periods. */
export interface PeriodList {
  readonly calendars: readonly Calendar[]
  readonly periods: readonly PeriodRow[]
}

export interface SyncSource {
  readonly source: string
  readonly name: string
  readonly state: string
  readonly last_success_at: string | null
}

export interface Sync {
  readonly state: 'failing' | 'behind' | 'thresholds_not_set' | 'healthy' | 'none'
  readonly last_sync_at: string | null
  readonly sources: readonly SyncSource[]
}

export interface PlanVersionRef {
  readonly id: string
  readonly plan: { readonly id: string; readonly name: string }
  readonly version: number
}

/** GET /v1/periods/:id. */
export interface PeriodDetail {
  readonly id: string
  readonly calendar_id: string
  readonly market_id: string
  readonly starts_at: string
  readonly ends_at: string
  readonly cut_off_passed: boolean
  readonly state: PeriodState
  readonly committed_run_id: string | null
  readonly runs: readonly { readonly id: string; readonly state: RunState; readonly prepared_by: Person; readonly started_at: string | null; readonly finished_at: string | null; readonly gross_minor: string | null }[]
  readonly plan_version: PlanVersionRef | null
  readonly blockers: readonly Blocker[]
  readonly sync: Sync
  readonly late: { readonly pending: number; readonly decided: number; readonly consumed: number }
  readonly restatements: readonly { readonly id: string; readonly case_id: string; readonly state: string }[]
}

export interface Person {
  readonly id: string
  readonly display_name: string | null
}

/** run.totals: control totals (gross_minor = Σ lines). */
export interface RunTotals {
  readonly gross_minor: string
  readonly line_count: number
  readonly payee_count: number
}

/** GET /v1/runs/:id. */
export interface RunDetail {
  readonly id: string
  readonly period_id: string
  readonly state: RunState
  readonly progress: string | null
  readonly totals: RunTotals | null
  readonly error: { readonly code: string; readonly message: string } | null
  readonly inputs_hash: string | null
  readonly lines_hash: string | null
  readonly engine_version: string
  readonly prepared_by: Person
  readonly review_opened_at: string | null
  readonly commit_requested_at: string | null
  readonly commit_requested_by: string | null
  readonly finished_at: string | null
  readonly committed_at: string | null
  /** B4: the journal entry posted at commit (null without lines or before commit). */
  readonly journal_entry_id?: string | null
  readonly plan_version: PlanVersionRef
  /** D-V1A-02: a run of a provisional period names the final period that trues it up. */
  readonly provisional: { readonly final_period_id: string | null; readonly final_calendar_id: string } | null
  /** A final run: the provisional runs it trues up and the Σ of their offsets. */
  readonly true_up: { readonly provisional_run_ids: readonly string[]; readonly offsets_minor: string } | null
  /** D-V1A-03: Σ of the run's credit awards (not cash). */
  readonly credit_awards_minor: string
  readonly snapshot: { readonly known_at: string; readonly row_counts: Readonly<Record<string, number>> } | null
}

export interface Participant {
  readonly id: string
  readonly external_ref: string
  readonly display_name: string | null
}

export interface RunException {
  readonly id: string
  readonly kind: string
  readonly blocking: boolean
  readonly message: string
  readonly ref: string | null
}

/** GET /v1/runs/:id/review (D-B3-11). */
export interface RunReview {
  readonly comparison: { readonly run_id: string; readonly period: { readonly id: string; readonly starts_at: string; readonly ends_at: string } } | null
  readonly totals: { readonly current: RunTotals; readonly previous: RunTotals | null }
  readonly variance: readonly { readonly rule_key: string; readonly kind: string; readonly pass: number; readonly previous_minor: string; readonly current_minor: string; readonly delta_minor: string }[]
  readonly movers: readonly { readonly participant: Participant; readonly previous_minor: string; readonly current_minor: string; readonly delta_minor: string }[]
  readonly exceptions: readonly RunException[]
  readonly changes: {
    readonly plan_version_changed: boolean
    readonly previous_plan_version: string | null
    readonly settings_version_changed: boolean
    readonly inputs: { readonly current: Readonly<Record<string, number>> | null; readonly previous: Readonly<Record<string, number>> | null }
    readonly transition_changes: number
    readonly cap_applications: readonly { readonly capKey: string; readonly method: string; readonly bound: boolean; readonly affected: readonly unknown[] }[]
  }
  readonly adjustments: readonly { readonly origin_type: string; readonly count: number; readonly amount_minor: string }[]
}

/** GET /v1/runs/:id/transitions rows. */
export interface TransitionRow {
  readonly position_id: string
  readonly participant: Participant | null
  readonly changed: readonly { readonly state_item: string; readonly before: string; readonly after: string }[]
}

/** GET /v1/runs/:id/lines rows. */
export interface ResultLine {
  readonly id: string
  readonly payee_position_id: string
  readonly payee_participant_id: string
  readonly rule_key: string
  readonly bonus_type: string
  readonly source_kind: string
  readonly pass: number
  readonly amount_minor: string
  readonly currency: string
  readonly origin_type: string | null
  readonly origin_id: string | null
  readonly original_period_id: string | null
}

export interface TraceSource {
  readonly positionId: string | null
  readonly level: number | null
  readonly measure: string | null
  readonly rate: string | null
  readonly orders: readonly { readonly orderId: string }[]
}

/** The compact engine trace stored with a line (bigints as decimal strings). */
export interface CompactTrace {
  readonly rule: string
  readonly kind: string
  readonly pass: number
  readonly planVersionId: string
  readonly engineVersion: string
  readonly rankEvaluated: readonly { readonly ladder: string; readonly rank: string | null }[]
  readonly sources: readonly TraceSource[]
  readonly omitted: { readonly count: number }
  readonly steps: readonly { readonly step: string; readonly mode?: string; readonly key?: string }[]
}

/** GET /v1/result-lines/:id/trace (?expand=true adds explanation and the full trace). */
export interface LineTrace {
  readonly line: ResultLine
  readonly trace: CompactTrace
  readonly explanation: { readonly lines: readonly string[]; readonly reconciles: boolean } | null
  readonly expressions: readonly { readonly rule_key: string; readonly expr: unknown }[]
}

/** POST /v1/runs/:id/replay. */
export interface ReplayResult {
  readonly status: 'match' | 'inputs_differ' | 'result_differs'
  readonly inputs_hash: string
  readonly result_hash: string | null
  readonly lines_hash: string | null
  readonly engine_version: string
}

/** POST /v1/runs/:id/request-commit. */
export interface CommitRequest {
  readonly commit_requested_at: string
  readonly eligible_approvers: readonly EligibleApprover[]
}

/** GET /v1/runs/:id/true-up (payees cursor-paged). */
export interface TrueUp {
  readonly final_period: { readonly id: string; readonly starts_at: string; readonly ends_at: string }
  readonly provisional_runs: readonly {
    readonly run_id: string
    readonly period_id: string
    readonly starts_at: string
    readonly ends_at: string
    readonly committed_at: string
    readonly gross_minor: string
  }[]
  readonly payees: readonly {
    readonly participant: { readonly id: string; readonly external_ref: string }
    readonly final_minor: string
    readonly provisional_minor: string
    readonly true_up_minor: string
  }[]
  readonly totals: { readonly final_minor: string; readonly provisional_minor: string; readonly true_up_minor: string }
}

/** GET /v1/runs/:id/credit-awards rows (meta.totals per credit type). */
export interface CreditAward {
  readonly id: string
  readonly participant: { readonly id: string; readonly external_ref: string }
  readonly position_ref: string
  readonly rule_key: string
  readonly credit_type: { readonly code: string; readonly name: string }
  readonly amount_minor: string
  readonly expiry_days: number | null
  readonly taxable: boolean
}
