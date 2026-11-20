// Response shapes of the integration routes (PLAN B1 2.5 and 2.7; apps/api/src/modules/iam/api-keys.ts, int/endpoints.ts).

export const SERVICE_ACCOUNTS_PATH = '/v1/service-accounts'
export const API_KEY_OPTIONS_PATH = '/v1/api-keys/options'
export const WEBHOOK_ENDPOINTS_PATH = '/v1/webhook-endpoints'
export const WEBHOOK_TOPICS_PATH = '/v1/webhook-topics'

/** GET /v1/api-keys/options. */
export interface ApiKeyOptions {
  readonly scopes: readonly { readonly scope: string; readonly description: string; readonly personal_data: boolean }[]
  readonly rate_tiers: readonly { readonly tier: RateTier; readonly requests_per_minute: number }[]
  readonly max_grace_minutes: number
}

export type RateTier = 'standard' | 'high'
export type KeyStatus = 'active' | 'expiring' | 'expired' | 'revoked'

export interface ApiKey {
  readonly id: string
  readonly service_account_id: string
  readonly name: string
  readonly key_prefix: string
  readonly scopes: readonly string[]
  readonly rate_tier: RateTier
  readonly ip_allow: readonly string[] | null
  readonly expires_at: string | null
  readonly revoked_at: string | null
  readonly last_used_at: string | null
  readonly rotated_from_id: string | null
  readonly created_at: string
  readonly status: KeyStatus
}

export interface ServiceAccount {
  readonly id: string
  readonly name: string
  readonly purpose: string
  readonly state: 'active' | 'disabled'
  readonly disabled_at: string | null
  readonly created_at: string
  readonly created_by: { readonly id: string; readonly display_name: string | null }
  readonly keys: readonly ApiKey[]
}

/** POST /v1/service-accounts/:id/keys and /v1/api-keys/:id/rotate: the token only in the first response (D-B1-06). */
export interface IssuedKey {
  readonly key: ApiKey
  readonly token?: string
  readonly token_shown: boolean
}

/** GET /v1/webhook-topics. */
export interface WebhookTopic {
  readonly topic: string
  readonly description: string
  readonly payload_fields: readonly string[]
}

export type DeliveryOutcome = 'scheduled' | 'delivered' | 'failed' | 'dead' | 'cancelled'

export interface WebhookEndpoint {
  readonly id: string
  readonly url: string
  readonly description: string | null
  readonly topics: readonly string[]
  readonly state: 'active' | 'disabled'
  readonly secret_rotation_ends_at: string | null
  readonly created_at: string
  readonly created_by: { readonly id: string; readonly display_name: string | null }
  readonly updated_at: string
  readonly last_delivery: { readonly outcome: DeliveryOutcome; readonly attempted_at: string } | null
}

/** POST /v1/webhook-endpoints and /:id/rotate-secret: the secret only in the first response (D-B1-06). */
export interface IssuedSecret {
  readonly endpoint: WebhookEndpoint
  readonly secret?: string
  readonly secret_shown?: boolean
}

export interface WebhookDelivery {
  readonly id: string
  readonly event: { readonly id: string; readonly type: string; readonly occurred_at: string }
  readonly attempt: number
  readonly outcome: DeliveryOutcome
  readonly status: number | null
  readonly error: string | null
  readonly attempted_at: string | null
  readonly next_attempt_at: string
  readonly duration_ms: number | null
}

export const CONNECTORS_PATH = '/v1/connectors'
export const SYNC_HEALTH_PATH = '/v1/integrations/health'

export type CommerceProvider = 'shopify' | 'woocommerce'

/** GET /v1/connectors item (PLAN B2 2.6, D-B2-14): an inbound storefront webhook; the signing secret is never returned. */
export interface Connector {
  readonly id: string
  readonly provider: CommerceProvider
  readonly name: string
  readonly market: { readonly id: string; readonly code: string }
  readonly state: 'recorded' | 'withdrawn'
  readonly webhook_url: string
  readonly last_ok_at: string | null
  readonly created_at: string
  readonly created_by: { readonly id: string; readonly display_name: string | null }
  readonly withdrawn_at: string | null
}

export type SyncState = 'healthy' | 'behind' | 'failing' | 'thresholds_not_set'

/** GET /v1/integrations/health source (API-37): a connector or an API source system seen in inbound events. */
export interface SyncSource {
  readonly source: string
  readonly kind: 'connector' | 'api'
  readonly connector_id?: string | null
  readonly provider?: CommerceProvider | null
  readonly name: string
  readonly market?: { readonly id: string; readonly code: string } | null
  readonly state: SyncState
  readonly last_success_at: string | null
  readonly lag_seconds: number | null
  readonly errors_24h: number
  readonly held: number
  readonly held_overdue: number
  readonly last_error: { readonly code: string | null; readonly at: string | null } | null
}

export interface SyncHealth {
  readonly sources: readonly SyncSource[]
  readonly thresholds: { readonly behind_after_minutes: number; readonly failing_after_minutes: number } | null
}

export type FullExportState = 'queued' | 'running' | 'completed' | 'failed' | 'expired'

/** GET /v1/exports rows (API-32, PLAN B6 2.3). */
export interface FullExport {
  readonly id: string
  readonly trigger: 'manual' | 'schedule'
  readonly state: FullExportState
  readonly model_version: number
  readonly snapshot_at: string | null
  readonly table_count: number | null
  readonly total_rows: number | null
  readonly created_at: string
  readonly finished_at: string | null
  readonly requested_by: { readonly id: string; readonly type: string } | null
  readonly error: { readonly code: string } | null
}

export interface ManifestTable {
  readonly name: string
  readonly file: string
  readonly rows: number
  readonly bytes: number
  readonly sha256: string
}

/** GET /v1/exports/:id: the row, its signed manifest (more keys than shown: all of them are signed) and the Ed25519 signature (base64). */
export interface FullExportDetail extends FullExport {
  readonly manifest: { readonly tables: readonly ManifestTable[]; readonly snapshot_at: string; readonly generated_at: string } | null
  readonly signature: string | null
}

export interface ExcludedTable {
  readonly name: string
  readonly reason: string
}

/** GET /v1/exports/model: the published data model. */
export interface ExportModel {
  readonly version: number
  readonly tables: readonly { readonly name: string; readonly schema: string; readonly columns: readonly { readonly name: string; readonly type: string }[] }[]
  readonly excluded_tables: readonly ExcludedTable[]
  readonly excluded_columns: readonly { readonly table: string; readonly column: string; readonly reason: string }[]
}

/** GET /v1/exports/signing-key. */
export interface SigningKey {
  readonly algorithm: string
  readonly public_key: string
  readonly key_id: string
}

/** exports.full_schedule (D-B6-17): UTC; weekly = Mondays, monthly = the 1st. */
export interface FullSchedule {
  readonly cadence: 'daily' | 'weekly' | 'monthly'
  readonly hour_utc: number
}
