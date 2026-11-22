import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { registerAccountRoutes } from './accounts.js'
import { registerAgreementRoutes } from './agreements.js'
import { DUPLICATE_CASE_TYPE } from './duplicate-case.js'
import { registerParticipantReadRoutes } from './participants.js'
import { registerParticipantTypeRoutes } from './participant-types.js'
import { registerParticipantWriteRoutes } from './participant-writes.js'

/**
 * Participants (PAR, FR-PAR-001/002/003/006): participant types with approval, participants with masked contact,
 * enrolment (positions, sponsor and placement through the GEN SQL contracts), agreement versions and acceptances,
 * hashed duplicate signals and the duplicate case type; account types and holders (FR-PAR-004).
 */
export const parModule: ApiModule = {
  name: 'par',
  register(app) {
    registerParticipantTypeRoutes(app)
    registerParticipantReadRoutes(app)
    registerParticipantWriteRoutes(app)
    registerAgreementRoutes(app)
    registerAccountRoutes(app)
  },
}

/** The case types PAR registers with CAS (modules/index.ts mounts createCasModule with them). */
export const parCaseTypes: readonly CaseTypeDefinition[] = [DUPLICATE_CASE_TYPE as CaseTypeDefinition]

export { callerScope, participantsWrite } from './access.js'
export { assertPositionsLimit } from './positions.js'
export { publicParticipantSchemas } from './schemas.js'
export { sqlCall } from './sql-errors.js'
