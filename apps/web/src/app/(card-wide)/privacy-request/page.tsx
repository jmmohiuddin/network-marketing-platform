import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { PublicRequestForm } from '../../../features/privacy/public-request-form'

export const metadata: Metadata = { title: 'Privacy request' }

export default function PrivacyRequestPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the request form" />}>
      <PublicRequestForm />
    </Suspense>
  )
}
