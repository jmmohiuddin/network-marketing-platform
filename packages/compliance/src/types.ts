// Input facts mirror cpl_fact_participant / cpl_fact_order / cpl_fact_payout_line.
// Dates are passed as 'YYYY-MM' months (plus an optional order day) so the package needs no date handling.

export type Purpose = 'customer' | 'personal' | 'resale' | 'enrolment' | 'unknown'

export type SourceKind =
  | 'retail_sale'
  | 'downline_volume'
  | 'enrolment_order'
  | 'pool'
  | 'match'
  | 'clawback'
  | 'other'
  | 'unknown'

export interface ParticipantFact {
  readonly participantRef: string
  readonly typeCode: string
  readonly countsAsEndCustomer: boolean
  readonly canEarn: boolean
  /** 'YYYY-MM' */
  readonly enrolledMonth: string
  /** Servicing distributor for customers, upline for distributors. */
  readonly servicingRef: string | null
}

export interface OrderFact {
  readonly orderRef: string
  /** 'YYYY-MM' */
  readonly orderMonth: string
  /** Day of month; null when the export carried no day. */
  readonly orderDay: number | null
  readonly buyerRef: string
  readonly amountMinor: bigint
  readonly volumeMinor: bigint
  readonly purpose: Purpose
  readonly isStarterKit: boolean
  readonly refundedMinor: bigint
  /** 'YYYY-MM' or null */
  readonly refundMonth: string | null
}

export interface PayoutLineFact {
  readonly lineRef: string
  /** 'YYYY-MM' */
  readonly payMonth: string
  readonly payeeRef: string
  readonly bonusType: string
  readonly sourceKind: SourceKind
  readonly sourceOrderRef: string | null
  readonly amountMinor: bigint
}

export interface ComplianceFacts {
  readonly participants: readonly ParticipantFact[]
  readonly orders: readonly OrderFact[]
  readonly payoutLines: readonly PayoutLineFact[]
}

/** Exact fraction, e.g. one third = { numerator: 1n, denominator: 3n }. */
export interface Ratio {
  readonly numerator: bigint
  readonly denominator: bigint
}

/** Every threshold is a tenant setting. None has a default (E-ADR-11): unset means the indicator is omitted. */
export interface ComplianceConfig {
  /** R4: personal volume at or above which a distributor is active in a month. */
  readonly activePvMinor?: bigint
  /** R4: named personal-volume thresholds whose crossing by a late order is counted. */
  readonly rankThresholdsPvMinor?: Readonly<Record<string, bigint>>
  /** R4: orders on or after this day of the month are late orders. */
  readonly lateOrderDay?: number
  /** R2: a payee is flagged when pay from personal-use orders exceeds this share of their multi-level pay. */
  readonly personalShareFlag?: Ratio
}

/** Settings as supplied by a caller: a null setting is unset, exactly like an absent one. */
export type ComplianceConfigInput = { readonly [K in keyof ComplianceConfig]?: ComplianceConfig[K] | null }

export interface ComputeOptions {
  /** Maximum ids kept per drill-down id list; counts always describe the full set. */
  readonly drillIdCap?: number
}

export type ReportCode = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
export type FigureUnit = 'percent' | 'minor' | 'count' | 'currency' | 'ratio'
export type DrillEntity = 'order' | 'payout_line' | 'participant'

export interface Drill {
  readonly entity: DrillEntity
  /** Sorted ascending, distinct, capped at the drill id cap. */
  readonly numeratorIds: readonly string[]
  readonly numeratorCount: number
  readonly denominatorIds: readonly string[]
  readonly denominatorCount: number
}

export interface Figure {
  readonly key: string
  readonly unit: FigureUnit
  /** Decimal string ('62.50', '16000'); null when the figure cannot be stated (see note). */
  readonly value: string | null
  readonly numerator: bigint | null
  readonly denominator: bigint | null
  readonly population: string
  readonly method: string
  readonly methodVersion: string
  readonly note: string | null
  readonly drill: Drill
}

export interface OmittedIndicator {
  readonly key: string
  readonly reason: string
}

export interface ReportPeriod {
  readonly report: ReportCode
  /** 'YYYY-MM' for a month, 'YYYY' for a year. */
  readonly period: string
  readonly periodKind: 'month' | 'year'
  /** Year periods only: fewer than 12 months of payout data, so not publishable. */
  readonly partial: boolean
  readonly figures: readonly Figure[]
  readonly omitted: readonly OmittedIndicator[]
  readonly notes: readonly string[]
}

export interface ComplianceReports {
  readonly methodVersion: string
  readonly months: readonly string[]
  readonly years: readonly string[]
  readonly reports: readonly ReportPeriod[]
}
