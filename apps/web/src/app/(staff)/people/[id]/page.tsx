import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState, NotAvailable } from '../../../../components/states'
import { isUuid } from '../../../../features/admin/format'
import { ParticipantRecord } from '../../../../features/people/participant-record'

export const metadata: Metadata = { title: 'Participant record' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  // The id goes into API paths: anything but a UUID (e.g. "..%2Fusers") never reaches them.
  if (!isUuid(id)) return <NotAvailable />
  return (
    <Suspense fallback={<LoadingState label="Loading the participant" />}>
      <ParticipantRecord participantId={id} />
    </Suspense>
  )
}
