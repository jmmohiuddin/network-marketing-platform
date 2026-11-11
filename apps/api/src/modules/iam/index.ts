import type { ApiModule } from '../../lib/module.js'
import { registerAuthRoutes } from './auth-routes.js'
import { registerGrantRoutes, registerRoleRoutes } from './grants-routes.js'
import { sendInvitationJob } from './invitations.js'
import { registerMeRoutes } from './me-routes.js'
import { registerMfaRoutes } from './mfa-routes.js'
import { registerUserRoutes } from './users-routes.js'

/** Identity and access (FR-IAM-001/002/003): sessions, MFA, me, users, roles, grants and approvals, invitation mail. */
export const iamModule: ApiModule = {
  name: 'iam',
  register(app) {
    registerAuthRoutes(app)
    registerMfaRoutes(app)
    registerMeRoutes(app)
    registerUserRoutes(app)
    registerRoleRoutes(app)
    registerGrantRoutes(app)
  },
  jobs: [sendInvitationJob],
}
