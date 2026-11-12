import type { Metadata } from 'next'
import '../../../features/admin/admin.css'
import { SettingsPage } from '../../../features/admin/settings/settings-page'

export const metadata: Metadata = { title: 'Settings' }

export default function Page() {
  return <SettingsPage />
}
