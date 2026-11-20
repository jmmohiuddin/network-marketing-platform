import type { Metadata } from 'next'
import { MigrationsList } from '../../../../features/migration/migrations-list'

export const metadata: Metadata = { title: 'Migrations' }

export default function MigrationsPage() {
  return <MigrationsList />
}
