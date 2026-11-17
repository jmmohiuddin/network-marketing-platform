import type { ApiModule } from '../../lib/module.js'
import { registerCaseRoutes } from './routes.js'
import { caseTypeRegistry, mountCaseTypes, type CaseTypeDefinition } from './types.js'

/**
 * Case framework (CAS, FR-CAS-001, API-30): one case model, state machine, evidence, separation-of-duties decisions
 * and immutable history for every registered case type. Types arrive with their subjects (D-B1-13); modules/index.ts
 * mounts it with the B2 types.
 */
export function createCasModule(options: { types: readonly CaseTypeDefinition[] }): ApiModule {
  return {
    name: 'cas',
    register(app) {
      const registry = caseTypeRegistry(options.types)
      mountCaseTypes(app, registry)
      registerCaseRoutes(app, registry)
    },
  }
}

export { canReadCase, casePermissions, holdsFor } from './access.js'
export type { NewCase } from './cases.js'
export { openSystemCase } from './system-cases.js'
export {
  CASE_TYPES, caseTypesOf, type CaseRecord, type CaseState, type CaseType, type CaseTypeDefinition, type CaseTypePermissions,
  type CaseTypeRegistry,
} from './types.js'
