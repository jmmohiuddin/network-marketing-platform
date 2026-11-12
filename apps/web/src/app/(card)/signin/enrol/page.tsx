import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { MfaEnrolment } from '../../../../features/auth/mfa'

export const metadata: Metadata = { title: 'Set up authenticator app' }

export default function MfaEnrolmentPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading set-up" />}>
      <MfaEnrolment />
    </Suspense>
  )
}
