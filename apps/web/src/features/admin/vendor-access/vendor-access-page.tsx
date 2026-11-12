'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button } from '../../../components/button'
import { ConfirmDialog } from '../../../components/dialog'
import { PageHeader } from '../../../components/page-header'
import { EmptyState, LoadingState } from '../../../components/states'
import { StatusChip } from '../../../components/status-chip'
import { Table, type TableColumn } from '../../../components/table'
import { TabPanel, Tabs } from '../../../components/tabs'
import { useToast } from '../../../components/toast'
import { useSession } from '../../../lib/session'
import { actorLabel, durationLabel, formatDateTime, remainingLabel, supportScopeText } from '../format'
import { LoadFailure, useTabParam } from '../page-states'
import { useNow } from '../../../lib/use-now'
import { useResource } from '../../../lib/use-resource'
import { tableError, usePagedList, type PagedList } from '../resource'
import type { SupportSession } from '../types'
import { outOfRegion, SupportDecisionDialog } from './decision-dialog'
import { SessionLogDialog } from './session-log-dialog'

const ID_PREFIX = 'vendor-access'
const TABS = [{ id: 'requests', label: 'Requests' }, { id: 'active', label: 'Active' }, { id: 'history', label: 'History' }]
const COUNTDOWN_TICK_MS = 30_000
// shortcut: open (approved or active) sessions are read as one page of up to 200 each; page them if a tenant ever
// has more open at once.
const OPEN_PAGE_SIZE = 200
const PATH = '/v1/support-sessions'
const NO_NAMES: ReadonlyMap<string, string> = new Map()

type Dialogs =
  | { readonly kind: 'decide'; readonly session: SupportSession; readonly approve: boolean }
  | { readonly kind: 'end'; readonly session: SupportSession }
  | { readonly kind: 'log'; readonly session: SupportSession }

function scopeText(session: SupportSession): string {
  return supportScopeText(session.scope.permissions)
}

function RequestCard({ session, tenantRegion, onDecide }: {
  readonly session: SupportSession
  readonly tenantRegion: string | null
  readonly onDecide: (approve: boolean) => void
}) {
  const { readOnly } = useSession()
  const titleId = `support-request-${session.id}`
  return (
    <li className="admin-card" aria-labelledby={titleId}>
      <div className="admin-card-header">
        <h2 id={titleId} className="admin-card-title">Vendor support request</h2>
        <StatusChip state="requested" label="Waiting for your decision" />
      </div>
      <dl className="admin-details">
        {/* shortcut: the tenant cannot read vendor users, so the requester shows as in the audit log; name them once the
            session view carries the requester's name. */}
        <dt>Asked by</dt><dd>{actorLabel({ actor_type: 'vendor_user', actor_id: session.requester_id }, NO_NAMES)}</dd>
        <dt>Reason</dt><dd>{session.reason}</dd>
        <dt>Areas asked for (view only)</dt><dd>{scopeText(session)}</dd>
        <dt>Duration asked for</dt><dd>{durationLabel(session.requested_minutes)}</dd>
        <dt>Data region</dt>
        <dd>{outOfRegion(session, tenantRegion) ? 'The requester works outside your data region. Approving needs your explicit region approval.' : 'Same as your data'}</dd>
        <dt>Asked at</dt><dd>{formatDateTime(session.created_at)}</dd>
      </dl>
      <p className="admin-note">Nothing can be accessed until you approve. Access ends automatically. A request nobody decides in time is denied automatically.</p>
      {!readOnly && <div className="form-actions">
        <Button variant="destructive" onClick={() => onDecide(false)}>Deny</Button>
        {/* One primary action per view: with several requests listed, no card's Approve is the primary. */}
        <Button variant="secondary" onClick={() => onDecide(true)}>Approve</Button>
      </div>}
    </li>
  )
}

function RequestsTab({ requests, tenantRegion, onDecide }: {
  readonly requests: PagedList<SupportSession>
  readonly tenantRegion: string | null
  readonly onDecide: (session: SupportSession, approve: boolean) => void
}) {
  if (requests.error !== null) return <LoadFailure error={requests.error} onRetry={requests.reload} section />
  if (requests.loading) return <LoadingState label="Loading requests" />
  if (requests.rows.length === 0) return <EmptyState title="No requests. When vendor staff ask for access, the request appears here." />
  const { pagination } = requests
  return (
    <div className="admin-section">
      <ul className="admin-cards">
        {requests.rows.map((session) => (
          <RequestCard key={session.id} session={session} tenantRegion={tenantRegion} onDecide={(approve) => onDecide(session, approve)} />
        ))}
      </ul>
      {(pagination.hasPrevious || pagination.hasNext) && (
        <nav className="pagination" aria-label="Pages of requests">
          <Button onClick={pagination.onPrevious} disabled={!pagination.hasPrevious}>Previous page</Button>
          <Button onClick={pagination.onNext} disabled={!pagination.hasNext}>Next page</Button>
        </nav>
      )}
    </div>
  )
}

function ActiveTab({ onEnd, onLog }: { readonly onEnd: (session: SupportSession) => void; readonly onLog: (session: SupportSession) => void }) {
  const active = useResource<SupportSession[]>(PATH, { state: 'active', limit: OPEN_PAGE_SIZE })
  const approved = useResource<SupportSession[]>(PATH, { state: 'approved', limit: OPEN_PAGE_SIZE })
  const now = useNow(COUNTDOWN_TICK_MS)
  const { readOnly } = useSession()
  const failed = active.error ?? approved.error
  const rows = [...(active.data ?? []), ...(approved.data ?? [])].sort((left, right) => (left.ends_at ?? '').localeCompare(right.ends_at ?? ''))
  const columns: readonly TableColumn<SupportSession>[] = [
    { key: 'reason', header: 'Reason', cell: (session) => session.reason },
    { key: 'scope', header: 'Areas (view only)', cell: scopeText },
    { key: 'start', header: 'Window started', cell: (session) => formatDateTime(session.starts_at) },
    { key: 'ends', header: 'Ends', cell: (session) => (session.ends_at === null ? '—' : `${formatDateTime(session.ends_at)} (in ${remainingLabel(session.ends_at, now)})`) },
    { key: 'state', header: 'State', cell: (session) => <StatusChip state={session.state} label={session.state === 'approved' ? 'Approved, not used yet' : undefined} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (session) => (
        <div className="admin-row-actions">
          <Button variant="tertiary" onClick={() => onLog(session)}>View log</Button>
          {!readOnly && <Button variant="destructive" onClick={() => onEnd(session)}>End now</Button>}
        </div>
      ),
    },
  ]
  return (
    <Table
      caption="Vendor sessions that are open now. Each ends automatically at the time shown."
      columns={columns}
      rows={rows}
      rowKey={(session) => session.id}
      loading={active.loading || approved.loading}
      error={failed === null ? null : tableError({ error: failed, reload: () => { active.reload(); approved.reload() } })}
      empty={{ title: 'No vendor session is open.' }}
    />
  )
}

function HistoryTab({ onLog }: { readonly onLog: (session: SupportSession) => void }) {
  const sessions = usePagedList<SupportSession>(PATH)
  const columns: readonly TableColumn<SupportSession>[] = [
    { key: 'asked', header: 'Asked at', cell: (session) => formatDateTime(session.created_at) },
    { key: 'reason', header: 'Reason', cell: (session) => session.reason },
    { key: 'scope', header: 'Areas (view only)', cell: scopeText },
    { key: 'window', header: 'Window', cell: (session) => (session.starts_at === null ? '—' : `${formatDateTime(session.starts_at)} to ${formatDateTime(session.ends_at)}`) },
    { key: 'state', header: 'State', cell: (session) => <StatusChip state={session.state} /> },
    { key: 'log', header: 'Log', align: 'end', cell: (session) => <Button variant="tertiary" onClick={() => onLog(session)}>View log</Button> },
  ]
  return (
    <Table
      caption="All vendor access requests and sessions, newest first"
      columns={columns}
      rows={sessions.rows}
      rowKey={(session) => session.id}
      loading={sessions.loading}
      error={tableError(sessions)}
      empty={{ title: 'Vendor staff have not asked for access yet.' }}
      pagination={sessions.pagination}
    />
  )
}

/** SC-14 Vendor access sessions (FR-IAM-005): decide requests, end open sessions, read each session's log. */
export function VendorAccessPage() {
  const { me } = useSession()
  const api = useApi()
  const toast = useToast()
  const [tab, selectTab] = useTabParam(TABS)
  const requests = usePagedList<SupportSession>(PATH, { state: 'requested' })
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const [version, setVersion] = useState(0)
  const tenantRegion = me.tenant?.region ?? null
  const changed = () => {
    setDialog(null)
    requests.reload()
    setVersion((count) => count + 1)
  }
  return (
    <>
      <PageHeader
        title="Vendor access"
        summary="Vendor staff have no standing access to your data. They ask, you decide, and every view in a session is logged here."
      />
      <Tabs label="Vendor access" idPrefix={ID_PREFIX} tabs={TABS} selected={tab} onSelect={selectTab} />
      <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
        {tab === 'requests' && <RequestsTab requests={requests} tenantRegion={tenantRegion} onDecide={(session, approve) => setDialog({ kind: 'decide', session, approve })} />}
        {tab === 'active' && <ActiveTab key={version} onEnd={(session) => setDialog({ kind: 'end', session })} onLog={(session) => setDialog({ kind: 'log', session })} />}
        {tab === 'history' && <HistoryTab key={version} onLog={(session) => setDialog({ kind: 'log', session })} />}
      </TabPanel>
      {dialog?.kind === 'decide' && (
        <SupportDecisionDialog session={dialog.session} approve={dialog.approve} tenantRegion={tenantRegion} onClose={() => setDialog(null)} onDecided={changed} />
      )}
      {dialog?.kind === 'log' && <SessionLogDialog session={dialog.session} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === 'end'}
        title="End vendor session"
        consequence="Vendor staff lose access at once. The session log stays available."
        confirmLabel="End session now"
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind !== 'end') return
          await api.post(`${PATH}/${dialog.session.id}/end`)
          toast({ message: 'The vendor session has ended.' })
          changed()
        }}
      />
    </>
  )
}
