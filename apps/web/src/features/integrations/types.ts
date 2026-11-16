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
