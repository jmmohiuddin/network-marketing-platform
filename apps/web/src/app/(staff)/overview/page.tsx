import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { OverviewPage } from '../../../features/overview/overview-page'

export const metadata: Metadata = { title: 'Executive overview' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the overview" />}>
      <OverviewPage />
    </Suspense>
  )
}
