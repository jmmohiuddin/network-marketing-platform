import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { MfaVerification } from '../../../../features/auth/mfa'

export const metadata: Metadata = { title: 'Verification code' }

export default function MfaVerificationPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading verification" />}>
      <MfaVerification />
    </Suspense>
  )
}
