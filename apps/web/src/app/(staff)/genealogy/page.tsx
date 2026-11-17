import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { GenealogyExplorer } from '../../../features/genealogy/explorer'

export const metadata: Metadata = { title: 'Genealogy' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the genealogy" />}>
      <GenealogyExplorer />
    </Suspense>
  )
}
