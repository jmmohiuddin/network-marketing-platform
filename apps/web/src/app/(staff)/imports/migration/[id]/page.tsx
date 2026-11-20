import type { Metadata } from 'next'
import { NotAvailable } from '../../../../../components/states'
import { isUuid } from '../../../../../features/admin/format'
import { MigrationPage } from '../../../../../features/migration/migration-page'

export const metadata: Metadata = { title: 'Migration' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string }> }) {
  const { id } = await params
  return isUuid(id) ? <MigrationPage migrationId={id} /> : <NotAvailable />
}
