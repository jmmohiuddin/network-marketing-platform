import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { ParticipantRecord } from '../../../../features/people/participant-record'

export const metadata: Metadata = { title: 'Participant record' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return (
    <Suspense fallback={<LoadingState label="Loading the participant" />}>
      <ParticipantRecord participantId={id} />
    </Suspense>
  )
}
