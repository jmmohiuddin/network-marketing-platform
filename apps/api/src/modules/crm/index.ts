import type { ApiModule } from '../../lib/module.js'
import { registerServicingRoutes } from './servicing.js'

/**
 * Customer servicing (CRM, FR-CRM-001/002): the effective-dated servicer of each customer through the CRM SQL contracts
 * (crm_set_servicer). Reassignment on termination is SQL (crm_reassign_customers, called by gen_set_position_status).
 */
export const crmModule: ApiModule = {
  name: 'crm',
  register(app) {
    registerServicingRoutes(app)
  },
}

export { publicServicingSchemas } from './servicing.js'
