import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { ImportsList } from '../../../features/data/imports-list'

export const metadata: Metadata = { title: 'Data imports' }

export default function ImportsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading imports" />}>
      <ImportsList />
    </Suspense>
  )
}
