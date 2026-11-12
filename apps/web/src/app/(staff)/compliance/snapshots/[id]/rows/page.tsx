import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../../../components/states'
import { FigureRows } from '../../../../../../features/data/figure-rows'

export const metadata: Metadata = { title: 'Figure rows' }

export default async function FigureRowsPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<LoadingState label="Loading the rows" />}>
      <FigureRows snapshotId={id} />
    </Suspense>
  )
}
