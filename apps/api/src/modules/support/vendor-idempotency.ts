import { createHash } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { ApiError } from '../../lib/errors.js'

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/ // printable ASCII, no spaces (as lib/idempotency.ts)

/** Idempotency-Key and request hash of a vendor creating POST. */
export interface VendorIdempotency {
  readonly key: string
  readonly hash: Buffer
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(entries.map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

/**
 * Vendor creating POSTs cannot use lib/idempotency.ts (idempotency_key rows need a tenant), so the created
 * row keeps the key and this hash (migration 0010), unique per creator. Same rules: the header is required,
 * the hash covers params and body, a replay of the same request returns the resource with
 * Idempotent-Replayed: true, a different request under the same key is 422 IDEMPOTENCY_KEY_REUSED.
 */
export function vendorIdempotency(request: FastifyRequest): VendorIdempotency {
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (1-255 printable characters).')
  }
  const material = JSON.stringify(canonical({ params: request.params ?? null, body: request.body ?? null }))
  return { key, hash: createHash('sha256').update(material).digest() }
}

/** The row stored under this key must come from the same request. */
export function assertSameRequest(storedHash: Buffer, idempotency: VendorIdempotency): void {
  if (!storedHash.equals(idempotency.hash)) {
    throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.')
  }
}
