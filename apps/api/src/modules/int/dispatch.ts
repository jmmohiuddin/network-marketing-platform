import { randomInt } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import type { Config } from '../../config.js'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, type JobContext, type SystemJob } from '../../lib/jobs.js'
import { open } from '../../lib/secret-box.js'
import { checkWebhookUrl, isPublicAddress } from './address-guard.js'
import { secretContext } from './endpoints.js'
import { DNS_DEADLINE_MS, signatureHeader, type DeliveryResult, type WebhookResolver, type WebhookTransport } from './transport.js'

/** Outbox events fanned out per run, one system transaction each. */
const MAX_EVENTS_PER_RUN = 500
const CLAIM_LIMIT = 100
/** Attempts are started within this window after the claim; later claims are left for the next run. */
const START_WINDOW_MS = 120_000
/** Reading the delivery and recording the attempt, on top of the DNS and request deadlines. */
const RECORD_MARGIN_MS = 5000
const CONCURRENCY = 4
/** Backoff jitter: ±10 %. */
const JITTER_PERCENT = 10
const PERCENT = 100
const MS_PER_SECOND = 1000
const MS_PER_HOUR = 3_600_000

type DeliveryError = 'ADDRESS_BLOCKED' | 'DNS_FAILED' | 'CONNECTION_FAILED' | 'TLS_FAILED' | 'TIMEOUT' | 'REDIRECT_REFUSED' | 'HTTP_STATUS'

export interface Attempt {
  readonly status: number | null
  readonly error: DeliveryError | null
  readonly durationMs: number
}

/**
 * Delay before attempt `attempt + 1` after attempt `attempt` failed: base × 2^(attempt-1), capped, ±10 % jitter
 * (TR-API-15). jitter is a whole percentage in [-10, 10].
 */
export function retryDelayMs(attempt: number, config: Pick<Config, 'webhookRetryBaseSeconds' | 'webhookRetryMaxSeconds'>, jitter: number): number {
  const seconds = Math.min(config.webhookRetryMaxSeconds, config.webhookRetryBaseSeconds * 2 ** (attempt - 1))
  return Math.round((seconds * MS_PER_SECOND * (PERCENT + jitter)) / PERCENT)
}

const randomJitter = (): number => randomInt(-JITTER_PERCENT, JITTER_PERCENT + 1)

/** Moves every pending outbox event into webhook deliveries, one event per transaction (AC-INT1-7). */
async function fanOutOutbox(): Promise<number> {
  let settled = 0
  while (settled < MAX_EVENTS_PER_RUN) {
    const done = await withSystem(async (tx) => {
      const { rows } = await tx.query<{ id: string }>('SELECT id FROM outbox_claim(1)')
      const event = rows[0]
      if (event === undefined) return false
      await tx.query('SELECT webhook_fan_out($1)', [event.id])
      await tx.query('SELECT outbox_settle($1, true)', [event.id])
      return true
    })
    if (!done) break
    settled += 1
  }
  return settled
}

interface PendingDelivery {
  id: string
  endpoint_id: string
  attempt: number
  outcome: string
  url: string
  endpoint_state: 'active' | 'disabled'
  secret_sealed: string
  previous_secret_sealed: string | null
  event_id: string
  topic: string
  payload: unknown
  occurred_at: Date
  first_created_at: Date
}

async function loadDelivery(tx: Tx, id: string): Promise<PendingDelivery | null> {
  const { rows } = await tx.query<PendingDelivery>(
    `SELECT d.id, d.endpoint_id, d.attempt, d.outcome, w.url, w.state AS endpoint_state, w.secret_sealed,
            CASE WHEN w.previous_secret_expires_at > now() THEN w.previous_secret_sealed END AS previous_secret_sealed,
            e.id AS event_id, e.topic, e.payload, e.created_at AS occurred_at,
            (SELECT min(f.created_at) FROM webhook_delivery f
             WHERE f.endpoint_id = d.endpoint_id AND f.outbox_event_id = d.outbox_event_id) AS first_created_at
     FROM webhook_delivery d
     JOIN webhook_endpoint w ON w.tenant_id = d.tenant_id AND w.id = d.endpoint_id
     JOIN outbox_event e ON e.tenant_id = d.tenant_id AND e.id = d.outbox_event_id
     WHERE d.id = $1`,
    [id],
  )
  const delivery = rows[0]
  return delivery === undefined || delivery.outcome !== 'scheduled' ? null : delivery
}

export interface DispatchDeps {
  readonly transport: WebhookTransport
  readonly resolver: WebhookResolver
}

function judge(result: DeliveryResult): Pick<Attempt, 'status' | 'error'> {
  if (result.kind === 'error') return { status: null, error: result.error }
  const { status } = result
  if (status < 100 || status > 599) return { status: null, error: 'CONNECTION_FAILED' }
  if (status >= 200 && status < 300) return { status, error: null }
  return { status, error: status >= 300 && status < 400 ? 'REDIRECT_REFUSED' : 'HTTP_STATUS' }
}

/** Resolves, vets every address, then POSTs to the first one. Runs outside any transaction. */
async function attempt(delivery: PendingDelivery, tenantId: string, key: Buffer, config: Config, deps: DispatchDeps): Promise<Attempt> {
  const started = Date.now()
  const finish = (outcome: Pick<Attempt, 'status' | 'error'>): Attempt => ({ ...outcome, durationMs: Date.now() - started })
  const check = checkWebhookUrl(delivery.url, config.webhookAllowedPorts)
  if (!check.ok) return finish({ status: null, error: 'ADDRESS_BLOCKED' })
  let addresses: readonly { address: string; family: number }[]
  try {
    addresses = await deps.resolver(check.host)
  } catch {
    return finish({ status: null, error: 'DNS_FAILED' })
  }
  if (addresses.length === 0) return finish({ status: null, error: 'DNS_FAILED' })
  if (!addresses.every((entry) => isPublicAddress(entry.address))) return finish({ status: null, error: 'ADDRESS_BLOCKED' })
  const context = secretContext(delivery.endpoint_id)
  const secrets = [delivery.secret_sealed, delivery.previous_secret_sealed]
    .filter((sealed): sealed is string => sealed !== null)
    .map((sealed) => open(key, sealed, context))
  const timestamp = Math.floor(Date.now() / MS_PER_SECOND)
  const body = JSON.stringify({ id: delivery.event_id, type: delivery.topic, occurred_at: delivery.occurred_at.toISOString(), tenant: tenantId, data: delivery.payload })
  const headers = {
    'content-type': 'application/json', 'user-agent': 'nmp-webhooks/1',
    'webhook-id': delivery.event_id, 'webhook-timestamp': String(timestamp),
    'webhook-signature': signatureHeader(secrets, delivery.event_id, timestamp, body),
  }
  const result = await deps.transport({
    url: check.url, host: check.host, port: check.port, address: addresses[0]!, headers, body, timeoutMs: config.webhookTimeoutMs,
  })
  return finish(judge(result))
}

/** Records one attempt; a failure schedules the next attempt with backoff or, past the give-up window, is dead. */
async function record(tx: Tx, delivery: PendingDelivery, result: Attempt, config: Config, attemptedAt: Date): Promise<void> {
  const delay = retryDelayMs(delivery.attempt, config, randomJitter())
  const giveUpAt = delivery.first_created_at.getTime() + config.webhookGiveUpHours * MS_PER_HOUR
  const outcome = result.error === null ? 'delivered' : Date.now() + delay < giveUpAt ? 'failed' : 'dead'
  const { rowCount } = await tx.query(
    `UPDATE webhook_delivery SET outcome = $2, attempted_at = $3, status = $4, error = $5, duration_ms = $6
     WHERE id = $1 AND outcome = 'scheduled'`,
    [delivery.id, outcome, attemptedAt, result.status, result.error, result.durationMs],
  )
  if (rowCount !== 1) return // settled meanwhile (endpoint disabled)
  if (outcome === 'failed') {
    await tx.query(
      `INSERT INTO webhook_delivery (tenant_id, endpoint_id, outbox_event_id, attempt, outcome, next_attempt_at)
       VALUES (app_tenant_id(), $1, $2, $3, 'scheduled', now() + make_interval(secs => $4))`,
      [delivery.endpoint_id, delivery.event_id, delivery.attempt + 1, delay / MS_PER_SECOND],
    )
  }
  if (outcome === 'dead') {
    await recordAudit(tx, {
      action: 'WEBHOOK.DELIVERY_DEAD', objectType: 'webhook_delivery', objectId: delivery.id,
      after: { endpoint_id: delivery.endpoint_id, event_id: delivery.event_id, attempt: delivery.attempt, status: result.status, error: result.error },
    })
  }
}

async function deliverOne(claim: { tenant_id: string; delivery_id: string }, ctx: JobContext, deps: DispatchDeps): Promise<void> {
  const tenant = { tenantId: claim.tenant_id, userId: SYSTEM_ACTOR_ID }
  const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
  const delivery = await runInTenant(tenant, actor, async (tx) => {
    const found = await loadDelivery(tx, claim.delivery_id)
    if (found !== null && found.endpoint_state === 'disabled') {
      await tx.query(`UPDATE webhook_delivery SET outcome = 'cancelled', error = 'ENDPOINT_DISABLED' WHERE id = $1 AND outcome = 'scheduled'`, [found.id])
      return null
    }
    return found
  })
  if (delivery === null) return
  const attemptedAt = new Date()
  const result = await attempt(delivery, claim.tenant_id, ctx.config.secretKey, ctx.config, deps)
  await runInTenant(tenant, actor, (tx) => record(tx, delivery, result, ctx.config, attemptedAt))
}

/** One dispatcher run: fan out the outbox, then send the due attempts, CONCURRENCY at a time. */
export async function dispatchWebhooks(ctx: JobContext, deps: DispatchDeps): Promise<{ events: number; attempts: number }> {
  const events = await fanOutOutbox()
  // The lease outlasts the start window by one whole attempt, so no claim expires (and is sent again by another
  // dispatcher) while it is in flight here.
  const attemptBudgetMs = DNS_DEADLINE_MS + ctx.config.webhookTimeoutMs + RECORD_MARGIN_MS
  const leaseSeconds = Math.ceil((START_WINDOW_MS + attemptBudgetMs) / MS_PER_SECOND)
  const startBy = Date.now() + START_WINDOW_MS
  const { rows: claims } = await withSystem((tx) =>
    tx.query<{ tenant_id: string; delivery_id: string }>('SELECT tenant_id, delivery_id FROM webhook_claim_due($1, $2)', [CLAIM_LIMIT, leaseSeconds]),
  )
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < claims.length && Date.now() < startBy) {
      const claim = claims[next]!
      next += 1
      try {
        await deliverOne(claim, ctx, deps)
      } catch (error) {
        // The lease runs out and the attempt is claimed again on a later run.
        ctx.log.error({ err: error, deliveryId: claim.delivery_id }, 'webhook delivery could not be recorded')
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { events, attempts: next }
}

export const DISPATCH_JOB_NAME = 'int.webhooks.dispatch'

/** System job, every minute (PLAN B1 2.7). */
export function dispatchJob(deps: DispatchDeps): SystemJob {
  return defineSystemJob({
    name: DISPATCH_JOB_NAME,
    cron: '* * * * *',
    async run(ctx) {
      await dispatchWebhooks(ctx, deps)
    },
  })
}
