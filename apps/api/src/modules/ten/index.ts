import type { ApiModule } from '../../lib/module.js'
import { registerLaunchRoutes, registerMarketRoutes } from './market-routes.js'
import { registerSettingsRoutes } from './routes.js'

/**
 * Tenant configuration (TEN): versioned tenant settings (approved changes for the keys that need them, D-B2-08), markets,
 * brands, calendars and the market launch checklist. Other modules read them through this facade.
 */
export const tenModule: ApiModule = {
  name: 'ten',
  register(app) {
    registerSettingsRoutes(app)
    registerMarketRoutes(app)
    registerLaunchRoutes(app)
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
export { assertMarketLive, getMarket, marketName, type MarketState, type MarketView } from './markets.js'
export { CHECKLIST_ITEMS, type ChecklistItem } from './checklist.js'
export { inScope } from './scope.js'
export { approveOrRefuse, decideWithSod } from './sod.js'
