import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState, NotAvailable } from '../../../../../../../components/states'
import { isUuid } from '../../../../../../../features/admin/format'
import { RunReviewPage } from '../../../../../../../features/periods/review-page'

export const metadata: Metadata = { title: 'Run review' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string; readonly runId: string }> }) {
  const { id, runId } = await params
  // Both ids go into API paths: anything but a UUID never reaches them.
  if (!isUuid(id) || !isUuid(runId)) return <NotAvailable />
  return (
    <Suspense fallback={<LoadingState label="Loading the run" />}>
      <RunReviewPage periodId={id} runId={runId} />
    </Suspense>
  )
}
