import type { Metadata } from 'next'
import { CaseDetailPage } from '../../../../features/cases/case-detail'

export const metadata: Metadata = { title: 'Case' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return <CaseDetailPage caseId={id} />
}
