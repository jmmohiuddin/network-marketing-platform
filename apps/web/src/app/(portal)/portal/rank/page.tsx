import type { Metadata } from 'next'
import { RankPage } from '../../../../features/portal/rank'

export const metadata: Metadata = { title: 'Rank' }

export default function Page() {
  return <RankPage />
}
