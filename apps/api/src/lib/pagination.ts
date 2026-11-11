import { z } from 'zod'
import { ApiError } from './errors.js'
import { envelope, type Envelope } from './http.js'

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

/** Query fields every collection accepts (TR-API-09): opaque cursor, limit 1..200 (default 50). */
export const pageQuery = {
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
}

/** The cursor is the sort key of the last row, as base64url JSON. Opaque to clients. */
export function encodeCursor(key: unknown): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url')
}

/** Decodes a cursor and validates its shape; 400 INVALID_CURSOR if it was not issued by encodeCursor. */
export function decodeCursor<S extends z.ZodType>(cursor: string | undefined, schema: S): z.infer<S> | undefined {
  if (cursor === undefined) return undefined
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor()
  }
  const result = schema.safeParse(decoded)
  if (!result.success) throw invalidCursor()
  return result.data
}

function invalidCursor(): ApiError {
  return new ApiError(400, 'INVALID_CURSOR', 'The cursor is not valid. Start again without a cursor.')
}

/**
 * Turns rows fetched with LIMIT limit + 1 into one page: { data, meta: { next_cursor } }.
 * next_cursor is null on the last page.
 */
export function toPage<T>(rows: readonly T[], limit: number, keyOf: (row: T) => unknown): Envelope<T[]> {
  const data = rows.slice(0, limit)
  const last = data.at(-1)
  const nextCursor = rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null
  return envelope(data, { next_cursor: nextCursor })
}
