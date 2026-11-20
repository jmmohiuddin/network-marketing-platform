import { isUuid } from '../../../../../../../../features/admin/format'
import { DisputePage } from '../../../../../../../../features/portal/dispute'
import { PortalNotFound } from '../../../../../../../../features/portal/not-found'
import { portalTitle } from '../../../../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('dispute.title')

export default async function Page({ params }: { readonly params: Promise<{ readonly runId: string; readonly lineId: string }> }) {
  const { runId, lineId } = await params
  if (!isUuid(runId) || !isUuid(lineId)) return <PortalNotFound />
  return <DisputePage runId={runId} lineId={lineId} />
}
