// Response shapes of the admin and vendor routes (apps/api/src/modules/{iam,ten,aud,support,ops,prv}). Dates are ISO strings.
import type { OffboardingBlocker, OffboardingState } from './offboarding'

/** GET /v1/users (iam/users.ts UserView). */
export interface UserRole {
  readonly assignment_id: string
  readonly role_id: string
  readonly name: string
  readonly market_ids: readonly string[] | null
  readonly valid_to: string | null
}

export interface UserView {
  readonly id: string
  readonly email: string
  readonly display_name: string | null
  readonly state: string
  readonly mfa_enrolled: boolean
  readonly last_sign_in_at: string | null
  readonly created_at: string
  readonly roles: readonly UserRole[]
}

/** GET /v1/roles (iam/roles.ts RoleView); meta.permissions is the catalogue. */
export interface RoleView {
  readonly id: string
  readonly name: string
  readonly permissions: readonly string[]
  readonly is_base: boolean
  readonly mfa_required: boolean
  /** Granting it needs a second admin (SEC-27). */
  readonly privileged: boolean
}

/** GET /v1/role-grant-requests (iam/grants.ts GrantRequestView). */
export interface GrantRequest {
  readonly id: string
  readonly user_id: string
  readonly role_id: string
  readonly market_ids: readonly string[] | null
  readonly valid_to: string | null
  readonly requested_by: string
  readonly state: 'pending' | 'approved' | 'rejected'
  readonly created_at: string
}

/** GET /v1/support-sessions (support/sessions.ts SupportSessionView). */
export interface SupportSession {
  readonly id: string
  readonly tenant_id: string
  readonly tenant_slug: string
  readonly requester_id: string
  readonly reason: string
  readonly scope: { readonly permissions: readonly string[]; readonly requester_region: string | null }
  readonly requested_minutes: number
  readonly state: string
  readonly decided_by: string | null
  readonly starts_at: string | null
  readonly ends_at: string | null
  readonly created_at: string
}

/** BUG-023: tenant-realm session views name the vendor requester; null when the API could not resolve them. */
export interface TenantSupportSession extends SupportSession {
  readonly requester: { readonly id: string; readonly display_name: string | null; readonly email: string } | null
}

/** GET /v1/vendor-users (iam/vendor-users.ts VendorUserView). */
export interface VendorUser {
  readonly id: string
  readonly email: string
  readonly display_name: string | null
  readonly state: string
  readonly mfa_enrolled: boolean
  readonly last_sign_in_at: string | null
  readonly created_at: string
  readonly created_by: string | null
  /** BUG-031: a new vendor user's invitation waits for a second vendor user (not the inviter) before it is mailed. */
  readonly invitation_status: 'pending_approval' | 'approved' | 'rejected' | null
  readonly invitation_decided_by: string | null
  readonly invitation_decided_at: string | null
}

/** GET /v1/audit-events (aud/events.ts) and GET /v1/support-sessions/:id/log (without id, hash, session id). */
export interface AuditEvent {
  readonly id?: string
  readonly seq: string
  readonly occurred_at: string
  readonly actor_type: string
  readonly actor_id: string | null
  readonly support_session_id?: string | null
  readonly action: string
  readonly object_type: string | null
  readonly object_id: string | null
  readonly before: unknown
  readonly after: unknown
  readonly reason: string | null
  readonly request_id: string | null
  readonly hash?: string
}

/** GET /v1/audit-chain/verification (aud/verify.ts). */
export interface ChainVerification {
  readonly intact: boolean
  readonly first_broken_seq: string | null
  readonly events: string
  readonly verified_at: string
}

/** POST /v1/audit-exports 201. */
export interface AuditExport {
  readonly id: string
  readonly row_count: string
  readonly download: string
}

/** GET /v1/settings/:key (ten/routes.ts); meta.latest_version is the If-Match base. */
export interface SettingRead<T> {
  readonly key: string
  readonly value: T | null
  readonly version: number | null
  readonly effective_from: string | null
}

export interface BreachContact {
  readonly name: string
  readonly role: string
  readonly email: string
  readonly phone: string
}

/** GET /v1/tenants (ops/tenants.ts TenantView): operational metadata only (AC-57.1). */
export interface TenantView {
  readonly id: string
  readonly slug: string
  readonly legal_name: string
  readonly region: string
  readonly isolation_tier: string
  readonly state: string
  readonly dpa_document_id: string | null
  readonly created_at: string
  readonly job_health: { readonly queued: number; readonly running: number; readonly failed: number }
}

export interface MarketView {
  readonly id: string
  readonly code: string
  readonly currency: string
  readonly minor_unit: number
  readonly time_zone: string
  readonly languages: readonly string[]
  readonly market_pack: string
  readonly state: string
}

/** GET /v1/tenants/:id offboarding (D-V1A-07, SC-39): the latest record with blocker counts, never ids of tenant data. */
export interface VendorOffboarding {
  readonly id: string
  readonly state: OffboardingState
  readonly requested_at: string
  readonly confirmed_at: string | null
  readonly archived_at: string | null
  readonly retain_until: string | null
  readonly purge_requested_by: string | null
  readonly blockers: readonly OffboardingBlocker[]
}

export interface TenantDetail extends TenantView {
  readonly markets: readonly MarketView[]
  readonly offboarding: VendorOffboarding | null
}
