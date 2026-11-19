import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { BatchPage } from '../../../../features/payouts/batch-page'

export const metadata: Metadata = { title: 'Payout batch' }

export default async function Page({ params }: { readonly params: Promise<{ readonly batchId: string }> }) {
  const { batchId } = await params
  return (
    <Suspense fallback={<LoadingState label="Loading the batch" />}>
      <BatchPage batchId={batchId} />
    </Suspense>
  )
}
