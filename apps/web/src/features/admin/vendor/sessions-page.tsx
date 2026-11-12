'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { ConfirmDialog } from '../../../components/modal'
import { FiltersBar } from '../../../components/filters-bar'
import { Select } from '../../../components/form-field'
import { PageHeader } from '../../../components/page-header'
import { StatusBadge } from '../../../components/status-badge'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { useToast } from '../../../components/toast'
import { leavePage } from '../../../lib/leave-page'
import { isNotAvailable } from '../../../lib/messages'
import { enterSupportSession } from '../../../lib/support-session'
import { useSession } from '../../../lib/session'
import { durationLabel, formatDateTime, remainingLabel, supportScopeText } from '../format'
import { LoadFailure } from '../page-states'
import { useNow } from '../../../lib/use-now'
import { tableError, usePagedList } from '../resource'
import type { SupportSession } from '../types'
import { MONO, NoticeCard, ROW_ACTIONS } from '../ui'
import { RequestSessionDialog } from './request-session-dialog'

const PATH = '/v1/support-sessions'
const COUNTDOWN_TICK_MS = 30_000
const STATES = ['requested', 'approved', 'active', 'denied', 'expired', 'ended'] as const

/** The vendor may end only a session it requested that is active (support/decisions.ts endInVendorRealm). */
export function canEnd(session: SupportSession, userId: string): boolean {
  return session.state === 'active' && session.requester_id === userId
}

/** Its requester may work in an approved or active session while its window is open (support/access.ts). */
export function canOpen(session: SupportSession, userId: string, now: number): boolean {
  const open = session.state === 'approved' || session.state === 'active'
  const inWindow = session.starts_at !== null && session.ends_at !== null && Date.parse(session.starts_at) <= now && now < Date.parse(session.ends_at)
  return open && inWindow && session.requester_id === userId
}

function windowLabel(session: SupportSession, now: number): string {
  if (session.starts_at === null || session.ends_at === null) return `${durationLabel(session.requested_minutes)} asked for`
  const open = session.state === 'active' || session.state === 'approved'
  return open ? `Ends ${formatDateTime(session.ends_at)} (in ${remainingLabel(session.ends_at, now, session.starts_at)})` : `${formatDateTime(session.starts_at)} to ${formatDateTime(session.ends_at)}`
}

function SessionsTable({ state, onEnd }: { readonly state: string; readonly onEnd: (session: SupportSession) => void }) {
  const { me } = useSession()
  const sessions = usePagedList<SupportSession>(PATH, { state: state === '' ? undefined : state })
  const now = useNow(COUNTDOWN_TICK_MS)
  if (isNotAvailable(sessions.error)) return <LoadFailure error={sessions.error} onRetry={sessions.reload} section />
  const columns: readonly DataTableColumn<SupportSession>[] = [
    { key: 'tenant', header: 'Tenant', cell: (session) => <span className="font-data-mono-md text-data-mono-md font-semibold text-primary">{session.tenant_slug}</span> },
    { key: 'reason', header: 'Reason', cell: (session) => session.reason },
    { key: 'scope', header: 'Areas (view only)', cell: (session) => supportScopeText(session.scope.permissions) },
    { key: 'by', header: 'Requested by', cell: (session) => (session.requester_id === me.user.id ? 'You' : 'Another vendor user') },
    { key: 'state', header: 'State', cell: (session) => <StatusBadge state={session.state} /> },
    { key: 'window', header: 'Window', cell: (session) => <span className={MONO}>{windowLabel(session, now)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (session) => {
        return (
        <div className={ROW_ACTIONS}>
          {canOpen(session, me.user.id, now) && (
            <Button
              icon="open_in_new"
              size="sm"
              aria-label={`Open the tenant app of ${session.tenant_slug} (read-only)`}
              onClick={() => {
                enterSupportSession(session.id)
                leavePage('/')
              }}
            >
              Open tenant app
            </Button>
          )}
          {canEnd(session, me.user.id) && (
            <Button variant="destructive" size="sm" aria-label={`End session for ${session.tenant_slug}`} onClick={() => onEnd(session)}>End session</Button>
          )}
        </div>
        )
      },
    },
  ]
  return (
    <DataTable
      caption="Support session requests and sessions of all tenants, newest first"
      columns={columns}
      rows={sessions.rows}
      rowKey={(session) => session.id}
      loading={sessions.loading}
      error={tableError(sessions)}
      empty={{ title: state === '' ? 'No support session has been requested yet.' : 'No session is in this state.' }}
      pagination={sessions.pagination}
    />
  )
}

/** SC-39 Support sessions (FR-IAM-005): request access to a tenant, follow the decision, end your own active session. */
export function VendorSessionsPage() {
  const api = useApi()
  const toast = useToast()
  const params = useSearchParams()
  const [state, setState] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [ending, setEnding] = useState<SupportSession | null>(null)
  const [version, setVersion] = useState(0)
  const refresh = () => setVersion((count) => count + 1)
  return (
    <>
      <PageHeader
        title="Support sessions"
        summary="Ask a tenant for a read-only, time-boxed session; its admins decide."
        actions={<Button variant="primary" icon="add_moderator" data-testid="primary-action" onClick={() => setRequesting(true)}>Request support session</Button>}
      />
      <NoticeCard icon="vpn_key" heading="h2" title="You have no standing access to tenant data">
        A session is read-only and starts only when the tenant’s admins approve it. It ends at the approved time, and the tenant sees every view in its log.
      </NoticeCard>
      {params.get('reason') === 'session_closed' && (
        <Banner tone="info" title="Your support session is no longer open">The tenant ended it or its window closed. Ask for a new session if you still need access.</Banner>
      )}
      <FiltersBar label="Filter support sessions">
        <Select
          label="State"
          value={state}
          options={[{ value: '', label: 'All states' }, ...STATES.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))]}
          onChange={(event) => setState(event.target.value)}
        />
      </FiltersBar>
      <SessionsTable key={`${state}:${version}`} state={state} onEnd={setEnding} />
      {requesting && (
        <RequestSessionDialog
          onClose={() => setRequesting(false)}
          onRequested={() => {
            setRequesting(false)
            refresh()
          }}
        />
      )}
      <ConfirmDialog
        open={ending !== null}
        title="End support session"
        consequence={`Your access to ${ending?.tenant_slug ?? 'the tenant'} ends now. The tenant keeps the session log.`}
        confirmLabel="End session"
        destructive
        onCancel={() => setEnding(null)}
        onConfirm={async () => {
          if (ending === null) return
          await api.post(`${PATH}/${ending.id}/end`)
          toast({ message: 'Your support session has ended.' })
          setEnding(null)
          refresh()
        }}
      />
    </>
  )
}
