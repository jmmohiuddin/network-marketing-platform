import type { Metadata } from 'next'
import { CardLayout } from '../components/card-layout'
import { NotAvailable } from '../components/states'

export const metadata: Metadata = { title: 'Not found or not available' }

/** Unknown URLs and notFound(): the same page as "no permission" (UX-03 §6). */
export default function NotFound() {
  return (
    <CardLayout>
      <NotAvailable plain />
    </CardLayout>
  )
}
