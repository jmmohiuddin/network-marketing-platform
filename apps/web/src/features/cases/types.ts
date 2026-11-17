// API shapes of the case screens (PLAN B1 2.9, B2 2.2, 2.4, 2.5). Timestamps are ISO strings.
import type { EligibleApprover } from '../admin/settings/types'

export type CaseState = 'open' | 'submitted' | 'approved' | 'rejected' | 'withdrawn'
export type TreeKind = 'sponsor' | 'placement'

/** GET /v1/cases rows and every case write's answer. */
export interface CaseRecord {
  readonly id: string
  readonly type: string
  readonly subject_type: string
  readonly subject_id: string
  readonly reason_code: string
  readonly state: CaseState
  readonly payload: unknown
  readonly effect_preview: unknown
  readonly due_at: string | null
  readonly market_id: string | null
  /** null for a case the system opened (duplicate reviews, D-B2-04). */
  readonly opened_by: string | null
  readonly opened_by_kind: 'user' | 'system'
  readonly assigned_to: string | null
  readonly submitted_by: string | null
  readonly submitted_at: string | null
  readonly decided_at: string | null
  readonly approval_id: string | null
  readonly created_at: string
}

export interface CaseEvidence {
  readonly id: string
  readonly document_id: string
  readonly file_name: string | null
  readonly mime: string
  readonly size_bytes: number
  readonly note: string | null
  readonly added_by: string
  readonly added_at: string
}

export type CaseEventKind = 'opened' | 'evidence_added' | 'assigned' | 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'updated'

export interface CaseEvent {
  readonly id: string
  readonly occurred_at: string
  /** null: the system, or an actor that is not a user (a service account). */
  readonly actor_id: string | null
  readonly kind: CaseEventKind
  readonly data: Readonly<Record<string, unknown>> | null
}

/** GET /v1/cases/:id. */
export interface CaseDetail extends CaseRecord {
  readonly evidence: readonly CaseEvidence[]
  readonly events: readonly CaseEvent[]
  /** Who may decide it now (submitted cases only). */
  readonly eligible_approvers: readonly EligibleApprover[] | null
}

/** GET /v1/cases/counts: one row per readable type. */
export interface CaseCounts {
  readonly type: string
  readonly open: number
  readonly submitted: number
  readonly overdue: number
  readonly decided_30d: number
}

export interface RelationshipPayload {
  readonly kind: TreeKind
  readonly proposed_parent_position_id: string
  readonly leg?: string
  /** genealogy_change: a date (UTC) or an instant, not before today. */
  readonly effective_from?: string
  /** genealogy_correction: an instant, now or earlier. */
  readonly valid_from?: string
}

export interface TransferPayload {
  readonly to_participant_id: string
  readonly effective_from: string
}

export type DuplicateOutcome = 'merge' | 'allow' | 'terminate'

export interface DuplicatePayload {
  readonly matched_participant_id: string
  readonly matched_kinds: readonly string[]
  readonly proposed_outcome?: DuplicateOutcome
}

export interface CommittedPeriod {
  readonly period_id: string
  readonly starts_at: string
  readonly ends_at: string
  readonly state: string
}

/** effect_preview of genealogy_change / genealogy_correction (stored at submit). */
export interface RelationshipPreview {
  readonly current_parent: { readonly position_id: string; readonly position_ref: string; readonly leg: string | null } | null
  readonly proposed_parent: { readonly position_id: string; readonly position_ref: string } | null
  readonly structural_check: { readonly ok: boolean; readonly code?: string }
  readonly affected_committed_periods: readonly CommittedPeriod[]
  readonly affects_committed_periods?: boolean
  readonly impact_note?: string
}

export interface ParticipantRef {
  readonly participant_id: string
  readonly external_ref: string
}

export interface TransferPreview {
  readonly from_owner: ParticipantRef | null
  readonly to_owner: ParticipantRef | null
  readonly to_type_can_hold_positions: boolean
}

export interface DuplicatePreview {
  readonly outcome: DuplicateOutcome
  readonly positions: readonly { readonly id: string; readonly position_ref: string; readonly status: string }[]
  readonly hold_active: boolean
}

export interface Owner {
  readonly participant_id: string
  readonly external_ref: string
  readonly display_name: string | null
}

/** GET /v1/positions/:id (the parts these screens show). */
export interface PositionDetail {
  readonly id: string
  readonly position_ref: string
  readonly market: { readonly id: string; readonly code: string }
  readonly status: string
  readonly owner: Owner | null
  readonly parents: {
    readonly sponsor: { readonly position_id: string; readonly position_ref: string; readonly valid_from: string } | null
    readonly placement: { readonly position_id: string; readonly position_ref: string; readonly valid_from: string; readonly leg: string | null } | null
  }
}

/** GET /v1/participants/:id (the parts these screens show). */
export interface ParticipantDetail {
  readonly id: string
  readonly external_ref: string
  readonly account_type: string
  readonly market: { readonly id: string; readonly code: string }
  readonly display_name: string | null
  readonly contact_masked: { readonly email?: string; readonly phone?: string; readonly address?: string } | null
  readonly status: string
  readonly merged_into: { readonly id: string; readonly external_ref: string } | null
  readonly enrolled_at: string
  readonly types: readonly { readonly type: { readonly code: string; readonly name: string }; readonly valid_from: string; readonly valid_to: string | null }[]
  readonly positions: readonly { readonly id: string; readonly position_ref: string; readonly status: string; readonly owned_to: string | null }[]
  readonly duplicate_hold: boolean
}

/** GET /v1/genealogy/search rows (API-14 node). */
export interface TreeNode {
  readonly position_id: string
  readonly position_ref: string
  readonly owner: Owner | null
  readonly status: string | null
  readonly market_code: string
  readonly leg: string | null
}

/** GET /v1/participants rows. */
export interface ParticipantRow {
  readonly id: string
  readonly external_ref: string
  readonly display_name: string | null
  readonly market: { readonly id: string; readonly code: string }
  readonly current_type: { readonly code: string; readonly name: string } | null
  readonly status: string
}
