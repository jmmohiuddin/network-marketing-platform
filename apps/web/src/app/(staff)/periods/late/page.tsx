import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { LateQueuePage } from '../../../../features/orders/late-queue-page'

export const metadata: Metadata = { title: 'Late transactions' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the late-transaction queue" />}>
      <LateQueuePage />
    </Suspense>
  )
}
