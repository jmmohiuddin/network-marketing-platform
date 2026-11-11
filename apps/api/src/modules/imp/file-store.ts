import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { IMPORT_FILES, type ImportFile } from './vocabulary.js'

/**
 * Where uploaded export files live between validation and load (E-ADR-13: local disk now, S3-compatible
 * storage in a hosted deployment). Keys are (tenant, batch, file); callers never pass a path or file name.
 */
export interface FileStore {
  put(tenantId: string, batchId: string, file: ImportFile, data: Buffer): Promise<void>
  get(tenantId: string, batchId: string, file: ImportFile): Promise<Buffer>
  removeBatch(tenantId: string, batchId: string): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Files at <root>/<tenantId>/<batchId>/<file>.csv. Path traversal is impossible: both ids must be lower-case
 * UUIDs and the file name comes from a fixed list. Files are written once (no overwrite), readable by the
 * service user only.
 */
export function diskFileStore(root: string): FileStore {
  const base = resolve(root)
  const batchDir = (tenantId: string, batchId: string): string => {
    if (!UUID.test(tenantId) || !UUID.test(batchId)) throw new Error('file store keys must be UUIDs')
    return join(base, tenantId, batchId)
  }
  const pathOf = (tenantId: string, batchId: string, file: ImportFile): string => {
    if (!IMPORT_FILES.includes(file)) throw new Error('unknown import file')
    return join(batchDir(tenantId, batchId), `${file}.csv`)
  }
  return {
    async put(tenantId, batchId, file, data) {
      await mkdir(batchDir(tenantId, batchId), { recursive: true, mode: 0o700 })
      await writeFile(pathOf(tenantId, batchId, file), data, { mode: 0o600, flag: 'wx' })
    },
    async get(tenantId, batchId, file) {
      return readFile(pathOf(tenantId, batchId, file))
    },
    async removeBatch(tenantId, batchId) {
      await rm(batchDir(tenantId, batchId), { recursive: true, force: true })
    },
  }
}
