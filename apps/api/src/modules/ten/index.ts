import type { ApiModule } from '../../lib/module.js'
import { registerSettingsRoutes } from './routes.js'

/** Tenant configuration (TEN): versioned tenant settings. Other modules read settings through this facade. */
export const tenModule: ApiModule = {
  name: 'ten',
  register(app) {
    registerSettingsRoutes(app)
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
