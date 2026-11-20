import { MyDataPage } from '../../../../../features/portal/my-data'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('my_data.title')

export default function Page() {
  return <MyDataPage />
}
