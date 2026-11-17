import type { Metadata } from 'next'
import { OrderPage } from '../../../../features/orders/order-inspector'

export const metadata: Metadata = { title: 'Order' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return <OrderPage orderId={id} />
}
