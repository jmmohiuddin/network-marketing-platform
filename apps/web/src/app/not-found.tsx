import type { Metadata } from 'next'
import { NotAvailable } from '../components/states'

export const metadata: Metadata = { title: 'Not found or not available' }

/** Unknown URLs and notFound(): the same page as "no permission" (UX-03 §6). */
export default function NotFound() {
  return (
    <main className="card-page">
      <div className="card">
        <NotAvailable />
      </div>
    </main>
  )
}
