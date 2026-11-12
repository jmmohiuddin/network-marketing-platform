import type { Metadata } from 'next'
import { NewImportForm } from '../../../../features/data/new-import-form'

export const metadata: Metadata = { title: 'Upload export' }

export default function NewImportPage() {
  return <NewImportForm />
}
