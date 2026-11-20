// FR-TEN-002/004 response shapes (apps/api/src/modules/ten: markets.ts, brands.ts, calendars.ts, checklist.ts,
// go-live.ts; pay/providers.ts; aud/documents.ts).
import type { MarketState } from '../../lib/markets'
import type { EligibleApprover, Person } from '../admin/settings/types'

export interface Brand {
  readonly id: string
  readonly name: string
}

export interface Calendar {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly name: string
  readonly cadence: 'weekly' | 'monthly'
  readonly cutoff_time_zone: string
  readonly first_period_start: string
  readonly periods: { readonly count: number; readonly first_starts_at: string | null; readonly last_ends_at: string | null; readonly open: number }
}

export interface Period {
  readonly id: string
  readonly starts_at: string
  readonly ends_at: string
  readonly state: string
}

export type ItemKind = 'evidence' | 'attestation' | 'provider' | 'automatic'
export type ItemCategory = 'regulatory' | 'payment' | 'tax' | 'plan' | 'data'
export type ItemStatus = 'complete' | 'missing' | 'needs_risk_acceptance'
export type BasisStatus = 'screening' | 'primary_read' | 'counsel_confirmed'

export interface DocumentSummary {
  readonly id: string
  readonly file_name: string | null
  readonly mime: string
  readonly size_bytes: number
  readonly sha256: string
}

export interface ChecklistEntry {
  readonly id: string
  readonly document: DocumentSummary | null
  readonly note: string | null
  readonly recorded_by: Person
  readonly recorded_at: string
}

export interface PackRule {
  readonly kind: string
  readonly id: string
  readonly title: string
  readonly mandatory: boolean
  readonly basis: string
  readonly basis_status: BasisStatus
  readonly source_ref: string
  readonly reviewed_by: string | null
  readonly reviewed_at: string | null
  readonly effective_from: string
  readonly effective_to: string | null
}

export interface AgreementVersionRef {
  readonly id: string
  readonly label: string
  readonly published_at: string
}

export interface PlanVariantRef {
  readonly plan_id: string
  readonly plan_name: string
  readonly version_id: string
  readonly version: number
  readonly state: 'scheduled' | 'active'
}

export interface ChecklistItem {
  readonly item: string
  readonly title: string
  readonly kind: ItemKind
  readonly category: ItemCategory
  readonly mandatory: boolean
  readonly status: ItemStatus
  readonly entry: ChecklistEntry | null
  /** providers / {region} / {contacts} / {rules} / {version} / {untranslated}; null for the other items. */
  readonly detail: {
    /**
     * agreement_versions (D-B2-15): the market's current published version; plan_variant: the plan version that runs
     * the market (ten/checklist.ts PlanVariantRef). null while none exists.
     */
    readonly version?: AgreementVersionRef | PlanVariantRef | null
    readonly providers?: readonly { readonly id: string; readonly provider: string }[]
    readonly region?: string
    readonly contacts?: number
    readonly rules?: readonly PackRule[]
    /** portal_languages (D-BM-11): market languages as stored that have no distributor catalogue. */
    readonly untranslated?: readonly string[]
  } | null
}

export interface GoLiveRequest {
  readonly id: string
  readonly market_id: string
  readonly state: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  readonly requested_by: Person
  readonly requested_at: string
  readonly decided_by: Person | null
  readonly decided_at: string | null
  readonly decision_reason: string | null
  readonly risk_acceptance: { readonly statement: string; readonly accepted_rules: readonly { readonly id: string; readonly title: string }[] } | null
}

/** GET /v1/markets/:id/checklist. */
export interface Checklist {
  readonly market: { readonly id: string; readonly code: string; readonly name: string; readonly state: MarketState; readonly market_pack: string }
  readonly items: readonly ChecklistItem[]
  readonly summary: Readonly<Record<ItemStatus, number>>
  readonly pending_request: GoLiveRequest | null
  readonly eligible_signers: readonly EligibleApprover[]
}

/** GET /v1/provider-configs item. */
export interface ProviderRecord {
  readonly id: string
  readonly market_id: string | null
  readonly kind: string
  readonly provider: string
  readonly approved_description: string | null
  readonly approval_document: { readonly id: string; readonly file_name: string | null } | null
  readonly approved_at: string | null
  readonly funds_holder: string | null
  readonly state: 'recorded' | 'withdrawn'
  /** B4 payout adapter (D-B4-14); null until configured in Integrations. */
  readonly adapter: 'sandbox' | 'bank_file_csv' | null
  readonly webhook_configured: boolean
  /** YYYY-MM-DD (D-B4-20) or null. */
  readonly review_due_on: string | null
  readonly created_by: Person
  readonly created_at: string
  readonly withdrawn_at: string | null
}

/** GET /v1/documents/limits. */
export interface DocumentLimits {
  readonly max_file_bytes: number
  readonly types: readonly string[]
}
