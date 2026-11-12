import type { Metadata } from 'next'
import { ComplianceOverview } from '../../../features/data/compliance-overview'
import '../../../features/data/data.css'

export const metadata: Metadata = { title: 'Compliance overview' }

export default function CompliancePage() {
  return <ComplianceOverview />
}
