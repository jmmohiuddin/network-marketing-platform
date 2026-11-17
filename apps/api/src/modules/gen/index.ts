import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { genealogyChangeType, genealogyCorrectionType } from './genealogy-cases.js'
import { registerPositionRoutes } from './position-routes.js'
import { pathsRebuildJob } from './rebuild.js'
import { transferType } from './transfer-case.js'
import { registerTreeRoutes } from './tree-routes.js'

/**
 * Genealogy (GEN, FR-GEN-001..009, FR-PAR-005): positions and their status lifecycle, the bitemporal tree read as of a
 * date and as known at a time, the downline visibility policy, and the path read model rebuilt by a system job.
 * Structural writes go through the shared SQL contracts (PLAN B2 4.2).
 */
export const genModule: ApiModule = {
  name: 'gen',
  register(app) {
    registerTreeRoutes(app)
    registerPositionRoutes(app)
  },
  jobs: [pathsRebuildJob],
}

/** The case types GEN owns (PLAN B2 2.4), mounted by createCasModule. */
export const genCaseTypes = [genealogyChangeType, genealogyCorrectionType, transferType] as readonly CaseTypeDefinition[]

export { REBUILD_JOB_NAME } from './rebuild.js'
