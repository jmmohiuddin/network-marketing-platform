import type { Metadata } from 'next'
import { HomeRedirect } from '../../features/auth/home-redirect'

export const metadata: Metadata = { title: 'Home' }

export default function HomePage() {
  return <HomeRedirect />
}
