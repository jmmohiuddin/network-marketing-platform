import type { ApiModule } from '../../lib/module.js'
import { registerApiKeyRoutes } from './api-keys-routes.js'
import { registerAuthRoutes } from './auth-routes.js'
import { registerGrantRoutes, registerRoleRoutes } from './grants-routes.js'
import { sendInvitationJob } from './invitations.js'
import { registerMeRoutes } from './me-routes.js'
import { registerMfaRoutes } from './mfa-routes.js'
import { registerPortalAccountRoutes } from './portal-accounts.js'
import { registerRelatedPartyRoutes } from './related-parties.js'
import { sendSignInCodeJob } from './sign-in-codes.js'
import { registerUserRoutes } from './users-routes.js'
import { registerVendorUserRoutes } from './vendor-users-routes.js'

/**
 * Identity and access (FR-IAM-001/002/003/006): sessions, MFA, me, users, vendor users, roles, grants and approvals,
 * invitation mail, service accounts and API keys, related-party declarations (D-B4-11); distributor portal accounts,
 * sign-in (password, emailed code, Firebase) and re-authentication (FR-IAM-007).
 */
export const iamModule: ApiModule = {
  name: 'iam',
  register(app) {
    registerAuthRoutes(app)
    registerMfaRoutes(app)
    registerMeRoutes(app)
    registerUserRoutes(app)
    registerRelatedPartyRoutes(app)
    registerRoleRoutes(app)
    registerGrantRoutes(app)
    registerVendorUserRoutes(app)
    registerApiKeyRoutes(app)
    registerPortalAccountRoutes(app)
  },
  jobs: [sendInvitationJob, sendSignInCodeJob],
}

export { acceptInvitation, invitationLink } from './invitations.js'
export { bootstrapVendorUser, type BootstrapVendorUser } from './vendor-users.js'
export { assertSecondPerson, loggingSecondPersonRefusals, type SecondPersonStep } from './second-person.js'
export { apiKeyOrSession } from './api-key-auth.js'
export { API_SCOPES, type ApiScope } from './api-scopes.js'
export { googleFirebaseKeys } from './firebase.js'
