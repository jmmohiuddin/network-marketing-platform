import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { PortalSignIn } from '../../../../features/auth/portal-sign-in'
import { firebaseAuthDomain } from '../../../../lib/csp'

export const metadata: Metadata = { title: 'Sign in' }

export default function PortalSignInPage() {
  // Same check as proxy.ts, which adds the Firebase sources on this auth page (BUG-101).
  const firebase = firebaseAuthDomain(process.env.FIREBASE_AUTH_DOMAIN) !== null
  return (
    <Suspense fallback={<LoadingState label="Loading sign-in" />}>
      <PortalSignIn firebase={firebase} />
    </Suspense>
  )
}
