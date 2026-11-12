'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { useSession } from '../../../lib/session'
import { Button } from '../../../components/button'
import { ConfirmDialog } from '../../../components/dialog'
import { StatusChip } from '../../../components/status-chip'
import { Table, type TableColumn } from '../../../components/table'
import { useToast } from '../../../components/toast'
import { formatDateTime, marketScopeLabel, personLabel } from '../format'
import { tableError, useIdempotencyKey, type PagedList } from '../resource'
import type { GrantRequest, RoleView, UserRole, UserView } from '../types'
import { GrantDialog } from './grant-dialog'

type UserAction =
  | { readonly kind: 'grant'; readonly user: UserView }
  | { readonly kind: 'resend'; readonly user: UserView }
  | { readonly kind: 'deactivate'; readonly user: UserView }
  | { readonly kind: 'revoke'; readonly user: UserView; readonly role: UserRole }

export interface UsersTableProps {
  readonly users: PagedList<UserView>
  readonly roles: readonly RoleView[]
  /** Pending grant requests: shown as pending next to the user they are for. */
  readonly pending: readonly GrantRequest[]
  /** Something changed: reload users and requests. */
  readonly onChanged: () => void
}

function RolesCell({ user, pending, roleNames, onRevoke }: {
  readonly user: UserView
  readonly pending: readonly GrantRequest[]
  readonly roleNames: ReadonlyMap<string, string>
  /** Absent: read-only (no Revoke). */
  readonly onRevoke?: (role: UserRole) => void
}) {
  const waiting = pending.filter((request) => request.user_id === user.id)
  if (user.roles.length === 0 && waiting.length === 0) return <span className="admin-note">No role</span>
  return (
    <ul className="admin-plain-list">
      {user.roles.map((role) => (
        <li key={role.assignment_id} className="admin-role-line">
          <span>{role.name} · {marketScopeLabel(role.market_ids)}{role.valid_to === null ? '' : ` · until ${formatDateTime(role.valid_to)}`}</span>
          {onRevoke !== undefined && <Button variant="tertiary" aria-label={`Revoke ${role.name} from ${user.email}`} onClick={() => onRevoke(role)}>Revoke</Button>}
        </li>
      ))}
      {waiting.map((request) => (
        <li key={request.id} className="admin-role-line">
          <span>{roleNames.get(request.role_id) ?? 'Role'} · {marketScopeLabel(request.market_ids)}</span>
          <StatusChip state="pending" label="Waiting for a second admin" />
        </li>
      ))}
    </ul>
  )
}

function ResendDialog({ user, onClose, onDone }: { readonly user: UserView; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const idempotencyKey = useIdempotencyKey()
  return (
    <ConfirmDialog
      open
      title="Resend invitation"
      consequence={`${user.email} gets a new link by email. The earlier link stops working.`}
      confirmLabel="Resend invitation"
      onCancel={onClose}
      onConfirm={async () => {
        await api.post(`/v1/users/${user.id}/invitation`, undefined, { idempotencyKey })
        toast({ message: `A new invitation was sent to ${user.email}.` })
        onDone()
      }}
    />
  )
}

/** SC-28 users tab: users with roles, market scopes, MFA state; assign and revoke roles, resend, deactivate. */
export function UsersTable({ users, roles, pending, onChanged }: UsersTableProps) {
  const { readOnly } = useSession()
  const api = useApi()
  const toast = useToast()
  const [action, setAction] = useState<UserAction | null>(null)
  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  const close = () => setAction(null)
  const done = () => {
    setAction(null)
    onChanged()
  }
  const columns: readonly TableColumn<UserView>[] = [
    { key: 'user', header: 'User', cell: (user) => personLabel(user) },
    { key: 'roles', header: 'Roles and market scope', cell: (user) => <RolesCell user={user} pending={pending} roleNames={roleNames} onRevoke={readOnly ? undefined : (role) => setAction({ kind: 'revoke', user, role })} /> },
    { key: 'mfa', header: 'Authenticator app', cell: (user) => (user.mfa_enrolled ? 'Set up' : 'Not set up') },
    { key: 'last', header: 'Last sign-in', cell: (user) => (user.last_sign_in_at === null ? 'Never' : formatDateTime(user.last_sign_in_at)) },
    { key: 'state', header: 'State', cell: (user) => <StatusChip state={user.state} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) => readOnly || user.state === 'deactivated' ? null : (
        <div className="admin-row-actions">
          <Button aria-label={`Assign role to ${user.email}`} onClick={() => setAction({ kind: 'grant', user })}>Assign role</Button>
          {user.state === 'invited' && (
            <Button variant="tertiary" aria-label={`Resend invitation to ${user.email}`} onClick={() => setAction({ kind: 'resend', user })}>Resend invitation</Button>
          )}
          <Button variant="destructive" aria-label={`Deactivate ${user.email}`} onClick={() => setAction({ kind: 'deactivate', user })}>Deactivate</Button>
        </div>
      ),
    },
  ]
  const count = users.rows.length
  return (
    <>
      <Table
        caption={users.loading ? 'Users' : `${count} ${count === 1 ? 'user' : 'users'} on this page`}
        columns={columns}
        rows={users.rows}
        rowKey={(user) => user.id}
        loading={users.loading}
        error={tableError(users)}
        empty={{ title: 'No users yet. Invite the people who work with this tenant.' }}
        pagination={users.pagination}
      />
      {action?.kind === 'grant' && <GrantDialog user={action.user} roles={roles} onClose={close} onGranted={done} />}
      {action?.kind === 'resend' && <ResendDialog user={action.user} onClose={close} onDone={done} />}
      <ConfirmDialog
        open={action?.kind === 'deactivate'}
        title="Deactivate user"
        consequence={action?.kind === 'deactivate' ? `${action.user.email} is signed out at once and can no longer sign in. Open invitations stop working. This cannot be undone here.` : ''}
        confirmLabel="Deactivate user"
        destructive
        onCancel={close}
        onConfirm={async () => {
          if (action?.kind !== 'deactivate') return
          await api.post(`/v1/users/${action.user.id}/deactivate`)
          toast({ message: `${action.user.email} was deactivated.` })
          done()
        }}
      />
      <ConfirmDialog
        open={action?.kind === 'revoke'}
        title="Revoke role"
        consequence={action?.kind === 'revoke' ? `${action.user.email} loses ${action.role.name} (${marketScopeLabel(action.role.market_ids)}) now.` : ''}
        confirmLabel="Revoke role"
        destructive
        onCancel={close}
        onConfirm={async () => {
          if (action?.kind !== 'revoke') return
          await api.post(`/v1/role-assignments/${action.role.assignment_id}/revoke`)
          toast({ message: `${action.role.name} was revoked from ${action.user.email}.` })
          done()
        }}
      />
    </>
  )
}
