import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { LedgerPage } from '../../../features/ledger/ledger-page'

export const metadata: Metadata = { title: 'Ledger and exports' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the ledger" />}>
      <LedgerPage />
    </Suspense>
  )
}
