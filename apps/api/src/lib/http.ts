import type { z } from 'zod'
import { validationFailed } from './errors.js'

export interface Envelope<T> {
  data: T
  meta: Record<string, unknown>
}

/** Success envelope: { data, meta }. */
export function envelope<T>(data: T, meta: Record<string, unknown> = {}): Envelope<T> {
  return { data, meta }
}

/** Parses untrusted input (body, query, params, headers); a failure becomes 400 VALIDATION_FAILED. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw validationFailed(result.error)
  return result.data
}
