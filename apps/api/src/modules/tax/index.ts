import type { ApiModule } from '../../lib/module.js'
import { registerSelfTaxProfileRoutes, registerTaxProfileRoutes } from './routes.js'

/** Payee tax profiles (TAX, FR-TAX-001, D-B4-17): dated versions with the tax id sealed and shown masked;
 * B5 adds the payee's own portal path (D-B5-13). */
export const taxModule: ApiModule = {
  name: 'tax',
  register(app) {
    registerTaxProfileRoutes(app)
    registerSelfTaxProfileRoutes(app)
  },
}
