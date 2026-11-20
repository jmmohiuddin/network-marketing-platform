import { NotificationsPage } from '../../../../../features/portal/notifications'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('notifications.title')

export default function Page() {
  return <NotificationsPage />
}
