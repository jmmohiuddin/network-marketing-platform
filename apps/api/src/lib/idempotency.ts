import { createHash } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ApiError } from './errors.js'

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/ // printable ASCII, no spaces

export interface StoredResponse {
  readonly statusCode: number
  readonly body: unknown
}

export interface IdempotentResult extends StoredResponse {
  readonly replayed: boolean
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(entries.map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

function requestHash(request: FastifyRequest): Buffer {
  const material = JSON.stringify(canonical({ params: request.params ?? null, body: request.body ?? null }))
  return createHash('sha256').update(material).digest()
}

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (1-255 printable characters).')
  }
  return key
}

/**
 * Runs a creating request at most once per (tenant, Idempotency-Key, route; plus the user for portal sessions), inside the caller's tenant
 * transaction, so the key and the side effect commit or roll back together. Same key and same request:
 * the stored response is returned without side effects. Same key, different request: 422
 * IDEMPOTENCY_KEY_REUSED. A concurrent duplicate waits on the key's row until the first request commits (then
 * it replays) or rolls back (then it runs), so it never sees a request in progress.
 */
export async function idempotent(
  tx: Tx,
  request: FastifyRequest,
  run: () => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  const key = idempotencyKey(request)
  // A portal session's keys are its own (PLAN B5 FR-IAM-007): participants of one tenant never replay each other's responses.
  const portalUser = request.auth?.realm === 'portal' ? ` ${request.auth.userId}` : ''
  const route = `${request.method} ${request.routeOptions.url ?? request.url}${portalUser}`
  const hash = requestHash(request)
  const inserted = await tx.query(
    `INSERT INTO idempotency_key (tenant_id, key, route, request_hash) VALUES (app_tenant_id(), $1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING key`,
    [key, route, hash],
  )
  if (inserted.rowCount === 0) return replay(tx, key, route, hash)
  const first = await run()
  await tx.query(
    'UPDATE idempotency_key SET response = $3 WHERE tenant_id = app_tenant_id() AND key = $1 AND route = $2',
    [key, route, { statusCode: first.statusCode, body: first.body }],
  )
  return { ...first, replayed: false }
}

async function replay(tx: Tx, key: string, route: string, hash: Buffer): Promise<IdempotentResult> {
  // response is written in the same transaction as the key, so a visible row always has one.
  const { rows } = await tx.query<{ request_hash: Buffer; response: StoredResponse }>(
    'SELECT request_hash, response FROM idempotency_key WHERE tenant_id = app_tenant_id() AND key = $1 AND route = $2',
    [key, route],
  )
  const row = rows[0]!
  if (!row.request_hash.equals(hash)) {
    throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.')
  }
  return { ...row.response, replayed: true }
}

/** Sends an idempotent result; replays carry the header Idempotent-Replayed: true. */
export function sendIdempotent(reply: FastifyReply, result: IdempotentResult): unknown {
  reply.code(result.statusCode)
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  return result.body
}
