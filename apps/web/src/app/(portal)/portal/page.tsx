import { PortalHome } from '../../../features/portal/home'
import { portalTitle } from '../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('nav.home')

export default function Page() {
  return <PortalHome />
}
