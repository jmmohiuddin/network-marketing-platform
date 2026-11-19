// Response shapes of the participant, position and servicing routes (PLAN B2 2.2, 2.3, 2.5; modules/par, crm, gen).

export const PARTICIPANTS_PATH = '/v1/participants'

export type PositionStatus = 'pending' | 'active' | 'suspended' | 'terminated'
export type ContactField = 'email' | 'phone' | 'address'
export type Contact = Partial<Record<ContactField, string | null>>

/** GET /v1/participants item. */
export interface ParticipantRow {
  readonly id: string
  readonly external_ref: string
  readonly display_name: string | null
  readonly market: { readonly id: string; readonly code: string }
  readonly current_type: { readonly code: string; readonly name: string } | null
  readonly status: 'active' | 'merged'
  readonly enrolled_at: string
  readonly positions: { readonly count: number; readonly active: number }
}

export interface OwnedPosition {
  readonly id: string
  readonly position_ref: string
  readonly status: PositionStatus
  readonly status_from: string
  readonly market: { readonly id: string; readonly code: string }
  readonly owned_from: string
  readonly owned_to: string | null
}

/** GET /v1/participants/:id (contact masked; AC-PAR1-3). */
export interface ParticipantDetail {
  readonly id: string
  readonly external_ref: string
  readonly account_type: 'individual' | 'joint' | 'entity'
  readonly market: { readonly id: string; readonly code: string }
  /** "Erased participant <external_ref>" once pseudonymised (D-B5-18). */
  readonly display_name: string | null
  readonly contact_masked: Contact | null
  /** Set when the participant's personal data was erased (D-B5-18); absent from records read before B5. */
  readonly pseudonymised_at?: string | null
  readonly status: 'active' | 'merged'
  readonly merged_into: { readonly id: string; readonly external_ref: string } | null
  readonly enrolled_at: string
  readonly types: readonly { readonly type: { readonly id: string; readonly code: string; readonly name: string }; readonly valid_from: string; readonly valid_to: string | null }[]
  readonly agreements: readonly { readonly version: { readonly id: string; readonly label: string }; readonly accepted_at: string; readonly evidence: { readonly channel: string; readonly reference: string } | null }[]
  readonly positions: readonly OwnedPosition[]
  readonly duplicate_hold: boolean
}

/** GET /v1/participants/:id/servicing item, newest first; position null = the company. */
export interface ServicingEntry {
  readonly position: { readonly id: string; readonly position_ref: string; readonly owner_name: string | null } | null
  readonly source: string
  readonly valid_from: string
  readonly valid_to: string | null
  readonly case_id: string | null
}

/** GET /v1/positions/:id/customers item: the customers the position services now. */
export interface ServicedCustomer {
  readonly participant: { readonly id: string; readonly external_ref: string; readonly display_name: string | null }
  readonly source: string
  readonly valid_from: string
}

/** POST /v1/participants 201. */
export interface Enrolment {
  readonly participant: { readonly id: string; readonly external_ref: string; readonly status: string }
  readonly position: { readonly id: string; readonly position_ref: string; readonly status: PositionStatus } | null
  readonly duplicate_case_id: string | null
}
