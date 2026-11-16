// API-39 response shapes used by SC-29 (apps/api/src/modules/ten: routes.ts, change-requests.ts, version-history.ts).

export interface ValueSince {
  readonly version: number
  readonly effective_from: string
}

export interface SettingEntry {
  readonly value: unknown
  /** BUG-025: start of the uninterrupted run of the current value; null while unset. */
  readonly value_since: ValueSince | null
}

/** GET /v1/settings: the version in force now and the values the caller may read (unreadable keys are absent). */
export interface SettingsView {
  readonly version: number | null
  readonly effective_from: string | null
  readonly values: Readonly<Record<string, SettingEntry | undefined>>
}

export interface Person {
  readonly id: string
  readonly display_name: string | null
}

export interface EligibleApprover {
  readonly user_id: string
  readonly display_name: string | null
  readonly email: string
}

/** GET /v1/setting-change-requests item (FR-TEN-003 money-affecting change). */
export interface ChangeRequest {
  readonly id: string
  readonly key: string
  readonly value: unknown
  readonly effective_from: string
  readonly reason: string
  readonly base_version: number
  readonly state: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  readonly requested_by: Person
  readonly requested_at: string
  readonly decided_by: Person | null
  readonly decided_at: string | null
  readonly decision_reason: string | null
  readonly version: number | null
  readonly eligible_approvers: readonly EligibleApprover[]
  readonly no_eligible_approver: boolean
}

/** GET /v1/settings/versions item, newest first. */
export interface VersionSummary {
  readonly id: string
  readonly version: number
  readonly effective_from: string
  readonly reason: string
  readonly created_at: string
  readonly created_by: Person
  readonly approval: { readonly approver: Person; readonly decided_at: string } | null
  readonly superseded_by_version: number | null
  readonly changed: readonly { readonly key: string }[]
}

export interface StructureEntry {
  readonly id: string
  readonly [field: string]: unknown
}

export interface StructurePart {
  readonly added: readonly StructureEntry[]
  readonly removed: readonly StructureEntry[]
  readonly changed: readonly { readonly id: string; readonly before: StructureEntry; readonly after: StructureEntry }[]
}

export type VersionChange =
  | { readonly key: 'structure'; readonly markets: StructurePart; readonly brands: StructurePart; readonly calendars: StructurePart }
  | { readonly key: string; readonly redacted: true }
  | { readonly key: string; readonly before: unknown; readonly after: unknown }

/** GET /v1/settings/versions/:version. */
export interface VersionDetail extends VersionSummary {
  readonly changes: readonly VersionChange[]
}
