import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { NewImportForm } from '../../../../features/data/new-import-form'

export const metadata: Metadata = { title: 'Upload export' }

export default function NewImportPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the upload form" />}>
      <NewImportForm />
    </Suspense>
  )
}
