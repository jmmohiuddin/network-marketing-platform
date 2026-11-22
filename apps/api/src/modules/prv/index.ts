import { z } from 'zod'
import { requireRealm } from '../../lib/auth.js'
import { envelope, parse } from '../../lib/http.js'
import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { readBreachContactsAsVendor } from './breach-contacts.js'
import { deadlinesCron, sendOutcomeJob } from './jobs.js'
import { registerLegalHoldRoutes } from './legal-holds.js'
import { registerPortalRoutes } from './portal-routes.js'
import { PRIVACY_CASE_TYPE } from './privacy-case.js'
import { setPrvConfig } from './requests.js'
import { registerRetentionRoutes, retentionApplyCron } from './retention.js'
import { registerStaffRoutes } from './staff-routes.js'

const idParams = z.object({ id: z.uuid() })

/**
 * Privacy: data-subject requests through the portal, the public form and staff, with their system privacy case, access
 * and portability exports, correction and erasure (FR-PRV-001/002, D-B5-16..19); breach-notification contacts
 * (FR-PRV-004): tenant admins edit them as tenant setting privacy.breach_contacts (ten module), vendor operations read
 * them here, other modules gate go-live and the first data load with assertBreachContactRecorded. Retention schedules,
 * legal holds and the daily retention cron (FR-PRV-003, D-V1A-08).
 */
export const prvModule: ApiModule = {
  name: 'prv',
  register(app) {
    setPrvConfig(app.config)
    registerStaffRoutes(app)
    registerPortalRoutes(app)
    registerRetentionRoutes(app)
    registerLegalHoldRoutes(app)
    app.get('/v1/tenants/:id/breach-contacts', { preHandler: [requireRealm('vendor')] }, async (request) => {
      const { id } = parse(idParams, request.params)
      return envelope({ contacts: await readBreachContactsAsVendor(request, id) })
    })
  },
  jobs: [sendOutcomeJob, deadlinesCron, retentionApplyCron],
}

/** The case types PRV registers with CAS (modules/index.ts mounts createCasModule with them). */
export const prvCaseTypes: readonly CaseTypeDefinition[] = [PRIVACY_CASE_TYPE as CaseTypeDefinition]

export { assertBreachContactRecorded, breachContacts, type BreachContacts } from './breach-contacts.js'
