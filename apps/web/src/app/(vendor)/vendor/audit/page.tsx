import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import '../../../../features/admin/admin.css'
import { VendorAuditPage } from '../../../../features/admin/audit/audit-page'

export const metadata: Metadata = { title: 'Vendor audit log' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the vendor audit log" />}>
      <VendorAuditPage />
    </Suspense>
  )
}
