'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { ConfirmDialog } from '../../../components/dialog'
import { PageHeader } from '../../../components/page-header'
import { StatusChip } from '../../../components/status-chip'
import { Table, type TableColumn } from '../../../components/table'
import { useToast } from '../../../components/toast'
import { countLabel } from '../../../lib/format'
import { isNotAvailable } from '../../../lib/messages'
import { useSession } from '../../../lib/session'
import { formatDateTime, personLabel } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList } from '../resource'
import type { VendorUser } from '../types'
import { InviteDialog } from '../users/invite-dialog'
import { ConsoleNav } from './console-nav'

const VENDOR_USERS_PATH = '/v1/vendor-users'

type UserAction = { readonly kind: 'invite' } | { readonly kind: 'resend' | 'deactivate'; readonly user: VendorUser }

/**
 * Vendor users of the operations console (BUG-011, FR-OPS-001): GET/POST /v1/vendor-users, re-invite, deactivate.
 * Two-person tenant provisioning (FR-TEN-001) needs a second vendor user, invited here. Inviting and deactivating
 * ask for a code from the authenticator app (the API asks, ApiProvider prompts).
 */
export function VendorUsersPage() {
  const { me } = useSession()
  const api = useApi()
  const toast = useToast()
  const users = usePagedList<VendorUser>(VENDOR_USERS_PATH)
  const [action, setAction] = useState<UserAction | null>(null)
  const close = () => setAction(null)
  const done = () => {
    setAction(null)
    users.reload()
  }
  if (isNotAvailable(users.error)) return <><ConsoleNav /><LoadFailure error={users.error} onRetry={users.reload} /></>
  const columns: readonly TableColumn<VendorUser>[] = [
    { key: 'user', header: 'User', cell: (user) => (user.id === me.user.id ? `${personLabel(user)} · you` : personLabel(user)) },
    { key: 'mfa', header: 'Authenticator app', cell: (user) => (user.mfa_enrolled ? 'Set up' : 'Not set up') },
    { key: 'last', header: 'Last sign-in', cell: (user) => (user.last_sign_in_at === null ? 'Never' : formatDateTime(user.last_sign_in_at)) },
    { key: 'state', header: 'State', cell: (user) => <StatusChip state={user.state} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) => (user.state === 'deactivated' ? null : (
        <div className="admin-row-actions">
          {user.state === 'invited' && (
            <Button variant="tertiary" aria-label={`Resend invitation to ${user.email}`} onClick={() => setAction({ kind: 'resend', user })}>Resend invitation</Button>
          )}
          <Button variant="destructive" aria-label={`Deactivate ${user.email}`} onClick={() => setAction({ kind: 'deactivate', user })}>Deactivate</Button>
        </div>
      )),
    },
  ]
  return (
    <>
      <ConsoleNav />
      <div className="admin-stack">
        <PageHeader
          title="Vendor users"
          summary="People who operate this console. A tenant one vendor user provisions is approved by another, so keep at least two active."
          actions={<Button variant="primary" onClick={() => setAction({ kind: 'invite' })}>Invite vendor user</Button>}
        />
        <Table
          caption={users.loading ? 'Vendor users' : `${countLabel(users.rows.length, 'vendor user')} on this page`}
          columns={columns}
          rows={users.rows}
          rowKey={(user) => user.id}
          loading={users.loading}
          error={tableError(users)}
          empty={{ title: 'No vendor users.' }}
          pagination={users.pagination}
        />
      </div>
      {action?.kind === 'invite' && (
        <InviteDialog
          endpoint={VENDOR_USERS_PATH}
          title="Invite vendor user"
          intro="The person gets an email with a link to choose a password, then sets up an authenticator app at first sign-in. You will be asked for a code from your authenticator app."
          onClose={close}
          onInvited={done}
        />
      )}
      <ConfirmDialog
        open={action?.kind === 'resend'}
        title="Resend invitation"
        consequence={action?.kind === 'resend' ? `${action.user.email} gets a new link by email. The earlier link stops working.` : ''}
        confirmLabel="Resend invitation"
        onCancel={close}
        onConfirm={async () => {
          if (action?.kind !== 'resend') return
          await api.post(`${VENDOR_USERS_PATH}/${action.user.id}/invitation`)
          toast({ message: `A new invitation was sent to ${action.user.email}.` })
          done()
        }}
      />
      <ConfirmDialog
        open={action?.kind === 'deactivate'}
        title="Deactivate vendor user"
        consequence={action?.kind === 'deactivate'
          ? `${action.user.email} is signed out at once and can no longer sign in to the console. Open invitations stop working. The last active vendor user cannot be deactivated.`
          : ''}
        confirmLabel="Deactivate vendor user"
        destructive
        onCancel={close}
        onConfirm={async () => {
          if (action?.kind !== 'deactivate') return
          await api.post(`${VENDOR_USERS_PATH}/${action.user.id}/deactivate`)
          toast({ message: `${action.user.email} was deactivated.` })
          done()
        }}
      />
    </>
  )
}
