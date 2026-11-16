import type { ApiModule } from '../../lib/module.js'
import { computeSnapshotJob } from './compute.js'
import { registerComplianceRoutes, registerPackRuleRoutes } from './routes.js'

/**
 * Compliance analytics (CPL, FR-CPL-001..006, 012): report snapshots computed by @nmp/compliance from the loaded
 * cpl_fact_* rows, stored figures, drill-down to the rows behind each figure, market-pack rules with their basis.
 * Snapshot reads are open to API keys with scope compliance:read.
 */
export const cplModule: ApiModule = {
  name: 'cpl',
  register(app) {
    registerComplianceRoutes(app)
    registerPackRuleRoutes(app)
  },
  jobs: [computeSnapshotJob],
}

export { computeSnapshotJob }
export { packRules, type PackRule } from './pack-rules.js'
export { publicSnapshotSchemas } from './public-schemas.js'
