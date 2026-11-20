import { CustomersPage } from '../../../../features/portal/customers'
import { portalTitle } from '../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('nav.customers')

export default function Page() {
  return <CustomersPage />
}
