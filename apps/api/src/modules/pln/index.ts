import type { ApiModule } from '../../lib/module.js'
import { registerGoldenRoutes } from './goldens.js'
import { activateVersionsJob, registerLifecycleRoutes } from './lifecycle.js'
import { registerPlanRoutes } from './plans.js'
import { registerVersionRoutes } from './versions.js'

/**
 * Compensation plans (PLN, FR-PLN-001..006): plans over markets and calendars, versions authored as engine rule rows,
 * validated and compiled by @nmp/engine at every draft save, golden datasets, guardrail decisions (through CPL), the
 * submit -> approve -> schedule lifecycle and the activation cron. Other modules read plans only through the SQL
 * contracts (plan_version.compiled, plan_* functions); nothing here is imported by them.
 */
export const plnModule: ApiModule = {
  name: 'pln',
  register(app) {
    registerPlanRoutes(app)
    registerVersionRoutes(app)
    registerLifecycleRoutes(app)
    registerGoldenRoutes(app)
  },
  jobs: [activateVersionsJob],
}
