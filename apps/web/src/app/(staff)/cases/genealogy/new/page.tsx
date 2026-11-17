import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../../components/states'
import { GenealogyCasePage } from '../../../../../features/cases/genealogy-case-page'

export const metadata: Metadata = { title: 'New genealogy case' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the case form" />}>
      <GenealogyCasePage />
    </Suspense>
  )
}
