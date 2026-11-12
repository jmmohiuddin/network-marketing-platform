import type { Metadata } from 'next'
import { ComplianceOverview } from '../../../features/data/compliance-overview'

export const metadata: Metadata = { title: 'Compliance overview' }

export default function CompliancePage() {
  return <ComplianceOverview />
}
