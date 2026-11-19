import type { ApiModule } from '../../lib/module.js'
import { registerTaxProfileRoutes } from './routes.js'

/** Payee tax profiles (TAX, FR-TAX-001, D-B4-17): dated versions with the tax id sealed and shown masked. */
export const taxModule: ApiModule = {
  name: 'tax',
  register(app) {
    registerTaxProfileRoutes(app)
  },
}
