import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { CasesPage } from '../../../features/cases/cases-page'

export const metadata: Metadata = { title: 'Cases' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading cases" />}>
      <CasesPage />
    </Suspense>
  )
}
