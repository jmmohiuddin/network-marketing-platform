import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState, NotAvailable } from '../../../../../components/states'
import { isUuid } from '../../../../../features/admin/format'
import { QualificationPage } from '../../../../../features/qualification/qualification-page'

export const metadata: Metadata = { title: 'Rank and qualification' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  // The id goes into API paths: anything but a UUID never reaches them.
  if (!isUuid(id)) return <NotAvailable />
  return (
    <Suspense fallback={<LoadingState label="Loading qualification" />}>
      <QualificationPage participantId={id} />
    </Suspense>
  )
}
