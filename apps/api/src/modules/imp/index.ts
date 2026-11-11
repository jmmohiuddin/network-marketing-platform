import multipart from '@fastify/multipart'
import type { ApiModule } from '../../lib/module.js'
import { diskFileStore } from './file-store.js'
import { impOptionsFromEnv, type ImpOptions } from './options.js'
import { registerImportRoutes } from './routes-imports.js'
import { registerMappingRoutes } from './routes-mappings.js'

/**
 * Data import (IMP, FR-IMP-001..003): upload and validation of overlay exports, versioned value mapping and the
 * load into cpl_fact_*. Options not given are read from UPLOAD_DIR and IMPORT_MAX_FILE_BYTES when the app is built.
 */
export function createImpModule(options: Partial<ImpOptions> = {}): ApiModule {
  return {
    name: 'imp',
    async register(app) {
      const settings = { ...impOptionsFromEnv(process.env), ...options }
      await app.register(multipart)
      registerImportRoutes(app, { store: diskFileStore(settings.uploadDir), maxFileBytes: settings.maxFileBytes })
      registerMappingRoutes(app)
    },
  }
}

export const impModule: ApiModule = createImpModule()

export { batchDataQuality, loadedBatches, tryLockLoads, type DataQuality, type LoadedBatch } from './batches.js'
export type { ImpOptions } from './options.js'
