import type { ApiModule } from '../../lib/module.js'
import { sendFirstAdminInvitationJob } from './first-admin-invitation.js'
import { offboardingRequestedMailJob } from './offboarding.js'
import { registerOpsRoutes } from './routes.js'

/**
 * Vendor operations (FR-OPS-001, FR-TEN-001): the console's tenant list with job health and no business
 * data, provisioning with second-person approval, go-live. Every action is in the vendor log and the
 * tenant's log. Offboarding (FR-TEN-005): the vendor side of D-V1A-07.
 */
export const opsModule: ApiModule = {
  name: 'ops',
  register(app) {
    registerOpsRoutes(app)
  },
  jobs: [sendFirstAdminInvitationJob, offboardingRequestedMailJob],
}
