import type { Metadata } from 'next'
import { MorePage } from '../../../../features/portal/more'

export const metadata: Metadata = { title: 'More' }

export default function Page() {
  return <MorePage />
}
