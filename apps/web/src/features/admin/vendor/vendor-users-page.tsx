'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Avatar } from '../../../components/avatar'
import { Button } from '../../../components/button'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { ConfirmDialog } from '../../../components/modal'
import { PageHeader } from '../../../components/page-header'
import { StatusBadge } from '../../../components/status-badge'
import { useToast } from '../../../components/toast'
import { countLabel } from '../../../lib/format'
import { isNotAvailable } from '../../../lib/messages'
import { useSession } from '../../../lib/session'
import { formatDateTime } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, useIdempotencyKey, usePagedList } from '../resource'
import type { VendorUser } from '../types'
import { MONO, NoticeCard, ROW_ACTIONS } from '../ui'
import { InviteDialog } from '../users/invite-dialog'

const VENDOR_USERS_PATH = '/v1/vendor-users'

type Decision = 'approve' | 'reject'
type UserAction =
  | { readonly kind: 'invite' }
  | { readonly kind: 'resend' | 'deactivate'; readonly user: VendorUser }
  | { readonly kind: 'decide'; readonly user: VendorUser; readonly decision: Decision }

const INVITATION_LABELS: Readonly<Record<NonNullable<VendorUser['invitation_status']>, { state: string; label: string }>> = {
  pending_approval: { state: 'awaiting_approval', label: 'Awaiting approval' },
  approved: { state: 'approved', label: 'Approved' },
  rejected: { state: 'rejected', label: 'Rejected' },
}

/** sc_28 member cell: initials avatar, name (marked when it is the signed-in user), email. */
function MemberCell({ user, self }: { readonly user: VendorUser; readonly self: boolean }) {
  return (
    <div className="flex items-center gap-space-xs">
      <Avatar name={user.display_name} email={user.email} />
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-on-surface truncate leading-tight">{user.display_name ?? user.email}{self ? ' · you' : ''}</span>
        {user.display_name !== null && <span className="font-caption text-caption text-secondary font-normal truncate">{user.email}</span>}
      </div>
    </div>
  )
}

/** The invitation's second-person state (BUG-031) with who decided it, when. */
function InvitationCell({ user }: { readonly user: VendorUser }) {
  if (user.invitation_status === null) return <span className="text-secondary">—</span>
  const look = INVITATION_LABELS[user.invitation_status]
  return (
    <div className="flex flex-col items-start gap-0.5">
      <StatusBadge state={look.state} label={look.label} />
      {user.invitation_decided_at !== null && <span className={`${MONO} text-secondary`}>{formatDateTime(user.invitation_decided_at)}</span>}
    </div>
  )
}

/**
 * BUG-031 second-person decision on a pending invitation: POST /v1/vendor-users/:id/approve | reject, no body, with
 * step-up (the API asks, ApiProvider prompts) and one Idempotency-Key per opening. The API refuses the inviter and
 * anyone in the inviter's invitation line; its message says why.
 */
function DecideDialog({ user, decision, onClose, onDone }: { readonly user: VendorUser; readonly decision: Decision; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const idempotencyKey = useIdempotencyKey()
  const approve = decision === 'approve'
  return (
    <ConfirmDialog
      open
      title={approve ? 'Approve invitation' : 'Reject invitation'}
      consequence={approve
        ? `${user.email} gets the invitation email now. Another vendor user, not linked to the inviter by an invitation, must do this step. You will be asked for a code from your authenticator app.`
        : `${user.email} is not invited and the account is closed. This cannot be undone. You will be asked for a code from your authenticator app.`}
      confirmLabel={approve ? 'Approve invitation' : 'Reject invitation'}
      destructive={!approve}
      onCancel={onClose}
      onConfirm={async () => {
        await api.post(`${VENDOR_USERS_PATH}/${user.id}/${decision}`, undefined, { idempotencyKey })
        toast({ message: approve ? `The invitation was sent to ${user.email}.` : `The invitation of ${user.email} was rejected.` })
        onDone()
      }}
    />
  )
}

/**
 * Vendor users of the operations console (BUG-011, BUG-031, FR-OPS-001): GET/POST /v1/vendor-users, approve or reject
 * a pending invitation, re-invite, deactivate. Two-person tenant provisioning (FR-TEN-001) needs a second vendor
 * user, invited here. Inviting, deciding and deactivating ask for a code from the authenticator app.
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
  if (isNotAvailable(users.error)) return <LoadFailure error={users.error} onRetry={users.reload} />
  const columns: readonly DataTableColumn<VendorUser>[] = [
    { key: 'user', header: 'Vendor user', cell: (user) => <MemberCell user={user} self={user.id === me.user.id} /> },
    { key: 'invitation', header: 'Invitation', cell: (user) => <InvitationCell user={user} /> },
    { key: 'mfa', header: 'Authenticator app', cell: (user) => (user.mfa_enrolled ? 'Set up' : 'Not set up') },
    { key: 'last', header: 'Last sign-in', align: 'end', cell: (user) => <span className={`${MONO} text-on-surface-variant whitespace-nowrap`}>{user.last_sign_in_at === null ? 'Never' : formatDateTime(user.last_sign_in_at)}</span> },
    { key: 'state', header: 'State', cell: (user) => <StatusBadge state={user.state} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) => {
        if (user.state === 'deactivated') return null
        const pending = user.invitation_status === 'pending_approval'
        // The inviter never decides their own invitation; the API also refuses anyone in the inviter's line.
        const mayDecide = pending && user.created_by !== me.user.id
        return (
          <div className={ROW_ACTIONS}>
            {mayDecide && <Button size="sm" icon="verified_user" aria-label={`Approve invitation of ${user.email}`} onClick={() => setAction({ kind: 'decide', user, decision: 'approve' })}>Approve</Button>}
            {mayDecide && <Button variant="destructive" size="sm" aria-label={`Reject invitation of ${user.email}`} onClick={() => setAction({ kind: 'decide', user, decision: 'reject' })}>Reject</Button>}
            {user.state === 'invited' && !pending && (
              <Button variant="tertiary" size="sm" aria-label={`Resend invitation to ${user.email}`} onClick={() => setAction({ kind: 'resend', user })}>Resend invitation</Button>
            )}
            <Button variant="destructive" size="sm" aria-label={`Deactivate ${user.email}`} onClick={() => setAction({ kind: 'deactivate', user })}>Deactivate</Button>
          </div>
        )
      },
    },
  ]
  return (
    <>
      <PageHeader
        title="Vendor users"
        summary="People who operate this console. A tenant one vendor user provisions is approved by another, so keep at least two active."
        actions={<Button variant="primary" icon="person_add" data-testid="primary-action" onClick={() => setAction({ kind: 'invite' })}>Invite vendor user</Button>}
      />
      <NoticeCard icon="admin_panel_settings" heading="h2" title="Every invitation needs a second vendor user">
        An invitation is mailed only after another vendor user, not linked to the inviter by an invitation, approves it.
      </NoticeCard>
      <DataTable
        caption={users.loading ? 'Vendor users' : `${countLabel(users.rows.length, 'vendor user')} on this page`}
        columns={columns}
        rows={users.rows}
        rowKey={(user) => user.id}
        loading={users.loading}
        error={tableError(users)}
        empty={{ title: 'No vendor users.' }}
        pagination={users.pagination}
      />
      {action?.kind === 'invite' && (
        <InviteDialog
          endpoint={VENDOR_USERS_PATH}
          title="Invite vendor user"
          intro="Another vendor user approves the invitation before it is mailed. The person then chooses a password and sets up an authenticator app at first sign-in. You will be asked for a code from your authenticator app."
          invitedMessage={(email) => `${email} is invited. Awaiting approval by another vendor user.`}
          onClose={close}
          onInvited={done}
        />
      )}
      {action?.kind === 'decide' && <DecideDialog user={action.user} decision={action.decision} onClose={close} onDone={done} />}
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
