import type { ApiModule } from '../../lib/module.js'
import type { CaseTypeDefinition } from '../cas/index.js'
import { registerLedgerRoutes } from './routes.js'
import { WRITE_OFF_CASE_TYPE } from './write-off.js'

/**
 * Obligations ledger (LED, FR-FIN-001..005, PLAN B4 D-B4-01): derived balances, receivables, GL mappings and journal
 * exports, and the write-off case type. Entries are written only through the SQL contracts (ledger_post, led_post_run):
 * there is no human posting route. Obligations of the tenant, never funds.
 */
export const ledModule: ApiModule = {
  name: 'led',
  register(app) {
    registerLedgerRoutes(app)
  },
}

export const ledCaseTypes: readonly CaseTypeDefinition[] = [WRITE_OFF_CASE_TYPE as CaseTypeDefinition]
