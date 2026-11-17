import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { DuplicatesPage } from '../../../../features/cases/duplicates-page'

export const metadata: Metadata = { title: 'Duplicate investigation' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading duplicate reviews" />}>
      <DuplicatesPage />
    </Suspense>
  )
}
