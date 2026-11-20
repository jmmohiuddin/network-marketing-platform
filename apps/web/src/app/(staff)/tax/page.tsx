import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { TaxPage } from '../../../features/tax/tax-page'

export const metadata: Metadata = { title: 'Tax and year-end statements' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading tax configuration" />}>
      <TaxPage />
    </Suspense>
  )
}
