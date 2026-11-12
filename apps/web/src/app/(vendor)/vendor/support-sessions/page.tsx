import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import '../../../../features/admin/admin.css'
import { VendorSessionsPage } from '../../../../features/admin/vendor/sessions-page'

export const metadata: Metadata = { title: 'Support sessions' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading support sessions" />}>
      <VendorSessionsPage />
    </Suspense>
  )
}
