// Response shapes of the IMP and CPL routes (apps/api/src/modules/imp, modules/cpl), as the screens read them.

export const BATCH_STATES = ['uploaded', 'rejected', 'validated', 'mapped', 'loaded', 'superseded'] as const
export type BatchState = (typeof BATCH_STATES)[number]

export const IMPORT_FILES = ['participants', 'orders', 'payout_lines'] as const
export type ImportFile = (typeof IMPORT_FILES)[number]

export interface RowCounts {
  readonly participants: number
  readonly orders: number
  readonly payout_lines: number
}

/** Sums in minor units as decimal strings. */
export interface ControlTotals {
  readonly order_amount_minor: string
  readonly order_volume_minor: string
  readonly order_refunded_minor: string
  readonly payout_amount_minor: string
}

export interface ImportWarning {
  readonly code: string
  readonly file: string
  readonly count: number
  readonly detail: string
}

export interface DataQuality {
  readonly orders: number
  readonly orders_unknown_purpose: number
  readonly refunded_orders: number
  readonly refunds_without_month: number
  readonly payout_lines: number
  readonly payout_lines_without_source_order: number
  readonly payout_lines_unknown_source_kind: number
  readonly unmapped: { readonly purposes: readonly string[]; readonly source_kinds: readonly string[] }
}

/** GET /v1/imports/:id */
export interface Batch {
  readonly id: string
  readonly market: string
  /** YYYY-MM */
  readonly period_from: string
  readonly period_to: string
  readonly state: BatchState
  readonly mapping_id: string | null
  readonly mapping_version: number | null
  readonly superseded_by: string | null
  readonly created_at: string
  readonly row_counts: RowCounts | null
  readonly control_totals: ControlTotals | null
  readonly report: { readonly error_count: number; readonly errors_stored: number; readonly warnings: readonly ImportWarning[] } | null
  readonly data_quality: DataQuality | null
}

/** GET /v1/imports/:id/errors */
export interface Finding {
  readonly seq: string
  readonly file: string
  readonly row_no: number | null
  readonly column_name: string | null
  readonly code: string
  readonly detail: string | null
}

export const PURPOSES = ['customer', 'personal', 'resale', 'enrolment', 'unknown'] as const
export type Purpose = (typeof PURPOSES)[number]

export const SOURCE_KINDS = ['retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other', 'unknown'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export interface ParticipantFlags {
  readonly counts_as_end_customer: boolean
  readonly can_earn: boolean
}

/** import_mapping.mappings: partner code -> platform vocabulary. */
export interface Mappings {
  readonly participant_types: Readonly<Record<string, ParticipantFlags>>
  readonly purposes: Readonly<Record<string, Purpose>>
  readonly source_kinds: Readonly<Record<string, SourceKind>>
  readonly starter_kits: Readonly<Record<string, boolean>>
}

/** Distinct partner codes of a batch with their row counts. */
export type SourceValues = { readonly [V in keyof Mappings]: Readonly<Record<string, number>> }

/** GET /v1/import-mappings (list rows) and /:id (with mappings). */
export interface MappingVersion {
  readonly id: string
  readonly version: number
  readonly state: 'draft' | 'approved'
  readonly notes: string | null
  readonly created_by: string | null
  readonly created_at: string
  readonly approved_by: string | null
  readonly mappings?: Mappings
}

export const REPORT_CODES = ['R1', 'R2', 'R3', 'R4', 'R5'] as const
export type ReportCode = (typeof REPORT_CODES)[number]

export type SnapshotState = 'computing' | 'ready' | 'outdated' | 'failed'

/** GET /v1/compliance/snapshots (list rows). */
export interface Snapshot {
  readonly id: string
  readonly state: SnapshotState
  readonly market_id: string
  readonly period_from: string
  readonly period_to: string
  readonly method_version: string
  readonly failure_reason: string | null
  readonly created_at: string
  readonly reports: readonly ReportCode[]
  readonly input_batch_ids: readonly string[]
  readonly input_mapping_versions: readonly number[]
}

export type FigureUnit = 'percent' | 'minor' | 'count' | 'currency' | 'ratio'

export interface Figure {
  /** `{report}.{period}.{key}` */
  readonly id: string
  readonly key: string
  readonly unit: FigureUnit
  /** Decimal string; null = not stated (note says why). */
  readonly value: string | null
  readonly numerator: string | null
  readonly denominator: string | null
  readonly population: string | null
  readonly population_count: number | null
  readonly method: string | null
  readonly method_version: string | null
  readonly note: string | null
}

export interface PeriodResult {
  readonly report: ReportCode
  readonly period: string
  readonly period_kind: 'month' | 'year'
  /** Year with fewer than 12 months of payout data: not publishable. */
  readonly partial: boolean
  readonly notes: readonly string[]
  readonly figures: readonly Figure[]
  readonly omitted: readonly { readonly key: string; readonly reason: string | null }[]
}

/** GET /v1/compliance/snapshots/:id */
export interface SnapshotDetail extends Snapshot {
  readonly input_data_quality: readonly { readonly batch_id: string; readonly data_quality: DataQuality | null }[]
  readonly results: readonly PeriodResult[]
}

/** meta.figure of GET .../figures/:figure/rows */
export type FigureSummary = Omit<Figure, 'key' | 'population_count'>

/** meta of a cursor page. */
export interface PageMeta {
  readonly next_cursor?: string | null
}
