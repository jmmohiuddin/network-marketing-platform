import type { Metadata } from 'next'
import { PayoutBatchesPage } from '../../../features/payouts/batches-page'

export const metadata: Metadata = { title: 'Payout batches' }

export default function Page() {
  return <PayoutBatchesPage />
}
