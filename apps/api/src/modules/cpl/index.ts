import type { ApiModule } from '../../lib/module.js'
import { computeSnapshotJob } from './compute.js'
import { registerGuardrailRoutes } from './guardrail-routes.js'
import { registerComplianceRoutes, registerPackRuleRoutes } from './routes.js'

/**
 * Compliance analytics (CPL, FR-CPL-001..006, 012): report snapshots computed by @nmp/compliance from the loaded
 * cpl_fact_* rows, stored figures, drill-down to the rows behind each figure, market-pack rules with their basis.
 * Snapshot reads are open to API keys with scope compliance:read. Plan guardrails (FR-CPL-007/008): decisions over plan
 * versions, evaluated by PLN through this facade, listed and overridden here.
 */
export const cplModule: ApiModule = {
  name: 'cpl',
  register(app) {
    registerComplianceRoutes(app)
    registerPackRuleRoutes(app)
    registerGuardrailRoutes(app)
  },
  jobs: [computeSnapshotJob],
}

export { computeSnapshotJob }
export { packRules, type PackRule } from './pack-rules.js'
export { publicSnapshotSchemas } from './public-schemas.js'
export {
  acknowledgeDecision, evaluateGuardrails, latestDecisions, outstandingDecisions, PLAN_IN_SCOPE, restoreEvaluations,
  type Evaluation, type Outstanding,
} from './guardrails.js'
export { approveAcrossMarkets, decideAcrossMarkets, eligibleOverMarkets } from './sod.js'
