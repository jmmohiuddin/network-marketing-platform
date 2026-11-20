import { isUuid } from '../../../../../../../features/admin/format'
import { PortalNotFound } from '../../../../../../../features/portal/not-found'
import { StatementPage } from '../../../../../../../features/portal/statement'
import { portalTitle } from '../../../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('explanation.title')

export default async function Page({ params }: { readonly params: Promise<{ readonly runId: string; readonly lineId: string }> }) {
  const { runId, lineId } = await params
  if (!isUuid(runId) || !isUuid(lineId)) return <PortalNotFound />
  return <StatementPage runId={runId} lineId={lineId} />
}
