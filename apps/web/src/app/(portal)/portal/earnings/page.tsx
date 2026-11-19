import type { Metadata } from 'next'
import { EarningsPage } from '../../../../features/portal/earnings'

export const metadata: Metadata = { title: 'Earnings' }

export default function Page() {
  return <EarningsPage />
}
