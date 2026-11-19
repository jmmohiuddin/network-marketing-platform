import type { Metadata } from 'next'
import { PrivacyRequestPage } from '../../../../features/privacy/privacy-detail'

export const metadata: Metadata = { title: 'Privacy request' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return <PrivacyRequestPage requestId={id} />
}
