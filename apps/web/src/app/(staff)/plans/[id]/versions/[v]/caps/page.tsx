import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState, NotAvailable } from '../../../../../../../components/states'
import { CapsPage } from '../../../../../../../features/plans/caps-page'
import { versionNumber } from '../../../../../../../features/plans/format'

export const metadata: Metadata = { title: 'Caps and pools' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string; readonly v: string }> }) {
  const { id, v } = await params
  const version = versionNumber(id, v)
  if (version === null) return <NotAvailable />
  return (
    <Suspense fallback={<LoadingState label="Loading caps and pools" />}>
      <CapsPage planId={id} version={version} />
    </Suspense>
  )
}
