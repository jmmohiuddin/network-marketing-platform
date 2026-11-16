import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { SettingsPage } from '../../../features/admin/settings/settings-page'

export const metadata: Metadata = { title: 'Settings' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading settings" />}>
      <SettingsPage />
    </Suspense>
  )
}
