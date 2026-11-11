import type { ApiModule } from '../../lib/module.js'
import { computeSnapshotJob } from './compute.js'
import { registerComplianceRoutes } from './routes.js'

/**
 * Compliance analytics (CPL, FR-CPL-001..006): report snapshots computed by @nmp/compliance from the loaded
 * cpl_fact_* rows, stored figures, and drill-down to the rows behind each figure.
 */
export const cplModule: ApiModule = {
  name: 'cpl',
  register(app) {
    registerComplianceRoutes(app)
  },
  jobs: [computeSnapshotJob],
}

export { computeSnapshotJob }
