import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../components/states'
import { OrdersPage } from '../../../features/orders/orders-page'

export const metadata: Metadata = { title: 'Orders' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading orders" />}>
      <OrdersPage />
    </Suspense>
  )
}
