import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { AuditPage } from '../../../../features/admin/audit/audit-page'

export const metadata: Metadata = { title: 'Audit log' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading the audit log" />}>
      <AuditPage />
    </Suspense>
  )
}
