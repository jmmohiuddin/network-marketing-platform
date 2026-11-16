import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { MarketsPage } from '../../../../features/markets/markets-page'

export const metadata: Metadata = { title: 'Markets' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading markets" />}>
      <MarketsPage />
    </Suspense>
  )
}
