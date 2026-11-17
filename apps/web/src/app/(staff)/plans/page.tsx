import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { PlansList } from '../../../features/plans/plans-list'

export const metadata: Metadata = { title: 'Plans' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading plans" />}>
      <PlansList />
    </Suspense>
  )
}
