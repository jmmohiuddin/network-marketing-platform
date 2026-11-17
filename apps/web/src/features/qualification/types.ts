// GET /v1/positions/:id/qualification rows (PLAN B3 §2.3, AC-46.1): engine state fields as stored, newest period first.

export interface LadderRank {
  readonly ladder: string
  readonly rank: string | null
}

export interface QualificationRow {
  readonly period: { readonly id: string; readonly starts_at: string; readonly ends_at: string; readonly calendar_id: string }
  readonly run_id: string
  readonly plan_version: { readonly id: string; readonly version: number }
  readonly paid_as: readonly LadderRank[]
  readonly titles: readonly LadderRank[]
  readonly grace_used: readonly { readonly ladder: string; readonly periods: number }[]
  readonly counters: readonly { readonly key: string; readonly value: number }[]
  readonly carry: readonly { readonly key: string; readonly amountMinor: string; readonly periodsHeld: number }[]
  readonly one_time_flags: readonly string[]
  readonly banked: readonly { readonly key: string; readonly amountMinor: string }[]
  readonly measures: readonly { readonly measure: string; readonly valueMinor: string }[]
}
