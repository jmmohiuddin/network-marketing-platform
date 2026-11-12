import type { Metadata } from 'next'
import { NewImportForm } from '../../../../features/data/new-import-form'
import '../../../../features/data/data.css'

export const metadata: Metadata = { title: 'Upload export' }

export default function NewImportPage() {
  return <NewImportForm />
}
