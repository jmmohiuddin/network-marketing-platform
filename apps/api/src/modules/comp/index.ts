import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { ADJUSTMENT_CASE_TYPE } from './adjustment.js'
import { DISPUTE_CASE_TYPE, overdueDisputesJob } from './disputes.js'
import { registerPortalRoutes } from './portal-routes.js'
import { RESTATEMENT_CASE_TYPE } from './restatement.js'
import { registerPeriodRoutes, registerRestatementRoutes, registerRunRoutes, registerSimulationRoutes } from './routes.js'
import { calculateRunJob } from './runs.js'
import { simulationJob } from './simulations.js'

/**
 * Commission runs (COMP, FR-COMP-001..010, FR-PLN-004 preview, FR-PLN-005): period state, runs on stored snapshots,
 * review and second-person commit (posting through led_post_run, B4), traces, replay, late, manual (case type) and
 * restatement (case type) adjustments, simulations, and the distributor portal's statements, line explanations, rank
 * status and disputes (case type, B5). Reads plans only as plan_version.compiled and the §4.2 SQL contracts.
 */
export const compModule: ApiModule = {
  name: 'comp',
  register(app) {
    registerPeriodRoutes(app)
    registerRunRoutes(app)
    registerSimulationRoutes(app)
    registerRestatementRoutes(app)
    registerPortalRoutes(app)
  },
  jobs: [calculateRunJob, simulationJob, overdueDisputesJob],
}

export const compCaseTypes: readonly CaseTypeDefinition[] = [
  RESTATEMENT_CASE_TYPE as CaseTypeDefinition, ADJUSTMENT_CASE_TYPE as CaseTypeDefinition, DISPUTE_CASE_TYPE as CaseTypeDefinition,
]
