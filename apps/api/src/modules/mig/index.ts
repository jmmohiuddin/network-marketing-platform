import type { ApiModule } from '../../lib/module.js'
import { registerMigrationRoutes } from './migrations.js'
import { registerOpeningRoutes } from './opening.js'
import { compareParallelRunsJob, registerParallelRunRoutes } from './parallel-runs.js'

/**
 * Migration (MIG, FR-MIG-001/002, PLAN B6 D-B6-09..11): a loaded IMP batch of kind migration applied into a market in
 * implementation, opening balances and state as of the cutover period (posted on approval), the parallel run of that
 * period against the legacy payouts, difference classification and acceptance, and the sign-off the market's go-live
 * checklist and the cutover period's runs wait for. Other modules read it only through the SQL contracts (mig_*).
 */
export const migModule: ApiModule = {
  name: 'mig',
  register(app) {
    registerMigrationRoutes(app)
    registerOpeningRoutes(app)
    registerParallelRunRoutes(app)
  },
  jobs: [compareParallelRunsJob],
}
