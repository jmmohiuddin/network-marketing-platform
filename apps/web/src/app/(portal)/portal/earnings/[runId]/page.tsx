import type { Metadata } from 'next'
import { NotAvailable } from '../../../../../components/states'
import { isUuid } from '../../../../../features/admin/format'
import { StatementPage } from '../../../../../features/portal/statement'

export const metadata: Metadata = { title: 'Statement' }

export default async function Page({ params }: { readonly params: Promise<{ readonly runId: string }> }) {
  const { runId } = await params
  if (!isUuid(runId)) return <NotAvailable />
  return <StatementPage runId={runId} />
}
