import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { seal } from '../../lib/secret-box.js'
import { checkWebhookUrl } from './address-guard.js'
import { isWebhookTopic, TEST_TOPIC } from './topics.js'
import { newWebhookSecret } from './transport.js'

/** AAD of a sealed endpoint secret (D-B1-07): a ciphertext copied to another endpoint does not open. */
export const secretContext = (endpointId: string): string => `webhook:${endpointId}`

export interface EndpointView {
  id: string
  url: string
  description: string | null
  topics: string[]
  state: 'active' | 'disabled'
  secret_rotation_ends_at: Date | null
  created_at: Date
  created_by: { id: string; display_name: string | null }
  updated_at: Date
  last_delivery: { outcome: string; attempted_at: string } | null
}

const VIEW = `
  SELECT w.id, w.url, w.description, w.topics, w.state,
         CASE WHEN w.previous_secret_expires_at > now() THEN w.previous_secret_expires_at END AS secret_rotation_ends_at,
         w.created_at, json_build_object('id', u.id, 'display_name', u.display_name) AS created_by, w.updated_at,
         (SELECT json_build_object('outcome', d.outcome, 'attempted_at', d.attempted_at) FROM webhook_delivery d
          WHERE d.endpoint_id = w.id AND d.attempted_at IS NOT NULL ORDER BY d.attempted_at DESC, d.id DESC LIMIT 1) AS last_delivery
  FROM webhook_endpoint w JOIN user_account u ON u.id = w.created_by`

export interface EndpointCursor {
  readonly created_at: string
  readonly id: string
}

/** Newest first. */
export async function listEndpoints(tx: Tx, after: EndpointCursor | undefined, limit: number): Promise<EndpointView[]> {
  const { rows } = await tx.query<EndpointView>(
    `${VIEW} WHERE ($1::timestamptz IS NULL OR (date_trunc('milliseconds', w.created_at), w.id) < ($1, $2::uuid))
     ORDER BY date_trunc('milliseconds', w.created_at) DESC, w.id DESC LIMIT $3`,
    [after?.created_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

export async function getEndpoint(tx: Tx, id: string): Promise<EndpointView> {
  const { rows } = await tx.query<EndpointView>(`${VIEW} WHERE w.id = $1`, [id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

/** The database CHECK on webhook_endpoint.url. */
export const WEBHOOK_URL_MAX = 2048

/** The URL as stored (WHATWG-normalised, e.g. lower-case scheme), or 422 WEBHOOK_URL_NOT_ALLOWED with the reason (AC-INT1-2). */
export function allowedUrl(url: string, allowedPorts: readonly number[]): string {
  const check = checkWebhookUrl(url, allowedPorts)
  if (!check.ok) throw new ApiError(422, 'WEBHOOK_URL_NOT_ALLOWED', check.message, { reason: check.reason })
  // Percent-encoding and punycode can lengthen the input past the limit.
  if (check.url.href.length > WEBHOOK_URL_MAX) {
    throw new ApiError(422, 'WEBHOOK_URL_NOT_ALLOWED', `The URL is longer than ${WEBHOOK_URL_MAX} characters once encoded.`, { reason: 'INVALID_URL' })
  }
  return check.url.href
}

export function assertTopics(topics: readonly string[]): void {
  const unknown = topics.filter((topic) => !isWebhookTopic(topic))
  if (unknown.length > 0) throw new ApiError(422, 'TOPIC_UNKNOWN', 'These topics cannot be subscribed to.', { topics: unknown })
}

export interface NewEndpoint {
  readonly url: string
  readonly topics: readonly string[]
  readonly description: string | null
}

/** The secret is returned here once; only its sealed form is stored. */
export async function createEndpoint(tx: Tx, key: Buffer, input: NewEndpoint): Promise<{ endpoint: EndpointView; secret: string }> {
  const id = randomUUID()
  const secret = newWebhookSecret()
  await tx.query(
    `INSERT INTO webhook_endpoint (id, tenant_id, url, description, secret_sealed, topics, state, created_by)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, 'active', app_user_id())`,
    [id, input.url, input.description, seal(key, secret, secretContext(id)), input.topics],
  )
  await recordAudit(tx, { action: 'WEBHOOK_ENDPOINT.CREATED', objectType: 'webhook_endpoint', objectId: id, after: { url: input.url, topics: input.topics } })
  return { endpoint: await getEndpoint(tx, id), secret }
}

interface LockedEndpoint {
  url: string
  state: 'active' | 'disabled'
  secret_sealed: string
  topics: string[]
}

async function lockEndpoint(tx: Tx, id: string): Promise<LockedEndpoint> {
  const { rows } = await tx.query<LockedEndpoint>('SELECT url, state, secret_sealed, topics FROM webhook_endpoint WHERE id = $1 FOR UPDATE', [id])
  if (rows[0] === undefined) throw notFound()
  return rows[0]
}

function assertActive(endpoint: LockedEndpoint): void {
  if (endpoint.state !== 'active') throw new ApiError(409, 'ENDPOINT_DISABLED', 'The endpoint is disabled. Enable it first.')
}

export interface EndpointChange {
  readonly url?: string
  readonly topics?: readonly string[]
  readonly description?: string | null
  readonly state?: 'active' | 'disabled'
}

/** Disabling cancels the endpoint's scheduled attempts (they would never be sent). */
export async function updateEndpoint(tx: Tx, id: string, change: EndpointChange): Promise<EndpointView> {
  const before = await lockEndpoint(tx, id)
  await tx.query(
    `UPDATE webhook_endpoint SET url = coalesce($2, url), topics = coalesce($3, topics),
       description = CASE WHEN $4 THEN $5 ELSE description END, state = coalesce($6, state), updated_at = now()
     WHERE id = $1`,
    [id, change.url ?? null, change.topics ?? null, change.description !== undefined, change.description ?? null, change.state ?? null],
  )
  const cancelled = change.state === 'disabled' && before.state === 'active' ? await cancelScheduled(tx, id) : 0
  await recordAudit(tx, {
    action: 'WEBHOOK_ENDPOINT.UPDATED', objectType: 'webhook_endpoint', objectId: id,
    before: { url: before.url, state: before.state, topics: before.topics },
    after: {
      changed: Object.keys(change).sort(), url: change.url ?? before.url, state: change.state ?? before.state,
      topics: change.topics ?? before.topics, cancelled_deliveries: cancelled,
    },
  })
  return getEndpoint(tx, id)
}

export async function cancelScheduled(tx: Tx, endpointId: string): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE webhook_delivery SET outcome = 'cancelled', error = 'ENDPOINT_DISABLED' WHERE endpoint_id = $1 AND outcome = 'scheduled'`,
    [endpointId],
  )
  return rowCount ?? 0
}

/**
 * AC-INT1-5: a new secret; the old one keeps signing (second signature) for graceMinutes. Grace 0 drops it now.
 */
export async function rotateSecret(tx: Tx, key: Buffer, id: string, graceMinutes: number): Promise<{ endpoint: EndpointView; secret: string }> {
  const endpoint = await lockEndpoint(tx, id)
  assertActive(endpoint)
  const secret = newWebhookSecret()
  const keepOld = graceMinutes > 0
  await tx.query(
    `UPDATE webhook_endpoint SET secret_sealed = $2, previous_secret_sealed = $3,
       previous_secret_expires_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() + make_interval(mins => $4) END, updated_at = now()
     WHERE id = $1`,
    [id, seal(key, secret, secretContext(id)), keepOld ? endpoint.secret_sealed : null, graceMinutes],
  )
  await recordAudit(tx, { action: 'WEBHOOK_ENDPOINT.SECRET_ROTATED', objectType: 'webhook_endpoint', objectId: id, after: { grace_minutes: graceMinutes } })
  return { endpoint: await getEndpoint(tx, id), secret }
}

/** Queues a webhook.test event for this endpoint only; the dispatcher delivers it like any other. */
export async function sendTest(tx: Tx, id: string): Promise<string> {
  assertActive(await lockEndpoint(tx, id))
  const eventId = await enqueueOutbox(tx, { type: TEST_TOPIC, key: id, payload: { endpoint_id: id } })
  await recordAudit(tx, { action: 'WEBHOOK.TEST_SENT', objectType: 'webhook_endpoint', objectId: id, after: { event_id: eventId } })
  return eventId
}

export interface DeliveryView {
  id: string
  event: { id: string; type: string; occurred_at: string }
  attempt: number
  outcome: string
  status: number | null
  error: string | null
  attempted_at: Date | null
  next_attempt_at: Date
  duration_ms: number | null
  created_at: Date
}

const DELIVERY_VIEW = `
  SELECT d.id, json_build_object('id', e.id, 'type', e.topic, 'occurred_at', e.created_at) AS event, d.attempt, d.outcome,
         d.status, d.error, d.attempted_at, d.next_attempt_at, d.duration_ms, d.created_at
  FROM webhook_delivery d JOIN outbox_event e ON e.tenant_id = d.tenant_id AND e.id = d.outbox_event_id`

/** Attempts of one endpoint, newest first. */
export async function listDeliveries(
  tx: Tx, endpointId: string, outcome: string | undefined, after: EndpointCursor | undefined, limit: number,
): Promise<DeliveryView[]> {
  await getEndpoint(tx, endpointId)
  const { rows } = await tx.query<DeliveryView>(
    `${DELIVERY_VIEW}
     WHERE d.endpoint_id = $1 AND ($2::text IS NULL OR d.outcome = $2)
       AND ($3::timestamptz IS NULL OR (date_trunc('milliseconds', d.created_at), d.id) < ($3, $4::uuid))
     ORDER BY date_trunc('milliseconds', d.created_at) DESC, d.id DESC LIMIT $5`,
    [endpointId, outcome ?? null, after?.created_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

/**
 * Retry now (AC-INT1-4): the latest attempt of the delivery's event at its endpoint is moved to now when it is still
 * scheduled, or followed by a new attempt when it failed or is dead. Delivered and cancelled ones are final.
 */
export async function retryDelivery(tx: Tx, id: string): Promise<DeliveryView> {
  const { rows } = await tx.query<{ endpoint_id: string; outbox_event_id: string }>(
    'SELECT endpoint_id, outbox_event_id FROM webhook_delivery WHERE id = $1',
    [id],
  )
  const target = rows[0]
  if (target === undefined) throw notFound()
  assertActive(await lockEndpoint(tx, target.endpoint_id))
  const latest = (await tx.query<{ id: string; attempt: number; outcome: string }>(
    `SELECT id, attempt, outcome FROM webhook_delivery WHERE endpoint_id = $1 AND outbox_event_id = $2
     ORDER BY attempt DESC LIMIT 1 FOR UPDATE`,
    [target.endpoint_id, target.outbox_event_id],
  )).rows[0]!
  if (latest.outcome === 'delivered' || latest.outcome === 'cancelled') {
    throw new ApiError(409, 'DELIVERY_NOT_RETRYABLE', `The delivery is ${latest.outcome}; it cannot be retried.`)
  }
  const scheduledId = latest.outcome === 'scheduled'
    ? (await tx.query<{ id: string }>('UPDATE webhook_delivery SET next_attempt_at = now() WHERE id = $1 RETURNING id', [latest.id])).rows[0]!.id
    : (await tx.query<{ id: string }>(
        `INSERT INTO webhook_delivery (tenant_id, endpoint_id, outbox_event_id, attempt, outcome, next_attempt_at, created_by)
         VALUES (app_tenant_id(), $1, $2, $3, 'scheduled', now(), app_user_id()) RETURNING id`,
        [target.endpoint_id, target.outbox_event_id, latest.attempt + 1],
      )).rows[0]!.id
  await recordAudit(tx, {
    action: 'WEBHOOK.DELIVERY_RETRIED', objectType: 'webhook_delivery', objectId: scheduledId,
    after: { endpoint_id: target.endpoint_id, event_id: target.outbox_event_id, previous_outcome: latest.outcome },
  })
  return (await tx.query<DeliveryView>(`${DELIVERY_VIEW} WHERE d.id = $1`, [scheduledId])).rows[0]!
}
