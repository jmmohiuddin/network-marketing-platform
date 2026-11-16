import type { ApiModule } from '../../lib/module.js'
import { registerCaseRoutes } from './routes.js'
import { caseTypeRegistry, mountCaseTypes, type CaseTypeDefinition } from './types.js'

/**
 * Case framework (CAS, FR-CAS-001, API-30): one case model, state machine, evidence, separation-of-duties decisions
 * and immutable history for every registered case type. Types arrive with their subjects (D-B1-13).
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

/** No case type is enabled in B1, so this module is not in defaultModules (D-B1-13); B2 mounts it with its first types. */
export const casModule: ApiModule = createCasModule({ types: [] })

export { canReadCase, casePermissions, holdsFor } from './access.js'
export {
  CASE_TYPES, caseTypesOf, type CaseRecord, type CaseState, type CaseType, type CaseTypeDefinition, type CaseTypePermissions,
  type CaseTypeRegistry,
} from './types.js'
