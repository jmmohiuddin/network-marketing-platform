import type { Metadata } from 'next'
import '../../../features/admin/admin.css'
import { TenantsPage } from '../../../features/admin/vendor/tenants-page'

export const metadata: Metadata = { title: 'Tenants' }

export default function Page() {
  return <TenantsPage />
}
