import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState, NotAvailable } from '../../../../../../../../components/states'
import { isUuid } from '../../../../../../../../features/admin/format'
import { versionNumber } from '../../../../../../../../features/plans/format'
import { SimulationPage } from '../../../../../../../../features/plans/simulation-page'

export const metadata: Metadata = { title: 'Simulation' }

export default async function Page({ params }: { readonly params: Promise<{ readonly id: string; readonly v: string; readonly simId: string }> }) {
  const { id, v, simId } = await params
  const version = versionNumber(id, v)
  if (version === null || !isUuid(simId)) return <NotAvailable />
  return (
    <Suspense fallback={<LoadingState label="Loading the simulation" />}>
      <SimulationPage planId={id} version={version} simulationId={simId} />
    </Suspense>
  )
}
