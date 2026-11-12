import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoadingState } from '../../../../components/states'
import { UsersPage } from '../../../../features/admin/users/users-page'

export const metadata: Metadata = { title: 'Users and roles' }

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading users and roles" />}>
      <UsersPage />
    </Suspense>
  )
}
