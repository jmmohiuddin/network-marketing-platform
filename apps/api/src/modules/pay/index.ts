import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { BANK_DETAIL_CASE_TYPE, registerBankDetailRoutes } from './bank-details.js'
import { registerBatchRoutes } from './batch-routes.js'
import { batchDispatchJob, dispatchCron, sandboxAdapter, type PayoutAdapter } from './dispatch.js'
import { registerHoldRoutes } from './holds.js'
import { noticeJob } from './notices.js'
import { registerReconciliationRoutes } from './reconciliation-routes.js'
import { reviewReminderCron } from './reminders.js'
import { RETURNED_PAYMENT_CASE_TYPE } from './returned-case.js'
import { registerProviderRoutes } from './routes.js'
import { registerSelfBankDetailRoutes } from './self-service.js'

export interface PayModuleOptions {
  /** The payout adapter the dispatcher calls; only the in-process sandbox exists (tests wrap it). */
  readonly adapter?: PayoutAdapter
}

/**
 * Payments and payouts (PAY). B1: provider eligibility records (D-B1-12). B2: commerce connector records for INT.
 * B4 (sandbox only, no real money): adapters, payout batches with signed instructions and postings, the dispatcher,
 * bank files, settlement and returns, exceptions, holds, the dormant report, bank-detail changes and payee notices.
 * B5: payee self-service bank details (portal) and payout notices through notify_batch / notify_participant.
 */
export function createPayModule(options: PayModuleOptions = {}): ApiModule {
  const deps = { adapter: options.adapter ?? sandboxAdapter }
  return {
    name: 'pay',
    register(app) {
      registerProviderRoutes(app)
      registerBatchRoutes(app)
      registerReconciliationRoutes(app)
      registerHoldRoutes(app)
      registerBankDetailRoutes(app)
      registerSelfBankDetailRoutes(app)
    },
    jobs: [dispatchCron(deps), batchDispatchJob(deps), noticeJob, reviewReminderCron],
  }
}

export const payModule: ApiModule = createPayModule()

/** The case types PAY registers with CAS (modules/index.ts mounts createCasModule with them). */
export const payCaseTypes: readonly CaseTypeDefinition[] = [
  BANK_DETAIL_CASE_TYPE as CaseTypeDefinition, RETURNED_PAYMENT_CASE_TYPE as CaseTypeDefinition,
]

export { formatMinor } from './money.js'
export { recordedProviders, type ProviderKind, type RecordedProvider } from './providers.js'
export {
  connectorForWebhook, installConnector, listConnectors, markConnectorOk, rotateConnectorSecret, withdrawConnector,
  type CommerceProvider, type ConnectorView, type NewConnector, type WebhookConnector,
} from './connectors.js'
export { providerForWebhook, receiveProviderWebhook, type WebhookProvider } from './settlement.js'
