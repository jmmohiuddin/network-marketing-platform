import multipart from '@fastify/multipart'
import type { ApiModule } from '../../lib/module.js'
import { diskDocumentStore, uploadDirFromEnv } from './document-store.js'
import { registerDocumentRoutes } from './routes-documents.js'
import { registerAuditRoutes } from './routes.js'
import { verifyAllChainsJob, verifyTenantChainJob } from './verify.js'

/**
 * Audit (FR-AUD-001/002): search, capped exports, chain verification on demand and daily; evidence documents
 * (PLAN B1 section 2.8) stored under UPLOAD_DIR, read when the app is built.
 */
export const audModule: ApiModule = {
  name: 'aud',
  async register(app) {
    await app.register(multipart)
    registerAuditRoutes(app)
    registerDocumentRoutes(app, diskDocumentStore(uploadDirFromEnv(process.env)))
  },
  jobs: [verifyAllChainsJob, verifyTenantChainJob],
}
