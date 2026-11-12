import type { Metadata } from 'next'
import '../../../../../features/admin/admin.css'
import { TenantDetailPage } from '../../../../../features/admin/vendor/tenant-detail'

export const metadata: Metadata = { title: 'Tenant' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return <TenantDetailPage tenantId={id} />
}
