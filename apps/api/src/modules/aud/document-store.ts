import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** apps/api: a relative UPLOAD_DIR resolves here, as in imp/options.ts. */
const API_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Evidence files (E-ADR-13: local disk now, S3-compatible storage in a hosted deployment). Keys are uuids only. */
export interface DocumentStore {
  put(tenantId: string, documentId: string, data: Buffer): Promise<void>
  get(tenantId: string, documentId: string): Promise<Buffer>
  remove(tenantId: string, documentId: string): Promise<void>
}

/** UPLOAD_DIR (default var/uploads, relative to apps/api), the root imp uses too; fails fast like loadConfig. */
export function uploadDirFromEnv(env: NodeJS.ProcessEnv): string {
  const parsed = z.object({ UPLOAD_DIR: z.string().min(1).default('var/uploads') }).safeParse(env)
  if (!parsed.success) throw new Error(`Invalid configuration:\nUPLOAD_DIR: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  return resolve(API_ROOT, parsed.data.UPLOAD_DIR)
}

/**
 * Files at <root>/<tenantId>/documents/<documentId> (PLAN B1 section 2.8). Both keys must be lower-case uuids, so no
 * client value reaches the path; a file is written once (no overwrite) and readable by the service user only.
 */
export function diskDocumentStore(root: string): DocumentStore {
  const base = resolve(root)
  const directory = (tenantId: string): string => {
    if (!UUID.test(tenantId)) throw new Error('document store keys must be UUIDs')
    return join(base, tenantId, 'documents')
  }
  const pathOf = (tenantId: string, documentId: string): string => {
    if (!UUID.test(documentId)) throw new Error('document store keys must be UUIDs')
    return join(directory(tenantId), documentId)
  }
  return {
    async put(tenantId, documentId, data) {
      await mkdir(directory(tenantId), { recursive: true, mode: 0o700 })
      await writeFile(pathOf(tenantId, documentId), data, { mode: 0o600, flag: 'wx' })
    },
    async get(tenantId, documentId) {
      return readFile(pathOf(tenantId, documentId))
    },
    async remove(tenantId, documentId) {
      await rm(pathOf(tenantId, documentId), { force: true })
    },
  }
}
