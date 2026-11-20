import { MorePage } from '../../../../features/portal/more'
import { portalTitle } from '../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('nav.more')

export default function Page() {
  return <MorePage />
}
