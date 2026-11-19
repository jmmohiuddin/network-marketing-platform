import type { Metadata } from 'next'
import { CustomersPage } from '../../../../features/portal/customers'

export const metadata: Metadata = { title: 'Customers' }

export default function Page() {
  return <CustomersPage />
}
