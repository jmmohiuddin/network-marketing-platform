import type { ApiModule } from '../../lib/module.js'
import { registerRptRoutes } from './routes.js'

/**
 * Reporting (RPT, FR-RPT-001/002): role dashboards computed on read from committed data, with the reporting catalogue
 * in meta.definitions, and saved views of the orders and ledger entries lists.
 */
export const rptModule: ApiModule = {
  name: 'rpt',
  register: registerRptRoutes,
}
