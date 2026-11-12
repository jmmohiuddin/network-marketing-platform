import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { VendorAccessPage } from '../../../../features/admin/vendor-access/vendor-access-page'

export const metadata: Metadata = { title: 'Vendor access' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading vendor access" />}>
      <VendorAccessPage />
    </Suspense>
  )
}
