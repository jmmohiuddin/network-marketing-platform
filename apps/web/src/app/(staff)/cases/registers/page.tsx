import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { RegistersPage } from '../../../../features/cases/registers-page'

export const metadata: Metadata = { title: 'Registers' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the registers" />}>
      <RegistersPage />
    </Suspense>
  )
}
