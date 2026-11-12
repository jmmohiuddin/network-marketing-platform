import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { SignInForm } from '../../../../features/auth/sign-in-form'

export const metadata: Metadata = { title: 'Sign in · Operations console' }

export default function VendorSignInPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading sign-in" />}>
      <SignInForm realm="vendor" />
    </Suspense>
  )
}
