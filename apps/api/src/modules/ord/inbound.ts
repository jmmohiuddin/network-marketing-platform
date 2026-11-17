import { createHash, randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { envelope } from '../../lib/http.js'
import type { StoredResponse } from '../../lib/idempotency.js'
import { processEvent } from './event-ingest.js'
import { creditingEvent } from './order-checks.js'
import { processOrder } from './order-ingest.js'
import type { AttemptRefs, Outcome } from './outcome.js'
import { asRefusal, Refusal, refusalBody } from './refusal.js'
import type { EventInput, OrderInput } from './schemas.js'
import { eventView, orderFacts } from './views.js'

// D-B2-11: one inbound_event per order or event write, deduplicated by its natural key within its source.

export type Submission =
  | { readonly kind: 'order'; readonly source: string; readonly input: OrderInput }
  | { readonly kind: 'event'; readonly source: string; readonly input: EventInput }

export interface IngestContext {
  readonly requestId: string
  readonly toleranceSeconds: number
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canonical(v)]))
  }
  return value
}

/** SHA-256 of the canonical JSON (keys sorted) of a normalised input. */
export function payloadHash(input: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(canonical(input))).digest()
}

const without = (input: object, key: string) => Object.fromEntries(Object.entries(input).filter(([name]) => name !== key))

/**
 * The hash of the facts a re-delivery must repeat (AC-22.2: only a change to the order itself is a conflict). Left out:
 * an order's paid and fulfilled times (checked apart by creditingTimeChanged, so the hash never depends on a setting
 * version) and a connector event's time, which is the store's last save of the order (WooCommerce date_modified_gmt
 * changes on every save of a refunded or cancelled order).
 */
function factsHash(submission: Submission): Buffer {
  if (submission.kind === 'event') {
    return payloadHash(submission.source.startsWith('connector:') ? without(submission.input, 'occurred_at') : submission.input)
  }
  return payloadHash(without(without(submission.input, 'paid_at'), 'fulfilled_at'))
}

const instant = (value: string | undefined) => (value === undefined ? null : Date.parse(value))

/**
 * A re-delivered order must repeat the time it is credited at: a processed order's credited_at must be its paid or its
 * fulfilled time (whichever event was in force at first receipt); a held one keeps the time of the event now in force (D-B3-05).
 */
async function creditingTimeChanged(tx: Tx, submission: Submission, existing: { state: string; payload: unknown; result: Record<string, string> }): Promise<boolean> {
  if (submission.kind !== 'order') return false
  const { paid_at: paidAt, fulfilled_at: fulfilledAt } = submission.input
  if (existing.state === 'processed') {
    const { rows } = await tx.query<{ credited_at: Date }>('SELECT credited_at FROM sales_order WHERE id = $1', [existing.result.order_id])
    return ![instant(paidAt), instant(fulfilledAt)].includes(rows[0]!.credited_at.getTime())
  }
  const held = existing.payload as OrderInput
  const crediting = await creditingEvent(tx, held.market, held.ordered_at)
  if (crediting === null) return false
  const field = crediting === 'paid' ? 'paid_at' : 'fulfilled_at'
  return instant(held[field]) !== instant(submission.input[field])
}

const orderKey = (input: { source_system: string; source_order_id: string }) => `order:${input.source_system}:${input.source_order_id}`

export function naturalKey(submission: Submission): string {
  return submission.kind === 'order'
    ? orderKey(submission.input)
    : `event:${submission.input.source_system}:${submission.input.source_event_id}`
}

interface HeldRow {
  readonly id: string
  readonly source: string
  readonly idempotency_key: string
  readonly payload: OrderInput | EventInput
  readonly payload_hash: Buffer
  readonly attempts: number
}

const created = (outcome: Outcome & { state: 'processed' }): StoredResponse => ({ statusCode: 201, body: outcome.body })
const heldBody = (id: string, outcome: Outcome & { state: 'held' }) =>
  envelope({ held: { inbound_event_id: id, reason: outcome.reason, ...(outcome.skus === undefined ? {} : { skus: outcome.skus }) } })

function process(tx: Tx, submission: Submission, refs: AttemptRefs, ctx: IngestContext): Promise<Outcome> {
  return submission.kind === 'order'
    ? processOrder(tx, submission.input, refs, ctx.toleranceSeconds)
    : processEvent(tx, submission.input, refs, ctx.toleranceSeconds, submission.source.startsWith('connector:'))
}

/** Serialises every write of one natural key within its source (transaction-scoped advisory lock). */
async function lockKey(tx: Tx, source: string, key: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('inbound:' || app_tenant_id() || ':' || $1 || ':' || $2, 0))`, [source, key])
}

/**
 * Runs one attempt inside a savepoint; a refusal or a hold rolls everything back and is returned as a value. An event
 * first takes its order's key lock (E-ORD-01), outside the savepoint so a hold keeps it until commit: an order being
 * ingested meanwhile is then seen committed, or finds this event's held row when it releases awaiting events.
 */
async function attempt(tx: Tx, submission: Submission, refs: AttemptRefs, ctx: IngestContext, before?: () => Promise<void>): Promise<Outcome | Refusal> {
  if (submission.kind === 'event') {
    await lockKey(tx, submission.source, orderKey(submission.input))
  }
  await tx.query('SAVEPOINT ingest_attempt')
  try {
    if (before !== undefined) await before()
    const outcome = await process(tx, submission, refs, ctx)
    if (outcome.state === 'held') await tx.query('ROLLBACK TO SAVEPOINT ingest_attempt')
    return outcome
  } catch (error) {
    const refusal = asRefusal(error)
    if (refusal === null) throw error
    await tx.query('ROLLBACK TO SAVEPOINT ingest_attempt')
    return refusal
  }
}

/** Persists a refusal as a rejected inbound event with its audit (ORDER.CONFLICT for 409s, else ORDER.REJECTED). */
export async function recordRejected(
  tx: Tx, rejection: { source: string; key: string; hash: Buffer; refusal: Refusal }, requestId: string,
): Promise<StoredResponse> {
  const { source, key, hash, refusal } = rejection
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, result, state)
     VALUES (app_tenant_id(), $1, $2, $3, now(), $4, 'rejected') RETURNING id`,
    [source, key, hash, { error: { code: refusal.code } }],
  )
  await recordAudit(tx, {
    action: refusal.status === 409 ? 'ORDER.CONFLICT' : 'ORDER.REJECTED', objectType: 'inbound_event', objectId: rows[0]!.id,
    after: { source, code: refusal.code },
  })
  return { statusCode: refusal.status, body: refusalBody(refusal, requestId) }
}

async function holdNew(tx: Tx, submission: Submission, hash: Buffer, outcome: Outcome & { state: 'held' }): Promise<StoredResponse> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, state, payload, hold_reason, hold_ref)
     VALUES (app_tenant_id(), $1, $2, $3, 'held', $4, $5, $6) RETURNING id`,
    [submission.source, naturalKey(submission), hash, submission.input, outcome.reason, outcome.ref],
  )
  await recordAudit(tx, { action: 'ORDER.HELD', objectType: 'inbound_event', objectId: rows[0]!.id, after: { reason: outcome.reason, attempts: 1 } })
  return { statusCode: 202, body: heldBody(rows[0]!.id, outcome) }
}

async function attemptNew(tx: Tx, submission: Submission, hash: Buffer, ctx: IngestContext): Promise<StoredResponse> {
  const refs = { inboundId: randomUUID(), targetId: randomUUID(), hash }
  const resultKey = submission.kind === 'order' ? 'order_id' : 'event_id'
  // A processed row cannot change, so it is written first with the id the attempt will create (rolled back otherwise).
  const outcome = await attempt(tx, submission, refs, ctx, async () => {
    await tx.query(
      `INSERT INTO inbound_event (id, tenant_id, source, idempotency_key, payload_hash, processed_at, result, state)
       VALUES ($1, app_tenant_id(), $2, $3, $4, now(), $5, 'processed')`,
      [refs.inboundId, submission.source, naturalKey(submission), hash, { [resultKey]: refs.targetId }],
    )
  })
  if (outcome instanceof Refusal) return recordRejected(tx, { source: submission.source, key: naturalKey(submission), hash, refusal: outcome }, ctx.requestId)
  if (outcome.state === 'held') return holdNew(tx, submission, hash, outcome)
  await releaseAwaiting(tx, submission, ctx)
  return created(outcome)
}

export interface Reattempt {
  readonly state: 'processed' | 'held' | 'rejected'
  readonly result: unknown
  readonly response: StoredResponse
}

/** Processes a held row again (the caller holds its row lock): processed, still held (attempts + 1) or rejected. */
export async function reattempt(tx: Tx, row: HeldRow, ctx: IngestContext): Promise<Reattempt> {
  const submission = { kind: row.idempotency_key.startsWith('order:') ? 'order' : 'event', source: row.source, input: row.payload } as Submission
  const outcome = await attempt(tx, submission, { inboundId: row.id, targetId: randomUUID(), hash: row.payload_hash }, ctx)
  if (outcome instanceof Refusal) {
    const result = { error: { code: outcome.code } }
    await tx.query(
      `UPDATE inbound_event SET state = 'rejected', processed_at = now(), result = $2, payload = NULL, attempts = attempts + 1 WHERE id = $1`,
      [row.id, result],
    )
    const action = outcome.status === 409 ? 'ORDER.CONFLICT' : 'ORDER.REJECTED'
    await recordAudit(tx, { action, objectType: 'inbound_event', objectId: row.id, after: { source: row.source, code: outcome.code } })
    return { state: 'rejected', result, response: { statusCode: outcome.status, body: refusalBody(outcome, ctx.requestId) } }
  }
  if (outcome.state === 'held') {
    await tx.query('UPDATE inbound_event SET attempts = attempts + 1, hold_reason = $2, hold_ref = $3 WHERE id = $1', [row.id, outcome.reason, outcome.ref])
    await recordAudit(tx, { action: 'ORDER.HELD', objectType: 'inbound_event', objectId: row.id, after: { reason: outcome.reason, attempts: row.attempts + 1 } })
    return { state: 'held', result: null, response: { statusCode: 202, body: heldBody(row.id, outcome) } }
  }
  await tx.query(
    `UPDATE inbound_event SET state = 'processed', processed_at = now(), result = $2, payload = NULL, attempts = attempts + 1 WHERE id = $1`,
    [row.id, outcome.result],
  )
  await releaseAwaiting(tx, submission, ctx)
  return { state: 'processed', result: outcome.result, response: created(outcome) }
}

const HELD_COLUMNS = 'id, source, idempotency_key, payload, payload_hash, attempts'

/**
 * E-ORD-01: events held ORDER_NOT_FOUND for an order that just arrived are processed now, oldest first. A row locked by a
 * retry or re-delivery is skipped: that transaction waits for this order's key lock (attempt) and then finds the order.
 */
async function releaseAwaiting(tx: Tx, submission: Submission, ctx: IngestContext): Promise<void> {
  if (submission.kind !== 'order') return
  const { rows } = await tx.query<HeldRow>(
    `SELECT ${HELD_COLUMNS} FROM inbound_event
     WHERE state = 'held' AND hold_reason = 'ORDER_NOT_FOUND' AND source = $1 AND hold_ref = $2
     ORDER BY received_at, id FOR UPDATE SKIP LOCKED`,
    [submission.source, submission.input.source_order_id],
  )
  for (const row of rows) await reattempt(tx, row, ctx)
}

async function replay(tx: Tx, kind: Submission['kind'], result: Record<string, string>): Promise<StoredResponse> {
  const body = kind === 'order'
    ? envelope({ order: await orderFacts(tx, result.order_id!), replayed: true })
    : envelope({ event: await eventView(tx, result.event_id!), replayed: true })
  return { statusCode: 200, body }
}

/**
 * Receives one order or event: same natural key and body = replay (or, while held, another attempt); a different body =
 * 409 ORDER_CONFLICT / EVENT_CONFLICT persisted; otherwise a first attempt. Serialised per natural key.
 */
export async function receive(tx: Tx, submission: Submission, ctx: IngestContext): Promise<StoredResponse> {
  const key = naturalKey(submission)
  const hash = factsHash(submission)
  await lockKey(tx, submission.source, key)
  const { rows } = await tx.query<HeldRow & { state: string; result: Record<string, string> }>(
    `SELECT ${HELD_COLUMNS}, state, result FROM inbound_event
     WHERE source = $1 AND idempotency_key = $2 AND state IN ('held', 'processed') FOR UPDATE`,
    [submission.source, key],
  )
  const existing = rows[0]
  if (existing === undefined) return attemptNew(tx, submission, hash, ctx)
  if (!existing.payload_hash.equals(hash) || await creditingTimeChanged(tx, submission, existing)) {
    const code = submission.kind === 'order' ? 'ORDER_CONFLICT' : 'EVENT_CONFLICT'
    const refusal = new Refusal(409, code, `This ${submission.kind} was already received with a different body; send corrections as order events.`, {
      inbound_event_id: existing.id,
    })
    return recordRejected(tx, { source: submission.source, key, hash, refusal }, ctx.requestId)
  }
  if (existing.state === 'processed') return replay(tx, submission.kind, existing.result)
  return (await reattempt(tx, existing, ctx)).response
}

/** POST /v1/inbound-events/:id/retry: a held row is processed again; anything else is 409 NOT_HELD. */
export async function retryHeld(tx: Tx, id: string, ctx: IngestContext): Promise<{ state: string; result: unknown } | null> {
  // Key lock before row lock, as receive() takes them (source and key never change).
  const { rows: keys } = await tx.query<{ source: string; idempotency_key: string }>('SELECT source, idempotency_key FROM inbound_event WHERE id = $1', [id])
  if (keys[0] === undefined) return null
  await lockKey(tx, keys[0].source, keys[0].idempotency_key)
  const { rows } = await tx.query<HeldRow & { state: string }>(`SELECT ${HELD_COLUMNS}, state FROM inbound_event WHERE id = $1 FOR UPDATE`, [id])
  const row = rows[0]
  if (row === undefined) return null
  if (row.state !== 'held') throw new ApiError(409, 'NOT_HELD', 'This inbound event is not held: it was already processed or rejected.')
  const outcome = await reattempt(tx, row, ctx)
  await recordAudit(tx, {
    action: 'INBOUND_EVENT.RETRIED', objectType: 'inbound_event', objectId: id, after: { state: outcome.state, attempts: row.attempts + 1 },
  })
  return { state: outcome.state, result: outcome.result }
}
