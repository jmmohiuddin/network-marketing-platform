import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { ADJUSTMENT_CASE_TYPE } from './adjustment.js'
import { RESTATEMENT_CASE_TYPE } from './restatement.js'
import { registerPeriodRoutes, registerRestatementRoutes, registerRunRoutes, registerSimulationRoutes } from './routes.js'
import { calculateRunJob } from './runs.js'
import { simulationJob } from './simulations.js'

/**
 * Commission runs (COMP, FR-COMP-001..010, FR-PLN-004 preview, FR-PLN-005): period state, runs on stored snapshots,
 * review and second-person commit (posting through led_post_run, B4), traces, replay, late, manual (case type) and
 * restatement (case type) adjustments, and simulations. Reads plans only as plan_version.compiled and the §4.2 SQL contracts.
 */
export const compModule: ApiModule = {
  name: 'comp',
  register(app) {
    registerPeriodRoutes(app)
    registerRunRoutes(app)
    registerSimulationRoutes(app)
    registerRestatementRoutes(app)
  },
  jobs: [calculateRunJob, simulationJob],
}

export const compCaseTypes: readonly CaseTypeDefinition[] = [
  RESTATEMENT_CASE_TYPE as CaseTypeDefinition, ADJUSTMENT_CASE_TYPE as CaseTypeDefinition,
]
