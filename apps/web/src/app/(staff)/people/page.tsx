import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { PeopleList } from '../../../features/people/people-list'

export const metadata: Metadata = { title: 'People' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading participants" />}>
      <PeopleList />
    </Suspense>
  )
}
