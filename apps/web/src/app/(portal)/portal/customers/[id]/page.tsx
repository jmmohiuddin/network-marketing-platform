import { isUuid } from '../../../../../features/admin/format'
import { CustomerPage } from '../../../../../features/portal/customers'
import { PortalNotFound } from '../../../../../features/portal/not-found'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('customers.customer')

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  // The id goes into API paths: anything but a UUID never reaches them.
  if (!isUuid(id)) return <PortalNotFound />
  return <CustomerPage customerId={id} />
}
