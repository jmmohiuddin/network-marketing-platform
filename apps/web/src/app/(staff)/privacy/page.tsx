import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { PrivacyRequestsPage } from '../../../features/privacy/privacy-list'

export const metadata: Metadata = { title: 'Privacy requests' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading privacy requests" />}>
      <PrivacyRequestsPage />
    </Suspense>
  )
}
