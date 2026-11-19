import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { ReconciliationPage } from '../../../../features/payouts/reconciliation-page'

export const metadata: Metadata = { title: 'Payout reconciliation' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading payout reconciliation" />}>
      <ReconciliationPage />
    </Suspense>
  )
}
