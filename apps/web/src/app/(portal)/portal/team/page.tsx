import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { ApiError } from '../../../../lib/api'
import { portalSession, portalTitle } from '../../../../features/portal/i18n/server'
import { TeamPage } from '../../../../features/portal/team'

export const generateMetadata = portalTitle('nav.team')

export default async function Page() {
  const session = await portalSession()
  return (
    <Suspense fallback={session instanceof ApiError ? null : <LoadingState label={session.words.t('team.loading')} />}>
      <TeamPage />
    </Suspense>
  )
}
