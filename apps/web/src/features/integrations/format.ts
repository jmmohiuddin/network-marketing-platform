// Display helpers of SC-13 Integrations.
import { durationLabel } from '../admin/format'
import type { ApiKey, CommerceProvider, DeliveryOutcome, KeyStatus, ServiceAccount, SyncState, WebhookDelivery, WebhookEndpoint } from './types'

/** StatusBadge state (for its tone) and the label shown. */
export interface Badge {
  readonly state: string
  readonly label: string
}

const KEY_BADGES: Readonly<Record<KeyStatus, Badge>> = {
  active: { state: 'active', label: 'Active' },
  expiring: { state: 'grace', label: 'Expiring' },
  expired: { state: 'expired', label: 'Expired' },
  revoked: { state: 'retired', label: 'Revoked' },
}

export function keyBadge(status: KeyStatus): Badge {
  return KEY_BADGES[status]
}

const OUTCOME_BADGES: Readonly<Record<DeliveryOutcome, Badge>> = {
  scheduled: { state: 'scheduled', label: 'Scheduled' },
  delivered: { state: 'accepted', label: 'Delivered' },
  failed: { state: 'failed', label: 'Failed' },
  dead: { state: 'failed', label: 'Gave up' },
  cancelled: { state: 'ended', label: 'Cancelled' },
}

export function outcomeBadge(outcome: DeliveryOutcome): Badge {
  return OUTCOME_BADGES[outcome]
}

/** Delivery error codes (webhook_delivery.error) in plain words; unknown codes show as they are. */
const DELIVERY_ERRORS: Readonly<Record<string, string>> = {
  ADDRESS_BLOCKED: 'The host resolves to a private or internal address, so nothing was sent.',
  DNS_FAILED: 'The host name could not be found.',
  CONNECTION_FAILED: 'The connection to the host could not be opened.',
  TLS_FAILED: 'The secure (TLS) connection failed.',
  TIMEOUT: 'The endpoint did not answer in time.',
  REDIRECT_REFUSED: 'The endpoint answered with a redirect, which is never followed.',
  HTTP_STATUS: 'The endpoint answered with an error status.',
  ENDPOINT_DISABLED: 'The endpoint was disabled before the attempt.',
}

export function deliveryErrorText(error: string | null): string {
  return error === null ? '—' : DELIVERY_ERRORS[error] ?? error
}

/** A key can still be rotated or revoked. */
export function isUsable(key: Pick<ApiKey, 'status'>): boolean {
  return key.status === 'active' || key.status === 'expiring'
}

/**
 * The loaded attempts Retry now can act on. The API retries the latest attempt of the event (a waiting one runs now, a
 * dead one gets a new attempt) and refuses a delivered or cancelled one. A failed attempt always has a later one
 * (dispatch schedules it), so only the latest loaded attempt per event, when scheduled or dead, qualifies.
 */
export function retryableIds(deliveries: readonly WebhookDelivery[]): ReadonlySet<string> {
  const latest = new Map<string, WebhookDelivery>()
  for (const delivery of deliveries) {
    const seen = latest.get(delivery.event.id)
    if (seen === undefined || delivery.attempt > seen.attempt) latest.set(delivery.event.id, delivery)
  }
  return new Set([...latest.values()].filter((delivery) => delivery.outcome === 'scheduled' || delivery.outcome === 'dead').map((delivery) => delivery.id))
}

/** Keys that still authenticate, over the loaded service accounts. */
export function usableKeyCount(accounts: readonly ServiceAccount[]): number {
  return accounts.reduce((count, account) => count + (account.state === 'active' ? account.keys.filter(isUsable).length : 0), 0)
}

/** Endpoints whose latest attempt failed or was given up. */
export function failingEndpointCount(endpoints: readonly WebhookEndpoint[]): number {
  return endpoints.filter((endpoint) => endpoint.last_delivery?.outcome === 'failed' || endpoint.last_delivery?.outcome === 'dead').length
}

/** The API's limit on IP networks per key. */
export const MAX_IP_NETWORKS = 20

/** The IP allow-list field: one address or CIDR network per line or separated by commas; empty entries dropped. */
export function parseNetworks(text: string): string[] {
  return text.split(/[\s,]+/).map((entry) => entry.trim()).filter((entry) => entry !== '')
}

const IPV4_BITS = 32
const IPV6_BITS = 128
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`)
const IPV6_CHARS = /^[0-9A-Fa-f:.]+$/

function ipFamily(address: string): 4 | 6 | null {
  if (IPV4.test(address)) return 4
  if (!address.includes(':') || !IPV6_CHARS.test(address)) return null
  // The URL parser accepts exactly the valid IPv6 literals (no zone id, which the API refuses too).
  try {
    new URL(`http://[${address}]/`)
    return 6
  } catch {
    return null
  }
}

/** One allow-list entry as the API accepts it: an IP address, or address/prefix within the family's bits. */
export function isNetwork(entry: string): boolean {
  const [address = '', prefix, ...rest] = entry.split('/')
  const family = ipFamily(address)
  if (family === null || rest.length > 0) return false
  return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? IPV4_BITS : IPV6_BITS))
}

export const PROVIDER_NAMES: Readonly<Record<CommerceProvider, string>> = { shopify: 'Shopify', woocommerce: 'WooCommerce' }

const SYNC_BADGES: Readonly<Record<SyncState, Badge>> = {
  healthy: { state: 'healthy', label: 'Healthy' },
  behind: { state: 'behind', label: 'Behind' },
  failing: { state: 'failed', label: 'Failing' },
  thresholds_not_set: { state: 'draft', label: 'Thresholds not set' },
}

export function syncBadge(state: SyncState): Badge {
  return SYNC_BADGES[state]
}

const SECONDS_PER_MINUTE = 60

/** Time since the last accepted event: "45 s", "2 h 5 min"; null when no event was accepted yet. */
export function lagLabel(seconds: number | null): string {
  if (seconds === null) return 'No accepted event yet'
  return seconds < SECONDS_PER_MINUTE ? `${seconds} s` : durationLabel(Math.floor(seconds / SECONDS_PER_MINUTE))
}
