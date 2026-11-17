import type { ApiModule } from '../../lib/module.js'
import { registerConnectorRoutes } from './connector-routes.js'
import { dispatchJob } from './dispatch.js'
import { registerIntRoutes } from './routes.js'
import { httpsTransport, systemResolver, type WebhookResolver, type WebhookTransport } from './transport.js'

export interface IntModuleOptions {
  /** Sends one webhook POST; defaults to node https pinned to the vetted address. */
  readonly transport?: WebhookTransport
  /** Resolves an endpoint host; defaults to the system resolver (dns.lookup, all addresses). */
  readonly resolver?: WebhookResolver
}

/**
 * Integrations (INT, FR-INT-001/002, FR-ORD-002): the public OpenAPI document, webhook endpoints, the dispatcher job
 * that turns outbox events into signed, SSRF-safe webhook deliveries with retries and dead letters, inbound commerce
 * connectors (Shopify, WooCommerce) and sync health.
 */
export function createIntModule(options: IntModuleOptions = {}): ApiModule {
  const deps = { transport: options.transport ?? httpsTransport(), resolver: options.resolver ?? systemResolver }
  return {
    name: 'int',
    register(app) {
      registerIntRoutes(app)
      registerConnectorRoutes(app)
    },
    jobs: [dispatchJob(deps)],
  }
}

export const intModule: ApiModule = createIntModule()

export { WEBHOOK_TOPICS, type WebhookTopic } from './topics.js'
export type { WebhookResolver, WebhookTransport } from './transport.js'
