import type { Metadata } from 'next'
import { PaymentDetailsPage } from '../../../../../features/portal/payment-details'

export const metadata: Metadata = { title: 'Payment details' }

export default function Page() {
  return <PaymentDetailsPage />
}
