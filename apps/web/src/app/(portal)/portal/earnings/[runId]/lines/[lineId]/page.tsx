import type { Metadata } from 'next'
import { NotAvailable } from '../../../../../../../components/states'
import { isUuid } from '../../../../../../../features/admin/format'
import { StatementPage } from '../../../../../../../features/portal/statement'

export const metadata: Metadata = { title: 'Line explanation' }

export default async function Page({ params }: { readonly params: Promise<{ readonly runId: string; readonly lineId: string }> }) {
  const { runId, lineId } = await params
  if (!isUuid(runId) || !isUuid(lineId)) return <NotAvailable />
  return <StatementPage runId={runId} lineId={lineId} />
}
