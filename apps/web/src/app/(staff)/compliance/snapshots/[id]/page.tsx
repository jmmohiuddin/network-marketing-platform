import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../../components/states'
import { SnapshotReport } from '../../../../../features/data/snapshot-report'

export const metadata: Metadata = { title: 'Compliance snapshot' }

export default async function SnapshotPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<LoadingState label="Loading the snapshot" />}>
      <SnapshotReport snapshotId={id} />
    </Suspense>
  )
}
