import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { MappingEditor } from '../../../../features/data/mapping-editor'
import '../../../../features/data/data.css'

export const metadata: Metadata = { title: 'Import mapping' }

export default function ImportMappingPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the mapping" />}>
      <MappingEditor />
    </Suspense>
  )
}
