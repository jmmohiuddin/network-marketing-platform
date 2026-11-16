'use client'

import { useState } from 'react'
import { Button } from '../../../components/button'
import { KpiCard } from '../../../components/kpi-card'
import { PageHeader } from '../../../components/page-header'
import { TabPanel, Tabs } from '../../../components/tabs'
import { countLabel } from '../../../lib/format'
import { isNotAvailable } from '../../../lib/messages'
import { LoadFailure, useTabParam } from '../page-states'
import { useSession } from '../../../lib/session'
import { MARKETS_PATH, type Market } from '../../../lib/markets'
import { useResource } from '../../../lib/use-resource'
import { usePagedList } from '../resource'
import type { GrantRequest, RoleView, UserView } from '../types'
import { NoticeCard } from '../ui'
import { ApprovalsTab } from './approvals-tab'
import { InviteDialog } from './invite-dialog'
import { RolesTab } from './roles-tab'
import { UsersTable } from './users-table'

const ID_PREFIX = 'users-roles'
// shortcut: one page of up to 200 pending requests feeds the tab count and the "waiting" chips; page further when
// tenants routinely have more open grant requests.
const PENDING_PAGE_SIZE = 200

/** sc_28 KPI strip from the loaded lists (no totals: the API pages users by cursor). */
function UserKpis({ users, roles, pending }: {
  readonly users: { readonly rows: readonly UserView[]; readonly loading: boolean; readonly paged: boolean }
  readonly roles: readonly RoleView[] | null
  readonly pending: { readonly count: number; readonly loading: boolean }
}) {
  const tenantRoles = roles?.filter((role) => !role.is_base).length ?? 0
  const withoutApp = users.rows.filter((user) => user.state !== 'deactivated' && !user.mfa_enrolled).length
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <KpiCard label="Users" icon="group" value={users.loading ? null : String(users.rows.length)} detail={users.paged ? 'On this page of the list' : 'In this tenant'} />
      <KpiCard label="Roles" icon="admin_panel_settings" value={roles === null ? null : String(roles.length)} detail={roles === null ? undefined : `${countLabel(tenantRoles, 'tenant role')}, the rest base roles`} />
      <KpiCard label="Without authenticator app" icon="key" value={users.loading ? null : String(withoutApp)} detail={users.paged ? 'Of the users on this page' : 'Of the users not deactivated'} />
      <KpiCard label="Pending grants" icon="how_to_reg" value={pending.loading ? null : String(pending.count)} detail="Waiting for a second admin" />
    </div>
  )
}

/** SC-28 Users and roles (FR-IAM-003, API-40): users, roles, pending approvals of privileged grants. */
export function UsersPage() {
  const { readOnly } = useSession()
  const users = usePagedList<UserView>('/v1/users')
  const roles = useResource<readonly RoleView[]>('/v1/roles')
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const pending = usePagedList<GrantRequest>('/v1/role-grant-requests', { state: 'pending', limit: PENDING_PAGE_SIZE })
  const [inviting, setInviting] = useState(false)
  const pendingKnown = !pending.loading && pending.error === null
  const tabs = [
    { id: 'users', label: 'Users' },
    { id: 'roles', label: 'Role permission matrix', ...(roles.data === null ? {} : { count: roles.data.length }) },
    { id: 'approvals', label: 'Pending approvals', ...(pendingKnown ? { count: pending.rows.length } : {}) },
  ]
  const [tab, selectTab] = useTabParam(tabs)
  const failure = [users.error, roles.error].find(isNotAvailable)
  if (failure !== undefined) return <LoadFailure error={failure} onRetry={users.reload} />
  const refresh = () => {
    users.reload()
    pending.reload()
  }
  const roleRows = roles.data ?? []
  const paged = users.pagination.hasNext || users.pagination.hasPrevious
  return (
    <>
      <PageHeader
        title="Users and roles"
        summary="Invite people, assign roles with a market scope and decide grants that need a second admin."
        actions={readOnly ? undefined : <Button variant="primary" icon="person_add" data-testid="primary-action" onClick={() => setInviting(true)}>Invite user</Button>}
      />
      <NoticeCard icon="security_update_good" heading="h2" title="Admin and approver roles need a second admin">
        Granting an admin or approver role takes effect only after another admin approves it. Nobody decides a grant they asked for or a grant for themselves.
      </NoticeCard>
      <UserKpis users={{ rows: users.rows, loading: users.loading, paged }} roles={roles.data} pending={{ count: pending.rows.length, loading: !pendingKnown }} />
      <div>
        <Tabs label="Users and roles" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={selectTab} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          {tab === 'users' && <UsersTable users={users} roles={roleRows} markets={markets} pending={pending.rows} onChanged={refresh} listSelector={`#${ID_PREFIX}-panel-users`} />}
          {tab === 'roles' && <RolesTab roles={roles} onChanged={roles.reload} />}
          {tab === 'approvals' && <ApprovalsTab requests={pending} roles={roleRows} markets={markets.data ?? []} users={users.rows} onChanged={refresh} listSelector={`#${ID_PREFIX}-panel-approvals`} />}
        </TabPanel>
      </div>
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onInvited={() => {
            setInviting(false)
            users.reload()
          }}
        />
      )}
    </>
  )
}
