import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { creditExpiryCron } from './credit-expiry.js'
import { registerCreditTypeRoutes } from './credit-types.js'
import { registerCreditRoutes } from './credits.js'
import { registerFxRoutes } from './fx-rates.js'
import { registerLedgerRoutes } from './routes.js'
import { WRITE_OFF_CASE_TYPE } from './write-off.js'

export { createJournalExport, unmappedAccountTypes } from './exports.js'
export { lockLedger } from './ledger.js'

/**
 * Obligations ledger (LED, FR-FIN-001..005, PLAN B4 D-B4-01): derived balances, receivables, GL mappings and journal
 * exports, and the write-off case type. Entries are written only through the SQL contracts (ledger_post, led_post_run):
 * there is no human posting route. Obligations of the tenant, never funds. V1-A: non-cash credits (types, balances,
 * lots, redemptions, the daily expiry) and FX rate batches approved by a second person (FR-FIN-006/007).
 */
export const ledModule: ApiModule = {
  name: 'led',
  register(app) {
    registerLedgerRoutes(app)
    registerCreditTypeRoutes(app)
    registerCreditRoutes(app)
    registerFxRoutes(app)
  },
  jobs: [creditExpiryCron],
}

export const ledCaseTypes: readonly CaseTypeDefinition[] = [WRITE_OFF_CASE_TYPE as CaseTypeDefinition]
