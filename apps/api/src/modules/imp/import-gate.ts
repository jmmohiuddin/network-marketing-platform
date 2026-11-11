import type { FastifyReply } from 'fastify'
import { ApiError } from '../../lib/errors.js'

/**
 * Validating or loading a batch parses every file on the event loop and holds all rows in memory (measured: 0.8 s
 * and 290 MiB for a 10 MiB orders file), so each API process runs one such request at a time and refuses others
 * with 429.
 * shortcut: per-process gate instead of API-01's 202 + job; move validation and load into a worker process (a
 * pg-boss job in the API process would still block its event loop) once exports outgrow IMPORT_MAX_FILE_BYTES.
 */
const MAX_CONCURRENT_IMPORTS = 1
const RETRY_AFTER_SECONDS = 10

let running = 0

/** Takes an import slot of this process, or returns null when none is free. The returned function frees it once. */
export function acquireImportSlot(): (() => void) | null {
  if (running >= MAX_CONCURRENT_IMPORTS) return null
  running += 1
  let released = false
  return () => {
    if (released) return
    released = true
    running -= 1
  }
}

/** Runs an upload or load in an import slot; 429 IMPORT_BUSY with Retry-After when the process is busy. */
export async function inImportSlot<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> {
  const release = acquireImportSlot()
  if (release === null) {
    reply.header('retry-after', RETRY_AFTER_SECONDS)
    throw new ApiError(429, 'IMPORT_BUSY', 'Another import is being validated or loaded. Try again in a few seconds.')
  }
  try {
    return await work()
  } finally {
    release()
  }
}
