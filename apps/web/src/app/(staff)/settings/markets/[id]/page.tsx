import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../../components/states'
import { ChecklistPage } from '../../../../../features/markets/checklist-page'

export const metadata: Metadata = { title: 'Launch checklist' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<LoadingState label="Loading the launch checklist" />}>
      <ChecklistPage marketId={id} />
    </Suspense>
  )
}
