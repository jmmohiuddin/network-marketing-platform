import type { Metadata } from 'next'
import { NotAvailable } from '../../../../../../../../components/states'
import { isUuid } from '../../../../../../../../features/admin/format'
import { DisputePage } from '../../../../../../../../features/portal/dispute'

export const metadata: Metadata = { title: 'Dispute this line' }

export default async function Page({ params }: { readonly params: Promise<{ readonly runId: string; readonly lineId: string }> }) {
  const { runId, lineId } = await params
  if (!isUuid(runId) || !isUuid(lineId)) return <NotAvailable />
  return <DisputePage runId={runId} lineId={lineId} />
}
