import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { SignInForm } from '../../../../features/auth/sign-in-form'
import { firebaseAuthDomain } from '../../../../lib/csp'

export const metadata: Metadata = { title: 'Sign in · Operations console' }

export default function VendorSignInPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading sign-in" />}>
      {/* Firebase only when this server allows it in the CSP: no config request otherwise (BUG-101). */}
      <SignInForm realm="vendor" firebase={firebaseAuthDomain(process.env.FIREBASE_AUTH_DOMAIN) !== null} />
    </Suspense>
  )
}
