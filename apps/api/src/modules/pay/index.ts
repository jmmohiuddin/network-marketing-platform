import type { ApiModule } from '../../lib/module.js'
import { registerProviderRoutes } from './routes.js'

/**
 * Payments and payouts (PAY). B1: provider eligibility records only (D-B1-12); adapters arrive in B4 (sandbox only). B2:
 * commerce connector records (kind commerce, D-B2-14) for INT.
 */
export const payModule: ApiModule = {
  name: 'pay',
  register(app) {
    registerProviderRoutes(app)
  },
}

export { recordedProviders, type ProviderKind, type RecordedProvider } from './providers.js'
export {
  connectorForWebhook, installConnector, listConnectors, markConnectorOk, rotateConnectorSecret, withdrawConnector,
  type CommerceProvider, type ConnectorView, type NewConnector, type WebhookConnector,
} from './connectors.js'
