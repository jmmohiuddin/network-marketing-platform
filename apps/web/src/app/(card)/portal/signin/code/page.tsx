import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../../components/states'
import { PortalCode } from '../../../../../features/auth/portal-code'

export const metadata: Metadata = { title: 'Sign-in code' }

export default function PortalCodePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the code step" />}>
      <PortalCode />
    </Suspense>
  )
}
