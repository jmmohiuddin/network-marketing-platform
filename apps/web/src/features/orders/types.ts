// API shapes of SC-31 and SC-32 (PLAN B2 2.6). Money and volumes are decimal strings of minor units; timestamps ISO.

/** {measure: "minor units"}. */
export type Volumes = Readonly<Record<string, string>>

export type Purpose = 'resale' | 'personal' | 'unspecified' | 'customer'
export type AttributionSource = 'link' | 'code' | 'servicing' | 'buyer'

/** The order as fixed at ingestion (list and detail). */
export interface OrderRow {
  readonly id: string
  readonly source_system: string
  readonly source_order_id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly buyer: { readonly id: string; readonly external_ref: string; readonly display_name: string | null }
  /** The buyer's type when the order was credited. */
  readonly buyer_type: { readonly code: string }
  readonly purpose: Purpose
  readonly purpose_missing: boolean
  readonly attributed_position: { readonly id: string; readonly position_ref: string } | null
  readonly attribution_source: AttributionSource | null
  readonly attribution_conflict: boolean
  readonly credited_at: string
  readonly period_id: string | null
  readonly amount_minor: string
  readonly tax_minor: string
  readonly currency: string
  readonly volumes: Volumes
  /** D-V1A-05: the subscription a renewal order belongs to. */
  readonly subscription_ref: string | null
  /** D-V1A-04: what the source sent when its currency was not the market's; amounts above are converted. */
  readonly original: OriginalAmounts | null
}

export interface OriginalAmounts {
  readonly currency: string
  readonly amount_minor: string
  readonly tax_minor: string
  /** 10-dp decimal string. */
  readonly rate: string
  readonly rate_valid_from: string
  readonly rate_id: string
}

/** GET /v1/orders rows: the order plus its order time, event count and late flag. */
export interface OrderListRow extends OrderRow {
  readonly ordered_at: string
  readonly events: number
  readonly late: boolean
}

export interface OrderLine {
  readonly line_no: number
  readonly sku: string
  readonly item_class: string
  readonly quantity: number
  readonly amount_minor: string
  readonly volumes: Volumes
}

export interface OrderEvent {
  readonly id: string
  readonly type: string
  readonly occurred_at: string
  readonly lines: readonly { readonly line_no: number; readonly quantity: number }[] | null
  readonly refund_minor: string
  readonly fee_minor: string
  readonly equal_value: boolean
  readonly volume_effect: { readonly lines?: readonly { readonly line_no: number; readonly volumes: Volumes }[]; readonly total?: Volumes }
  readonly late: boolean
  /** On a converted order: the refund and fee as sent, in the order's original currency. */
  readonly original: { readonly refund_minor: string; readonly fee_minor: string; readonly currency: string } | null
  /** dispute_lost: the chargeback event (same order) it closes. */
  readonly dispute_of_event_id: string | null
}

export interface EffectEstimate {
  readonly volumes: Volumes
  readonly amount_minor: string
  readonly attributed_position_id: string | null
}

export type LateState = 'pending' | 'decided' | 'consumed'
export type Handling = 'adjust' | 'restatement'

export interface OrderLateItem {
  readonly id: string
  readonly origin_type: 'order' | 'order_event'
  readonly origin_id: string
  readonly original_period_id: string
  readonly effect_estimate: EffectEstimate
  readonly handling: Handling
  readonly state: LateState
  readonly decided_at: string | null
}

/** GET /v1/orders/:id. */
export interface OrderDetail extends OrderRow {
  readonly ordered_at: string
  readonly lines: readonly OrderLine[]
  readonly events: readonly OrderEvent[]
  readonly late_transactions: readonly OrderLateItem[]
  readonly source: { readonly inbound_event_id: string; readonly received_at: string; readonly source: string }
}

/** GET /v1/orders/summary: counts only. */
export interface OrderSummary {
  readonly orders: number
  readonly held: number
  readonly late_pending: number
  readonly purpose_missing: number
  readonly attribution_conflict: number
}

/** GET /v1/inbound-events rows (never the payload). */
export interface InboundEvent {
  readonly id: string
  readonly source: string
  readonly idempotency_key: string
  readonly received_at: string
  readonly state: 'held' | 'processed' | 'rejected'
  readonly hold_reason: string | null
  readonly hold_ref: string | null
  readonly attempts: number
  readonly result: { readonly error?: { readonly code: string }; readonly order_id?: string; readonly event_id?: string } | null
}

/** GET /v1/product-volumes rows. */
export interface VolumeRow {
  readonly id: string
  readonly market: { readonly id: string; readonly code: string }
  readonly sku: string
  readonly item_class: string
  readonly volumes: Volumes
  readonly valid_from: string
  readonly valid_to: string | null
  readonly created_by: { readonly id: string; readonly display_name: string | null }
  readonly reason: string
}

/** GET /v1/late-transactions rows. */
export interface LateItem {
  readonly id: string
  readonly origin_type: 'order' | 'order_event'
  readonly origin_id: string
  readonly order: { readonly id: string; readonly source_order_id: string }
  readonly original_period: { readonly id: string; readonly starts_at: string; readonly ends_at: string; readonly state: string }
  readonly effect_estimate: EffectEstimate
  readonly handling: Handling
  readonly state: LateState
  readonly decided_at: string | null
  readonly decision_reason: string | null
  readonly created_at: string
  /** The run whose commit consumed the item (an adjustment line), and that run's period, for the SC-02 link (PLAN B3 §2.6). */
  readonly consumed_by_run_id?: string | null
  readonly consumed_by_period_id?: string | null
}

/** POST /v1/late-transactions/preview. */
export interface LatePreview {
  readonly count: number
  readonly volumes: Volumes
  readonly amount_minor: string
  readonly affected_positions: readonly { readonly id: string; readonly position_ref: string }[]
}
