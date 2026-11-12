import type { Metadata } from 'next'
import { VendorUsersPage } from '../../../../features/admin/vendor/vendor-users-page'

export const metadata: Metadata = { title: 'Vendor users' }

export default function Page() {
  return <VendorUsersPage />
}
