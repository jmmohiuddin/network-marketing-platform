import type { ApiModule } from '../../lib/module.js'
import { registerProviderRoutes } from './routes.js'

/** Payments and payouts (PAY). B1: provider eligibility records only (D-B1-12); adapters arrive in B4 (sandbox only). */
export const payModule: ApiModule = {
  name: 'pay',
  register(app) {
    registerProviderRoutes(app)
  },
}

export { recordedProviders, type ProviderKind, type RecordedProvider } from './providers.js'
