import type { Metadata } from 'next'
import '../../../../features/admin/admin.css'
import { VendorUsersPage } from '../../../../features/admin/vendor/vendor-users-page'

export const metadata: Metadata = { title: 'Vendor users' }

export default function Page() {
  return <VendorUsersPage />
}
