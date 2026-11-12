import type { Metadata } from 'next'
import { SnapshotsList } from '../../../../features/data/snapshots-list'

export const metadata: Metadata = { title: 'Compliance snapshots' }

export default function SnapshotsPage() {
  return <SnapshotsList />
}
