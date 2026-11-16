import type { ApiModule } from '../../lib/module.js'
import { expireSupportSessionsJob } from './expiry.js'
import { registerSupportRoutes } from './routes.js'

/**
 * Vendor support sessions (FR-IAM-005, API-08): request, tenant decision, in-session read-only access
 * (registerSupportSessionAccess, installed by the app on every route), ending, auto-expiry, log.
 */
export const supportModule: ApiModule = {
  name: 'support',
  register(app) {
    registerSupportRoutes(app)
  },
  jobs: [expireSupportSessionsJob],
}

export { registerSupportSessionAccess, SUPPORT_SESSION_HEADER } from './access.js'
export { assertSameRequest, vendorIdempotency, type VendorIdempotency } from './vendor-idempotency.js'
export { inVendorThenTenant, lockTenant, type TenantRow } from './vendor-tx.js'
export { getSession as getSupportSession, scopePermission as supportScopePermission, type SupportSessionView } from './sessions.js'
