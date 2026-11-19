// API-31 shapes (PLAN B5 §2.6; apps/api modules/prv staff-routes.ts, privacy-case.ts). Timestamps are ISO strings.
import type { CaseState } from '../cases/types'

export const PRIVACY_REQUESTS_PATH = '/v1/privacy-requests'

export type RequestType = 'access' | 'correction' | 'erasure' | 'portability'
export type RequestState = 'received' | 'in_progress' | 'fulfilled' | 'refused'
export type Channel = 'portal' | 'public_form' | 'staff'
export type VerificationMethod = 'contact_match' | 'document' | 'other'

export interface SubjectRef {
  readonly id: string
  readonly external_ref: string
}

/** GET /v1/privacy-requests item. */
export interface PrivacyRequestRow {
  readonly id: string
  readonly case_id: string
  readonly type: RequestType
  readonly channel: Channel
  readonly state: RequestState
  readonly subject: SubjectRef | null
  readonly verified: boolean
  readonly received_at: string
  readonly due_at: string | null
  readonly escalated_at: string | null
  readonly deadline_configured: boolean
}

/** prv_erasure_blockers (0506): what defers an erasure (D-B5-18). */
export type ErasureBlocker =
  | { readonly reason: 'open_payable'; readonly market_id: string; readonly amount_minor: string }
  | { readonly reason: 'payout_in_flight'; readonly count: number }
  | { readonly reason: 'payout_hold'; readonly hold_id: string }
  | { readonly reason: 'open_case'; readonly case_id: string; readonly type: string }
  | { readonly reason: 'open_run'; readonly run_id: string }

/** The sealed requester, unsealed for the DPO (each read audited). */
export interface Requester {
  readonly full_name?: string
  readonly email?: string
  readonly participant_ref?: string
  readonly details?: string
  readonly received_via?: string
}

/** D-B5-19 corrected values (sealed until the decision). */
export interface Corrections {
  readonly display_name?: string
  readonly contact?: { readonly email?: string; readonly phone?: string }
}

/** GET /v1/privacy-requests/:id. */
export interface PrivacyRequestDetail extends PrivacyRequestRow {
  readonly verification_method: VerificationMethod | 'portal_session' | null
  readonly verification_note: string | null
  readonly verified_at: string | null
  readonly retention_basis: string | null
  readonly outcome: 'fulfilled' | 'refused' | null
  readonly closed_at: string | null
  readonly case_state: CaseState
  readonly market_id: string | null
  readonly export: { readonly id: string; readonly created_at: string; readonly sha256: string; readonly bytes: number } | null
  readonly requester: Requester | null
  readonly corrections: Corrections | null
  /** Erasure requests not decided yet, with a subject: what defers the erasure now. */
  readonly blockers: readonly ErasureBlocker[] | null
}

/** effect_preview of a privacy case (privacy-case.ts effectPreview), stored at submit. */
export interface PrivacyPreview {
  readonly request_id: string
  readonly type: RequestType
  readonly subject: SubjectRef
  /** correction: current and corrected values, masked. */
  readonly corrections?: readonly { readonly field: string; readonly current: string | null; readonly corrected: string | null }[]
  /** erasure: what the approval clears and keeps, and what defers it. */
  readonly cleared?: readonly string[]
  readonly retained?: readonly string[]
  readonly blockers?: readonly ErasureBlocker[]
  /** access / portability: the sections of the export. */
  readonly sections?: readonly string[]
}

/** The privacy case payload (privacy-case.ts payloadSchema). */
export interface PrivacyPayload {
  readonly request_id: string
  readonly participant_id?: string
  readonly retention_basis?: string
  readonly corrections?: readonly string[]
}
