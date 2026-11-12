import type { Metadata } from 'next'
import { BatchDetail } from '../../../../features/data/batch-detail'

export const metadata: Metadata = { title: 'Import batch' }

export default async function BatchPage({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return <BatchDetail batchId={id} />
}
