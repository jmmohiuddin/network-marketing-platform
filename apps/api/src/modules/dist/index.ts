import type { ApiModule } from '../../lib/module.js'
import { deliverCron } from './deliver.js'
import { registerNotificationRoutes } from './routes.js'

export { renderNotification } from './templates.js'

/**
 * Participant notifications (DIST, FR-DIST-008, D-B5-14): the portal inbox, email preferences and email delivery. Rows
 * are written only by the notify_* SQL functions, inside the business transaction that causes them.
 */
export const distModule: ApiModule = {
  name: 'dist',
  register(app) {
    registerNotificationRoutes(app)
  },
  jobs: [deliverCron],
}
