import type { Metadata } from 'next'
import { NotAvailable } from '../../../../../../../components/states'
import { ChangePage } from '../../../../../../../features/plans/change-page'
import { versionNumber } from '../../../../../../../features/plans/format'

export const metadata: Metadata = { title: 'Plan change workflow' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string; readonly v: string }> }) {
  const { id, v } = await params
  const version = versionNumber(id, v)
  if (version === null) return <NotAvailable />
  return <ChangePage planId={id} version={version} />
}
