import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { SignInForm } from '../../../features/auth/sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

export default function SignInPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading sign-in" />}>
      <SignInForm realm="tenant" />
    </Suspense>
  )
}
