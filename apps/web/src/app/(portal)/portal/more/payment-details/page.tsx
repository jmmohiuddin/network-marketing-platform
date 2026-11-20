import { PaymentDetailsPage } from '../../../../../features/portal/payment-details'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('payment.title')

export default function Page() {
  return <PaymentDetailsPage />
}
