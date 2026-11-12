import type { Metadata } from 'next'
import '../../../../../features/admin/admin.css'
import { ProvisionTenantPage } from '../../../../../features/admin/vendor/provision-form'

export const metadata: Metadata = { title: 'Provision tenant' }

export default function Page() {
  return <ProvisionTenantPage />
}
