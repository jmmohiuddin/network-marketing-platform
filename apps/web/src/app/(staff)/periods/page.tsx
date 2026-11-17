import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { PeriodsPage } from '../../../features/periods/periods-page'

export const metadata: Metadata = { title: 'Periods and runs' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading periods and runs" />}>
      <PeriodsPage />
    </Suspense>
  )
}
