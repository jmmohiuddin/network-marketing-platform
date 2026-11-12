import type { ApiModule } from '../../lib/module.js'
import { registerMarketRoutes, registerSettingsRoutes } from './routes.js'

/** Tenant configuration (TEN): versioned tenant settings and the market list. Other modules read them through this facade. */
export const tenModule: ApiModule = {
  name: 'ten',
  register(app) {
    registerSettingsRoutes(app)
    registerMarketRoutes(app)
  },
}

export {
  getEffectiveSettings,
  getSetting,
  getSettingsVersion,
  SETTINGS,
  type EffectiveSettings,
  type SettingKey,
  type SettingValue,
  type SettingValues,
} from './settings.js'
export { marketName } from './markets.js'
