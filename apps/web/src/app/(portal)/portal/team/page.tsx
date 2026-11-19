import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { TeamPage } from '../../../../features/portal/team'

export const metadata: Metadata = { title: 'Team' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading your team" />}>
      <TeamPage />
    </Suspense>
  )
}
