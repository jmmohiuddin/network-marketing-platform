import { isUuid } from '../../../../../features/admin/format'
import { PortalNotFound } from '../../../../../features/portal/not-found'
import { StatementPage } from '../../../../../features/portal/statement'
import { portalTitle } from '../../../../../features/portal/i18n/server'

export const generateMetadata = portalTitle('statement.page')

export default async function Page({ params }: { readonly params: Promise<{ readonly runId: string }> }) {
  const { runId } = await params
  if (!isUuid(runId)) return <PortalNotFound />
  return <StatementPage runId={runId} />
}
