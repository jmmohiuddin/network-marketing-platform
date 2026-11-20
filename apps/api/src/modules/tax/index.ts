import type { ApiModule } from '../../lib/module.js'
import { registerPortalFormRoutes } from './forms.js'
import { registerSelfTaxProfileRoutes, registerTaxProfileRoutes } from './routes.js'
import { registerTaxRuleRoutes } from './rules.js'
import { registerYearEndRoutes } from './year-end.js'

/** Payee tax profiles (TAX, FR-TAX-001, D-B4-17): dated versions with the tax id sealed and shown masked;
 * B5 adds the payee's own portal path (D-B5-13). B-MKT: the pack's tax rules and a run's withholding lines (FR-TAX-002),
 * year-end statements, their filing export and the payee's own forms (FR-TAX-003). */
export const taxModule: ApiModule = {
  name: 'tax',
  register(app) {
    registerTaxProfileRoutes(app)
    registerSelfTaxProfileRoutes(app)
    registerTaxRuleRoutes(app)
    registerYearEndRoutes(app)
    registerPortalFormRoutes(app)
  },
}
