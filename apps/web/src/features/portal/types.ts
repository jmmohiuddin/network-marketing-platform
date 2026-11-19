// API shapes of the distributor portal (PLAN B5 §2.1–§2.6). Money is minor units as decimal strings, instants ISO-8601.
import type { Me } from '../../lib/me'

export interface PortalMarket {
  readonly id: string
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
  readonly time_zone: string
}

export interface OwnPosition {
  readonly id: string
  readonly position_ref: string
  readonly status: string
  readonly market_code: string
}

/** SQL portal_profile(participant): the identity strip and navigation facts. */
export interface PortalProfile {
  readonly participant_id: string
  readonly display_name: string | null
  readonly external_ref: string | null
  readonly pseudonymised: boolean
  readonly market: PortalMarket
  readonly positions: readonly OwnPosition[]
  readonly can_sponsor: boolean
  readonly has_downline: boolean
  readonly terminated: boolean
}

/**
 * GET /v1/me as a portal session answers it (realm 'portal'; roles and permissions always empty, so not read); a staff
 * session answers the staff shape, of which only realm and navigation are read here. `participant` is null while a
 * second factor is pending.
 */
export interface PortalMe extends Omit<Me, 'tenant' | 'roles' | 'permissions' | 'support_session'> {
  readonly tenant: { readonly slug: string; readonly legal_name: string } | null
  readonly participant: PortalProfile | null
}

export interface PeriodRef {
  readonly id: string
  readonly starts_at: string
  readonly ends_at: string
}

export interface MarketMoney {
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
}

export type PayoutState = 'none' | 'in_transit' | 'settled' | 'returned' | 'failed' | 'mixed'

export interface StatementSummary {
  readonly run_id: string
  readonly period: PeriodRef & { readonly state: string }
  readonly market: MarketMoney
  readonly committed_at: string
  readonly net_minor: string | null
  readonly payout_state: PayoutState
}

export interface LadderRank {
  readonly ladder: string
  readonly rank: string | null
}

export type OriginKind = 'none' | 'late_order' | 'refund' | 'manual' | 'restatement'

export interface StatementLine {
  readonly id: string
  readonly amount_minor: string
  readonly origin_kind: OriginKind
  readonly original_period_id: string | null
}

export interface Blocker {
  readonly reason: string
  readonly until?: string
  readonly case_id?: string
}

export interface Statement extends Omit<StatementSummary, 'net_minor' | 'payout_state'> {
  readonly positions: readonly {
    readonly position_id: string
    readonly position_ref: string
    readonly paid_as: readonly LadderRank[]
    readonly bonuses: readonly { readonly rule_key: string; readonly rule_name: string | null; readonly total_minor: string; readonly lines: readonly StatementLine[] }[]
    readonly total_minor: string
  }[]
  readonly person_total_minor: string
  readonly summary: {
    readonly gross_minor: string
    readonly adjustment_minor: string
    readonly clawback_minor: string
    readonly withheld_minor: string
    readonly net_minor: string
  }
  readonly payout: {
    readonly instructions: readonly { readonly amount_minor: string; readonly state: string; readonly terminal_at: string | null; readonly masked: string }[]
    readonly blockers: readonly Blocker[]
  }
}

export interface ExplanationPart {
  readonly level: number | null
  readonly label: string
  readonly count: number
  readonly base: string | null
  readonly base_unit: 'money' | 'volume' | null
  readonly rate: string | null
  readonly contribution: string
}

export interface Explanation {
  readonly line_id: string
  readonly run_id: string
  readonly template: string
  readonly rule: { readonly key: string; readonly name: string | null; readonly kind: string }
  readonly period: Omit<PeriodRef, 'id'>
  readonly amount_minor: string
  readonly currency: string
  readonly rank_used: readonly LadderRank[]
  readonly parts: readonly ExplanationPart[]
  readonly steps: readonly { readonly kind: string; readonly text: string }[]
  readonly rounding: { readonly mode: string; readonly before: string; readonly after: string } | null
  readonly origin: { readonly kind: OriginKind; readonly original_period: PeriodRef | null } | null
  readonly text: readonly string[]
}

export type DisputeState = 'opened' | 'under_review' | 'upheld' | 'not_upheld'

export interface Dispute {
  readonly case_id: string
  readonly line_id: string
  readonly run_id: string
  readonly period: PeriodRef
  readonly amount_minor: string
  readonly state: DisputeState
  readonly opened_at: string
  readonly due_at: string | null
  readonly overdue: boolean
  readonly explanation: string | null
}

export interface RankRequirement {
  readonly ladder: string
  readonly rank: string
  readonly status: 'held' | 'held_by_grace'
  readonly grace?: { readonly used: number; readonly of: number }
  readonly items: readonly { readonly kind: string; readonly text: string; readonly measure?: string; readonly required?: string; readonly measured?: string | null; readonly met: boolean | null }[]
}

export interface RankPeriod {
  readonly period: PeriodRef
  readonly run_id: string | null
  readonly final: boolean
  readonly paid_as: readonly LadderRank[]
  readonly titles: readonly LadderRank[]
  readonly grace_used: readonly { readonly ladder: string; readonly periods: number }[] | null
  readonly measures: readonly { readonly measure: string; readonly value: string }[]
}

export interface RankStatus {
  readonly position: { readonly id: string; readonly position_ref: string }
  readonly periods: readonly RankPeriod[]
  readonly requirements: readonly RankRequirement[]
  readonly transition_notice: { readonly effective_from: string } | null
}

export interface TeamNode {
  readonly position_id: string
  readonly depth: number
  readonly display_name: string | null
  readonly position_ref: string
  readonly status: string
  readonly enrolled_on?: string | null
  readonly contact_masked?: Readonly<Record<string, string>> | null
}

export interface TeamPolicy {
  readonly named_depth: number
  readonly contact_for_personally_sponsored: boolean
  readonly default: boolean
}

export interface TeamView {
  readonly viewer: { readonly position_id: string; readonly position_ref: string }
  readonly node: TeamNode | null
  readonly children: readonly TeamNode[]
  readonly hidden_levels: readonly { readonly depth: number; readonly count: number }[]
  readonly policy: TeamPolicy
}

export interface TeamSearch {
  readonly viewer: { readonly position_id: string; readonly position_ref: string }
  readonly matches: readonly TeamNode[]
  readonly policy: TeamPolicy
}

export interface Customer {
  readonly customer_id: string
  readonly display_name: string | null
  readonly serviced_by_position_ref: string
  readonly since: string
  readonly until: string | null
  readonly last_order_at: string | null
  readonly order_count: number
  readonly repeat: boolean
  readonly contact_masked?: Readonly<Record<string, string>> | null
}

export interface CustomerDetail {
  readonly customer_id: string
  readonly display_name: string | null
  readonly contact_masked?: Readonly<Record<string, string>> | null
  readonly servicing: readonly { readonly position_ref: string; readonly since: string; readonly until: string | null; readonly order_count: number }[]
  readonly last_orders: readonly { readonly ordered_at: string; readonly source_order_id: string }[]
}

export interface BankDetails {
  readonly current: { readonly masked: string; readonly scheme: string; readonly created_via: string; readonly created_at: string; readonly cooling_off_until: string } | null
  readonly pending_review: { readonly case_id: string; readonly created_at: string } | null
  readonly history: readonly { readonly masked: string; readonly created_via: string; readonly created_at: string; readonly superseded_at: string }[]
  readonly owed: readonly { readonly market_code: string; readonly currency: string; readonly minor_unit: number; readonly payable_minor: string }[]
}

export interface TaxVersion {
  readonly id: string
  readonly residency: string | null
  readonly entity_type: string | null
  readonly tax_id_masked: string | null
  readonly valid_from: string
  readonly valid_to: string | null
}

export interface TaxProfile {
  readonly current: TaxVersion | null
  readonly history: readonly TaxVersion[]
}

export interface Notice {
  readonly id: string
  readonly template: string
  readonly topic: string
  readonly mandatory: boolean
  readonly params: Readonly<Record<string, unknown>>
  readonly created_at: string
  readonly read_at: string | null
}

export interface Preference {
  readonly topic: string
  readonly email?: boolean
  readonly mandatory: boolean
}

export type PrivacyType = 'access' | 'portability' | 'correction' | 'erasure'

export interface PrivacyRequest {
  readonly id: string
  readonly type: PrivacyType
  readonly state: 'received' | 'in_progress' | 'fulfilled' | 'refused'
  readonly due_at: string | null
  readonly retention_basis: string | null
  readonly closed_at: string | null
  readonly deferred_reasons?: readonly { readonly reason: string }[]
}
