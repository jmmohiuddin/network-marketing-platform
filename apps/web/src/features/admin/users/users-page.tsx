'use client'

import { useState } from 'react'
import { Button } from '../../../components/button'
import { PageHeader } from '../../../components/page-header'
import { TabPanel, Tabs } from '../../../components/tabs'
import { isNotAvailable } from '../../../lib/messages'
import { LoadFailure, useTabParam } from '../page-states'
import { useSession } from '../../../lib/session'
import { MARKETS_PATH, type Market } from '../../../lib/markets'
import { useResource } from '../../../lib/use-resource'
import { usePagedList } from '../resource'
import type { GrantRequest, RoleView, UserView } from '../types'
import { ApprovalsTab } from './approvals-tab'
import { InviteDialog } from './invite-dialog'
import { RolesTab } from './roles-tab'
import { UsersTable } from './users-table'

const ID_PREFIX = 'users-roles'
// shortcut: one page of up to 200 pending requests feeds the tab count and the "waiting" chips; page further when
// tenants routinely have more open grant requests.
const PENDING_PAGE_SIZE = 200

/** SC-28 Users and roles (FR-IAM-003, API-40): users, roles, pending approvals of privileged grants. */
export function UsersPage() {
  const { readOnly } = useSession()
  const users = usePagedList<UserView>('/v1/users')
  const roles = useResource<readonly RoleView[]>('/v1/roles')
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const pending = usePagedList<GrantRequest>('/v1/role-grant-requests', { state: 'pending', limit: PENDING_PAGE_SIZE })
  const [inviting, setInviting] = useState(false)
  const pendingLabel = pending.loading || pending.error !== null ? 'Pending approvals' : `Pending approvals (${pending.rows.length})`
  const tabs = [{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles' }, { id: 'approvals', label: pendingLabel }]
  const [tab, selectTab] = useTabParam(tabs)
  const failure = [users.error, roles.error].find(isNotAvailable)
  if (failure !== undefined) return <LoadFailure error={failure} onRetry={users.reload} />
  const refresh = () => {
    users.reload()
    pending.reload()
  }
  const roleRows = roles.data ?? []
  return (
    <>
      <PageHeader
        title="Users and roles"
        summary="Invite people, assign roles with a market scope and decide grants that need a second admin."
        actions={readOnly ? undefined : <Button variant="primary" onClick={() => setInviting(true)}>Invite user</Button>}
      />
      <Tabs label="Users and roles" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={selectTab} />
      <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
        {tab === 'users' && <UsersTable users={users} roles={roleRows} markets={markets} pending={pending.rows} onChanged={refresh} />}
        {tab === 'roles' && <RolesTab roles={roles} onChanged={roles.reload} />}
        {tab === 'approvals' && <ApprovalsTab requests={pending} roles={roleRows} markets={markets.data ?? []} users={users.rows} onChanged={refresh} />}
      </TabPanel>
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
