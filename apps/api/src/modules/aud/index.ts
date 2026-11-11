import type { ApiModule } from '../../lib/module.js'
import { registerAuditRoutes } from './routes.js'
import { verifyAllChainsJob, verifyTenantChainJob } from './verify.js'

/** Audit (FR-AUD-001/002): search, capped exports, chain verification on demand and daily. */
export const audModule: ApiModule = {
  name: 'aud',
  register(app) {
    registerAuditRoutes(app)
  },
  jobs: [verifyAllChainsJob, verifyTenantChainJob],
}
