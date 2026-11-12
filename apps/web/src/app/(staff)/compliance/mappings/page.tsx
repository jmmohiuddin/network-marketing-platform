import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { MappingEditor } from '../../../../features/data/mapping-editor'

export const metadata: Metadata = { title: 'Import mapping' }

// The same screen as /imports/mappings, inside the Compliance section: approvers (mapping.approve) usually have
// no import.manage, so /imports is not in their navigation.
export default function ComplianceMappingPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the mapping" />}>
      <MappingEditor />
    </Suspense>
  )
}
