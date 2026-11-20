import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { computeSnapshotJob } from './compute.js'
import { GRIEVANCE_CASE_TYPE } from './grievance-case.js'
import { grievanceEscalationJob } from './grievance-escalation.js'
import { registerGuardrailRoutes } from './guardrail-routes.js'
import { registerRegisterRoutes } from './register-routes.js'
import { registerComplianceRoutes, registerPackRuleRoutes } from './routes.js'

/**
 * Compliance analytics (CPL, FR-CPL-001..006, 012): report snapshots computed by @nmp/compliance from the loaded
 * cpl_fact_* rows, stored figures, drill-down to the rows behind each figure, market-pack rules with their basis.
 * Snapshot reads are open to API keys with scope compliance:read. Plan guardrails (FR-CPL-007/008): decisions over plan
 * versions, evaluated by PLN through this facade, listed and overridden here. Market-pack registers (FR-CPL-013): the
 * grievance case type with its escalation cron, the grievance and delisted-seller registers.
 */
export const cplModule: ApiModule = {
  name: 'cpl',
  register(app) {
    registerComplianceRoutes(app)
    registerPackRuleRoutes(app)
    registerGuardrailRoutes(app)
    registerRegisterRoutes(app)
  },
  jobs: [computeSnapshotJob, grievanceEscalationJob],
}

/** The case types CPL registers with CAS (modules/index.ts caseTypes). */
export const cplCaseTypes: readonly CaseTypeDefinition[] = [GRIEVANCE_CASE_TYPE as CaseTypeDefinition]

export { computeSnapshotJob, grievanceEscalationJob }
export { packRules, type PackRule } from './pack-rules.js'
export { publicSnapshotSchemas } from './public-schemas.js'
export {
  acknowledgeDecision, evaluateGuardrails, latestDecisions, outstandingDecisions, PLAN_IN_SCOPE, restoreEvaluations,
  type Evaluation, type Outstanding,
} from './guardrails.js'
export { approveAcrossMarkets, decideAcrossMarkets, eligibleOverMarkets } from './sod.js'
