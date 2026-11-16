'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { useSession } from '../../../lib/session'
import { Avatar } from '../../../components/avatar'
import { Button } from '../../../components/button'
import { Icon } from '../../../components/icon'
import { ConfirmDialog } from '../../../components/modal'
import { StatusBadge } from '../../../components/status-badge'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { useToast } from '../../../components/toast'
import type { Market } from '../../../lib/markets'
import type { Resource } from '../../../lib/use-resource'
import { formatDateTime, marketScopeLabel } from '../format'
import { tableError, useIdempotencyKey, type PagedList } from '../resource'
import type { GrantRequest, RoleView, UserRole, UserView } from '../types'
import { CHIP, MONO, NOTE, ROW_ACTIONS } from '../ui'
import { GrantDialog } from './grant-dialog'

type UserAction =
  | { readonly kind: 'grant'; readonly user: UserView }
  | { readonly kind: 'resend'; readonly user: UserView }
  | { readonly kind: 'deactivate'; readonly user: UserView }
  | { readonly kind: 'revoke'; readonly user: UserView; readonly role: UserRole }

export interface UsersTableProps {
  readonly users: PagedList<UserView>
  readonly roles: readonly RoleView[]
  /** GET /v1/markets: scopes are shown by market code and chosen from this list. */
  readonly markets: Resource<readonly Market[]>
  /** Pending grant requests: shown as pending next to the user they are for. */
  readonly pending: readonly GrantRequest[]
  /** Something changed: reload users and requests. */
  readonly onChanged: () => void
  /** Selector of the users list, focused after an action that removes the opener's row (BUG-028). */
  readonly listSelector: string
}

/** sc_28 role chip and its market scope (globe icon), read as "Role · scope". */
function RoleLine({ name, scope }: { readonly name: string; readonly scope: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={CHIP}>{name}</span>
      <span className="sr-only"> · </span>
      <span className="inline-flex items-center gap-1 text-on-surface-variant"><Icon name="public" size={14} className="text-secondary" />{scope}</span>
    </span>
  )
}

/** sc_28 staff member cell: initials avatar, name, email. */
function MemberCell({ user }: { readonly user: UserView }) {
  return (
    <div className="flex items-center gap-space-xs">
      <Avatar name={user.display_name} email={user.email} />
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-on-surface truncate leading-tight">{user.display_name ?? user.email}</span>
        {user.display_name !== null && <span className="font-caption text-caption text-secondary font-normal truncate">{user.email}</span>}
      </div>
    </div>
  )
}

/** sc_28 MFA method chip: set up (success tone) or not set up (neutral). */
function MfaCell({ enrolled }: { readonly enrolled: boolean }) {
  return enrolled
    ? <span className="inline-flex items-center gap-1 px-space-xs py-0.5 rounded text-[11px] font-caption font-medium bg-tertiary-fixed text-on-tertiary-fixed"><Icon name="key" size={13} />Set up</span>
    : <span className="inline-flex items-center gap-1 px-space-xs py-0.5 rounded text-[11px] font-caption font-medium bg-surface-container-high text-on-surface"><Icon name="key_off" size={13} />Not set up</span>
}

function RolesCell({ user, pending, roleNames, markets, onRevoke }: {
  readonly user: UserView
  readonly pending: readonly GrantRequest[]
  readonly markets: readonly Market[]
  readonly roleNames: ReadonlyMap<string, string>
  /** Absent: read-only (no Revoke). */
  readonly onRevoke?: (role: UserRole) => void
}) {
  const waiting = pending.filter((request) => request.user_id === user.id)
  if (user.roles.length === 0 && waiting.length === 0) return <span className={NOTE}>No role</span>
  return (
    <ul className="flex flex-col gap-space-xs">
      {user.roles.map((role) => (
        <li key={role.assignment_id} className="flex flex-wrap items-center gap-space-xs">
          <RoleLine name={role.name} scope={`${marketScopeLabel(role.market_ids, markets)}${role.valid_to === null ? '' : ` · until ${formatDateTime(role.valid_to)}`}`} />
          {onRevoke !== undefined && <Button variant="tertiary" size="sm" aria-label={`Revoke ${role.name} from ${user.email}`} onClick={() => onRevoke(role)}>Revoke</Button>}
        </li>
      ))}
      {waiting.map((request) => (
        <li key={request.id} className="flex flex-wrap items-center gap-space-xs">
          <RoleLine name={roleNames.get(request.role_id) ?? 'Role'} scope={marketScopeLabel(request.market_ids, markets)} />
          <StatusBadge state="pending" label="Waiting for a second admin" />
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
export function UsersTable({ users, roles, markets, pending, onChanged, listSelector }: UsersTableProps) {
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
  const columns: readonly DataTableColumn<UserView>[] = [
    { key: 'user', header: 'Staff member', cell: (user) => <MemberCell user={user} /> },
    { key: 'roles', header: 'Roles and market scope', cell: (user) => <RolesCell user={user} pending={pending} roleNames={roleNames} markets={markets.data ?? []} onRevoke={readOnly ? undefined : (role) => setAction({ kind: 'revoke', user, role })} /> },
    { key: 'mfa', header: 'Authenticator app', cell: (user) => <MfaCell enrolled={user.mfa_enrolled} /> },
    { key: 'last', header: 'Last sign-in', align: 'end', cell: (user) => <span className={`${MONO} text-on-surface-variant whitespace-nowrap`}>{user.last_sign_in_at === null ? 'Never' : formatDateTime(user.last_sign_in_at)}</span> },
    { key: 'state', header: 'State', cell: (user) => <StatusBadge state={user.state} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) => readOnly || user.state === 'deactivated' ? null : (
        <div className={ROW_ACTIONS}>
          <Button size="sm" aria-label={`Assign role to ${user.email}`} onClick={() => setAction({ kind: 'grant', user })}>Assign role</Button>
          {user.state === 'invited' && (
            <Button variant="tertiary" size="sm" aria-label={`Resend invitation to ${user.email}`} onClick={() => setAction({ kind: 'resend', user })}>Resend invitation</Button>
          )}
          <Button variant="destructive" size="sm" aria-label={`Deactivate ${user.email}`} onClick={() => setAction({ kind: 'deactivate', user })}>Deactivate</Button>
        </div>
      ),
    },
  ]
  const count = users.rows.length
  return (
    <>
      <DataTable
        caption={users.loading ? 'Users' : `${count} ${count === 1 ? 'user' : 'users'} on this page`}
        columns={columns}
        rows={users.rows}
        rowKey={(user) => user.id}
        loading={users.loading}
        error={tableError(users)}
        empty={{ title: 'No users yet. Invite the people who work with this tenant.' }}
        pagination={users.pagination}
      />
      {action?.kind === 'grant' && <GrantDialog user={action.user} roles={roles} markets={markets} onClose={close} onGranted={done} />}
      {action?.kind === 'resend' && <ResendDialog user={action.user} onClose={close} onDone={done} />}
      <ConfirmDialog
        open={action?.kind === 'deactivate'}
        title="Deactivate user"
        consequence={action?.kind === 'deactivate' ? `${action.user.email} is signed out at once and can no longer sign in. Open invitations stop working. This cannot be undone here.` : ''}
        confirmLabel="Deactivate user"
        destructive
        returnFocusTo={listSelector}
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
        consequence={action?.kind === 'revoke' ? `${action.user.email} loses ${action.role.name} (${marketScopeLabel(action.role.market_ids, markets.data ?? [])}) now.` : ''}
        confirmLabel="Revoke role"
        destructive
        returnFocusTo={listSelector}
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
