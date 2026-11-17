import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState, NotAvailable } from '../../../../../../components/states'
import { versionNumber } from '../../../../../../features/plans/format'
import { VersionPage } from '../../../../../../features/plans/version-page'

export const metadata: Metadata = { title: 'Plan version' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string; readonly v: string }> }) {
  const { id, v } = await params
  const version = versionNumber(id, v)
  if (version === null) return <NotAvailable />
  return (
    <Suspense fallback={<LoadingState label="Loading the plan version" />}>
      <VersionPage planId={id} version={version} />
    </Suspense>
  )
}
