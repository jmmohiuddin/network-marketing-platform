import type { Metadata } from 'next'
import { NotAvailable } from '../../../../../components/states'
import { isUuid } from '../../../../../features/admin/format'
import { CustomerPage } from '../../../../../features/portal/customers'

export const metadata: Metadata = { title: 'Customer' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  // The id goes into API paths: anything but a UUID never reaches them.
  if (!isUuid(id)) return <NotAvailable />
  return <CustomerPage customerId={id} />
}
