import type { Metadata } from 'next'
import { PortalHome } from '../../../features/portal/home'

export const metadata: Metadata = { title: 'Home' }

export default function Page() {
  return <PortalHome />
}
