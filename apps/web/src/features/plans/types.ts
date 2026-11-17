// API-16 / API-17 response shapes used by SC-04, SC-05 and SC-42 (apps/api/src/modules/pln, comp/simulations.ts).

export type VersionState = 'draft' | 'in_review' | 'approved' | 'scheduled' | 'active' | 'retired'
export type CreditingEvent = 'paid' | 'fulfilled'
export type ReversalPolicy = 'order_line' | 'restatement'

export interface CalendarRef {
  readonly id: string
  readonly name: string
  readonly cadence: string
  readonly market_code: string
}

/** GET /v1/plans item (and the plan part of GET /v1/plans/:id). */
export interface PlanSummary {
  readonly id: string
  readonly name: string
  readonly brand: { readonly id: string; readonly name: string } | null
  readonly markets: readonly { readonly id: string; readonly code: string }[]
  readonly calendars: readonly CalendarRef[]
  readonly current_version: { readonly id: string; readonly version: number; readonly state: VersionState; readonly effective_from: string | null } | null
  readonly authoring_version: { readonly id: string; readonly version: number; readonly state: VersionState } | null
}

export interface VersionListItem {
  readonly id: string
  readonly version: number
  readonly state: VersionState
  readonly effective_from: string | null
  readonly submitted_by: string | null
  readonly approved_by: string | null
  readonly activated_by: string | null
  readonly created_at: string
}

export interface PlanDetail extends PlanSummary {
  readonly versions: readonly VersionListItem[]
}

export interface Rule {
  readonly rule_key: string
  readonly kind: string
  readonly pass: string
  readonly params: Readonly<Record<string, unknown>>
  readonly depends_on: readonly string[]
  readonly reversal_policy: ReversalPolicy | null
  readonly calendar_id: string | null
  readonly ordinal: number
  readonly extension: boolean
  readonly rendering: string
}

export interface Transition {
  readonly state_item: string
  readonly rule: 'carry' | 'map' | 'reset'
  readonly map: readonly { readonly from: string; readonly to: string }[]
  readonly reason: string | null
}

export interface ValidationError {
  readonly rule_key: string | null
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface Actor {
  readonly id: string
  readonly display_name: string | null
}

/** Guardrail decision view (cpl/guardrails.ts DECISION_VIEW). */
export interface Decision {
  readonly id: string
  readonly kind: 'evaluation' | 'acknowledgement' | 'override'
  readonly outcome: 'blocked' | 'warned' | 'reported'
  readonly detail: { readonly rule_keys: readonly string[]; readonly explanation: string; readonly opaque: boolean }
  readonly decided_at: string
  readonly refers_to_decision_id: string | null
  readonly plan_version_id: string
  readonly rule: {
    readonly id: string
    readonly title: string
    readonly outcome: string
    readonly overridable: boolean
    readonly mandatory: boolean
    readonly basis: string
    readonly basis_status: string
    readonly source_ref: string | null
    readonly market_pack: string
  }
  readonly plan: { readonly id: string; readonly name: string }
  readonly version: { readonly id: string; readonly version: number; readonly state: VersionState }
  readonly decided_by: Actor
  readonly acknowledgement: { readonly id: string; readonly decided_by: Actor; readonly decided_at: string } | null
  readonly override: { readonly id: string; readonly justification: string; readonly approved_by: Actor; readonly evidence_document_id: string | null; readonly decided_at: string } | null
}

export interface Outstanding {
  readonly decision_id: string
  readonly rule_id: string
  readonly outcome: string
  readonly reason: string
}

export interface Mismatch {
  readonly payee_position_id: string
  readonly rule_key: string
  readonly origin_type: string | null
  readonly origin_id: string | null
  readonly expected_minor: string
  readonly actual_minor: string
}

export interface GoldenResult {
  readonly status: 'pass' | 'fail'
  readonly mismatches: readonly Mismatch[]
  readonly error: { readonly code: string; readonly message: string } | null
  readonly content_hash?: string
}

export interface Golden {
  readonly id: string
  readonly name: string
  readonly calendar_id: string
  readonly covers: readonly string[]
  readonly source_simulation_id?: string | null
  readonly last_result: GoldenResult | null
  readonly last_run_at: string | null
}

export type GateName = 'validation' | 'crediting_event' | 'goldens' | 'coverage' | 'guardrails' | 'simulation' | 'transitions'

/** GET /v1/plans/:id/versions/:v (ETag "<revision>"). */
export interface VersionView {
  readonly id: string
  readonly plan_id: string
  readonly version: number
  readonly state: VersionState
  readonly revision: number
  readonly effective_from: string | null
  readonly justification: string | null
  readonly engine_version: string
  readonly crediting_event: CreditingEvent | null
  readonly placement_width: number | null
  readonly content_hash: string | null
  readonly based_on_version_id: string | null
  readonly submitted_by: string | null
  readonly submitted_at: string | null
  readonly approved_by: string | null
  readonly activated_by: string | null
  readonly activated_at: string | null
  readonly retired_at: string | null
  readonly created_by: string
  readonly created_at: string
  readonly rules: readonly Rule[]
  readonly transitions: readonly Transition[]
  readonly validation: { readonly ok: boolean; readonly errors: readonly ValidationError[] }
  readonly guardrails: { readonly decisions: readonly Decision[]; readonly outstanding: readonly Outstanding[] }
  readonly goldens: readonly Golden[]
  readonly simulations: readonly VersionSimulation[]
  readonly gates: Readonly<Record<GateName, boolean>>
  readonly uncovered_extension_rules: readonly string[]
  readonly missing_transitions: readonly string[]
}

export interface DiffView {
  readonly fields: readonly { readonly name: string; readonly before: unknown; readonly after: unknown }[]
  readonly rules: {
    readonly added: readonly Rule[]
    readonly removed: readonly Rule[]
    readonly changed: readonly { readonly rule_key: string; readonly before: Rule; readonly after: Rule; readonly rendering_before: string; readonly rendering_after: string }[]
  }
  readonly transitions: {
    readonly added: readonly Transition[]
    readonly removed: readonly Transition[]
    readonly changed: readonly { readonly state_item: string; readonly before: Transition; readonly after: Transition }[]
  }
}

export type SimulationState = 'queued' | 'running' | 'completed' | 'failed'

export interface SimulationTotals {
  readonly simulated_minor: string
  readonly baseline_minor: string | null
  readonly delta_minor: string | null
}

/** A simulation of the version as GET …/versions/:v lists it, newest first, with its period. */
export interface VersionSimulation {
  readonly id: string
  readonly state: SimulationState
  readonly finished_at: string | null
  readonly period: { readonly id: string; readonly calendar_id: string; readonly starts_at: string; readonly ends_at: string }
}

/** GET /v1/simulations item. */
export interface SimulationRow {
  readonly id: string
  readonly plan_version_id: string
  readonly period_id: string
  readonly kind: 'simulation'
  readonly state: SimulationState
  readonly baseline_run_id: string | null
  readonly content_hash: string
  readonly error: { readonly code: string; readonly message: string } | null
  readonly requested_by: string
  readonly requested_at: string
  readonly finished_at: string | null
  readonly totals: (SimulationTotals & { readonly line_count?: number }) | null
}

export interface CapEffect {
  readonly cap_key: string
  readonly method: string
  readonly base_minor: string
  readonly cap_minor: string
  readonly proposed_minor: string
  readonly bound: boolean
  readonly affected: readonly { readonly payee_position_id: string; readonly rule_key: string; readonly before_minor: string; readonly after_minor: string }[]
}

export interface Comparison {
  readonly by_rule: readonly { readonly rule_key: string; readonly baseline_minor: string; readonly simulated_minor: string; readonly delta_minor: string }[]
  readonly distribution: readonly { readonly bucket: string; readonly payees: number }[]
  readonly cap_effects: readonly CapEffect[]
  readonly guardrail_flags: readonly Outstanding[]
  readonly payees_changed: number
  readonly reconciles: boolean
}

/** GET /v1/simulations/:id. */
export interface SimulationDetail {
  readonly simulation: Omit<SimulationRow, 'totals'>
  readonly totals: SimulationTotals | null
  readonly comparison: Comparison | null
  readonly warnings: readonly { readonly code: string; readonly message: string; readonly ref: unknown }[]
}

/** GET /v1/simulations/:id/payees item. */
export interface PayeeImpact {
  readonly participant: { readonly id: string; readonly external_ref: string; readonly display_name: string }
  readonly baseline_minor: string
  readonly simulated_minor: string
  readonly delta_minor: string
  readonly by_rule: readonly { readonly rule_key: string; readonly baseline_minor: string; readonly simulated_minor: string }[]
}

/** GET /v1/periods (COMP): the calendars in scope and their periods, newest first. */
export interface PeriodsView {
  readonly calendars: readonly {
    readonly id: string
    readonly name: string
    readonly cadence: string
    readonly cutoff_time_zone: string
    readonly market: { readonly id: string; readonly code: string }
    readonly plan: { readonly id: string; readonly name: string } | null
  }[]
  readonly periods: readonly PeriodItem[]
}

export interface PeriodItem {
  readonly id: string
  readonly calendar_id: string
  readonly starts_at: string
  readonly ends_at: string
  readonly cut_off_passed: boolean
  readonly state: string
}
