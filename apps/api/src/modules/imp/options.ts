import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const MEBIBYTE = 1024 * 1024
/** apps/api: a relative UPLOAD_DIR resolves here, so the API finds its files whatever its working directory. */
const API_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

// E-ADR-10 style engineering defaults for local use; the upload size limit is unspecified (API.md OQ list).
// 10 MiB per file (about 200,000 order rows): one such file measured 0.8 s and 290 MiB to validate (import-gate.ts).
const ImpEnvSchema = z.object({
  UPLOAD_DIR: z.string().min(1).default('var/uploads'),
  IMPORT_MAX_FILE_BYTES: z.coerce.number().int().positive().default(10 * MEBIBYTE),
})

export interface ImpOptions {
  /** Root of the local FileStore (E-ADR-13), absolute. */
  readonly uploadDir: string
  /** Largest accepted export file; a larger one is refused with 413 FILE_TOO_LARGE. */
  readonly maxFileBytes: number
}

/** Reads UPLOAD_DIR and IMPORT_MAX_FILE_BYTES; fails fast with every problem listed, like loadConfig. */
export function impOptionsFromEnv(env: NodeJS.ProcessEnv): ImpOptions {
  const parsed = ImpEnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`)
  }
  return { uploadDir: resolve(API_ROOT, parsed.data.UPLOAD_DIR), maxFileBytes: parsed.data.IMPORT_MAX_FILE_BYTES }
}
