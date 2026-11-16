'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Button, LinkButton } from '../../../components/button'
import { DataTable, PaginationBar, type DataTableColumn } from '../../../components/data-table'
import { Icon } from '../../../components/icon'
import { KpiCard } from '../../../components/kpi-card'
import { ConfirmDialog } from '../../../components/modal'
import { PageHeader } from '../../../components/page-header'
import { RequestCard } from '../../../components/request-card'
import { EmptyState, LoadingState } from '../../../components/states'
import { StatusBadge } from '../../../components/status-badge'
import { useToast } from '../../../components/toast'
import { Banner } from '../../../components/banner'
import { useSession } from '../../../lib/session'
import { useNow } from '../../../lib/use-now'
import { useResource, type Resource } from '../../../lib/use-resource'
import { durationLabel, formatDateTime, personLabel, remainingLabel, shortId, supportScopeText, unapprovableAreas } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList, type PagedList } from '../resource'
import type { AuditEvent, SupportSession, TenantSupportSession } from '../types'
import { MONO, NOTE, NoticeCard, NumberedHeading } from '../ui'
import { outOfRegion, SupportDecisionDialog } from './decision-dialog'
import { logDetails, SessionLogDialog } from './session-log-dialog'

const COUNTDOWN_TICK_MS = 30_000
// shortcut: open (approved or active) sessions are read as one page of up to 200 each; page them if a tenant ever
// has more open at once.
const OPEN_PAGE_SIZE = 200
// The live trace shows the newest entries; the full log is one click away.
const TRACE_SIZE = 5
const PATH = '/v1/support-sessions'
const AUDIT_PATH = '/settings/audit'
const OPEN_HEADING_ID = 'access-open'

/** "Ada Vendor (ada@vendor.example)"; "Vendor user 1a2b3c4d" when the requester is not resolved. */
function requesterLabel(session: TenantSupportSession): string {
  return session.requester === null ? `Vendor user ${shortId(session.requester_id)}` : personLabel(session.requester)
}

type Dialogs =
  | { readonly kind: 'decide'; readonly session: TenantSupportSession; readonly approve: boolean }
  | { readonly kind: 'end'; readonly session: TenantSupportSession }
  | { readonly kind: 'log'; readonly session: TenantSupportSession }

function scopeText(session: SupportSession): string {
  return supportScopeText(session.scope.permissions)
}

/** Approved and active sessions, soonest end first. */
function useOpenSessions() {
  const active = useResource<TenantSupportSession[]>(PATH, { state: 'active', limit: OPEN_PAGE_SIZE })
  const approved = useResource<TenantSupportSession[]>(PATH, { state: 'approved', limit: OPEN_PAGE_SIZE })
  const rows = [...(active.data ?? []), ...(approved.data ?? [])].sort((left, right) => (left.ends_at ?? '').localeCompare(right.ends_at ?? ''))
  return {
    rows,
    loading: active.loading || approved.loading,
    error: active.error ?? approved.error,
    reload: () => {
      active.reload()
      approved.reload()
    },
  }
}

/** sc_14 KPI cards: open sessions with the soonest end (the support-session countdown is the one allowed), requests, region. */
function AccessKpis({ open, requests, region, now }: {
  readonly open: ReturnType<typeof useOpenSessions>
  readonly requests: PagedList<TenantSupportSession>
  readonly region: string | null
  readonly now: number
}) {
  const soonest = open.rows.find((session) => session.ends_at !== null)
  const requestCount = requests.loading || requests.error !== null ? null : `${requests.rows.length}${requests.pagination.hasNext ? '+' : ''}`
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
      <KpiCard
        label="Open vendor sessions"
        icon="lock_clock"
        value={open.loading || open.error !== null ? null : String(open.rows.length)}
        detail={soonest?.ends_at == null ? 'Nothing open now' : `First one ends in ${remainingLabel(soonest.ends_at, now, soonest.starts_at)}`}
      />
      <KpiCard label="Requests waiting" icon="hourglass_top" value={requestCount} detail="Denied automatically if nobody decides in time" />
      <KpiCard label="Your data region" icon="public" value={region} detail={region === null ? 'Not recorded' : 'Requests from elsewhere need your explicit approval'} />
    </div>
  )
}

function DecisionQueue({ requests, tenantRegion, onDecide }: {
  readonly requests: PagedList<TenantSupportSession>
  readonly tenantRegion: string | null
  readonly onDecide: (session: TenantSupportSession, approve: boolean) => void
}) {
  const { me, readOnly } = useSession()
  if (requests.error !== null) return <LoadFailure error={requests.error} onRetry={requests.reload} section />
  if (requests.loading) return <LoadingState label="Loading requests" />
  if (requests.rows.length === 0) return <EmptyState title="No requests. When vendor staff ask for access, the request appears here." />
  const { pagination } = requests
  return (
    <>
      <ul className="flex flex-col gap-space-md">
        {requests.rows.map((session) => {
          const blocked = unapprovableAreas(me, session.scope.permissions)
          return (
          <li key={session.id}>
            <RequestCard
              reference={shortId(session.id)}
              title="Vendor support request"
              state={<StatusBadge state="requested" label="Waiting for your decision" />}
              fields={[
                { label: 'Asked by', icon: 'badge', value: requesterLabel(session), detail: `Asked at ${formatDateTime(session.created_at)}` },
                { label: 'Areas asked for (view only)', icon: 'visibility', value: scopeText(session) },
                { label: 'Duration asked for', icon: 'timer', value: durationLabel(session.requested_minutes), detail: 'Starts when you approve and ends automatically' },
                {
                  label: 'Data region',
                  icon: 'public',
                  value: outOfRegion(session, tenantRegion) ? 'The requester works outside your data region. Approving needs your explicit region approval.' : 'Same as your data',
                },
              ]}
              reason={session.reason}
              actions={readOnly ? undefined : (
                <>
                  <Button variant="destructive" onClick={() => onDecide(session, false)}>Deny</Button>
                  {/* One primary action per view: only a single listed request's Approve is the primary. */}
                  {requests.rows.length === 1
                    ? <Button variant="primary" icon="verified_user" data-testid="primary-action" onClick={() => onDecide(session, true)}>Approve</Button>
                    : <Button icon="verified_user" onClick={() => onDecide(session, true)}>Approve</Button>}
                </>
              )}
            >
              <div className="p-space-md rounded bg-surface-container-lowest shadow-sm flex items-start gap-space-sm">
                <Icon name="shield_lock" size={20} className="text-tertiary shrink-0 mt-0.5" />
                <p className="font-body-sm text-body-sm text-on-surface-variant">Nothing can be accessed until you approve. Access is read-only and every view is logged here. A request nobody decides in time is denied automatically.</p>
              </div>
              {!readOnly && blocked.length > 0 && (
                <Banner tone="warning" title={`You cannot approve: ${supportScopeText(blocked)}`}>
                  You approve only areas you hold yourself for all markets. Ask an admin who holds them to approve, or deny the request.
                </Banner>
              )}
            </RequestCard>
          </li>
          )
        })}
      </ul>
      {(pagination.hasPrevious || pagination.hasNext) && <div className="rounded overflow-hidden"><PaginationBar label="Pages of requests" pagination={pagination} /></div>}
    </>
  )
}

/** sc_14 read-only request trace: the newest log entries of one session on the inverse surface. */
function Trace({ log }: { readonly log: Resource<AuditEvent[]> }) {
  if (log.error !== null) return <p className={NOTE}>The log could not be loaded. Open the full log to try again.</p>
  const events = (log.data ?? []).slice(0, TRACE_SIZE)
  return (
    <div className="bg-inverse-surface text-inverse-on-surface rounded p-space-sm font-data-mono-sm text-[11px] flex flex-col gap-1.5 overflow-x-auto" aria-busy={log.loading || undefined}>
      {log.loading && <span>Loading the log</span>}
      {!log.loading && events.length === 0 && <span>Nothing has been logged for this session yet.</span>}
      {events.map((event) => (
        <div key={event.seq} className="flex items-start gap-2">
          <span className="text-outline-variant shrink-0">{formatDateTime(event.occurred_at)}</span>
          <span className="truncate">{logDetails(event) || event.action}</span>
        </div>
      ))}
    </div>
  )
}

/** sc_14 active session monitor card. */
function OpenSessionCard({ session, now, onEnd, onLog }: {
  readonly session: TenantSupportSession
  readonly now: number
  readonly onEnd?: () => void
  readonly onLog: () => void
}) {
  const log = useResource<AuditEvent[]>(`${PATH}/${session.id}/log`, { limit: TRACE_SIZE })
  const titleId = `open-session-${session.id}`
  return (
    <li aria-labelledby={titleId} className="bg-surface-container-lowest rounded shadow-md overflow-hidden flex flex-col">
      <div className="p-space-md bg-surface-container flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <span className="px-2 py-0.5 rounded bg-primary-container text-on-primary font-data-mono-sm text-caption font-bold">{shortId(session.id)}</span>
          <h3 id={titleId} className="font-body-sm text-body-sm text-on-surface font-semibold">Vendor session</h3>
        </div>
        <StatusBadge state={session.state} label={session.state === 'approved' ? 'Approved, not used yet' : undefined} />
      </div>
      <div className="p-space-md flex flex-col gap-space-md">
        <div className="p-space-md rounded bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm">
          <div className="flex flex-col gap-0.5">
            <span className="font-caption text-caption text-on-surface-variant uppercase font-semibold">Session window</span>
            <span className={`${MONO} text-on-surface`}>Started {formatDateTime(session.starts_at)} · Ends {formatDateTime(session.ends_at)}</span>
          </div>
          {session.ends_at !== null && (
            <div className="text-right">
              <div className="font-data-mono-lg text-data-mono-lg text-on-surface font-bold">{remainingLabel(session.ends_at, now, session.starts_at)}</div>
              <span className="font-caption text-caption text-on-surface-variant">Time left</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-xs font-caption text-caption">
          <div className="bg-surface-container px-3 py-2 rounded sm:col-span-2">
            <span className="text-on-surface-variant block">Asked by</span>
            <span className="font-body-sm text-body-sm text-on-surface font-semibold block break-words">{requesterLabel(session)}</span>
          </div>
          <div className="bg-surface-container px-3 py-2 rounded">
            <span className="text-on-surface-variant block">Areas (view only)</span>
            <span className="font-body-sm text-body-sm text-on-surface font-semibold block">{scopeText(session)}</span>
          </div>
          <div className="bg-surface-container px-3 py-2 rounded">
            <span className="text-on-surface-variant block">Reason given</span>
            <span className="font-body-sm text-body-sm text-on-surface font-semibold block">{session.reason}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-space-sm font-caption text-caption">
            <span className="text-on-surface-variant font-semibold uppercase tracking-wider flex items-center gap-1"><Icon name="terminal" size={14} />Read-only request trace</span>
            <Button variant="tertiary" size="sm" onClick={onLog}>View log</Button>
          </div>
          <Trace log={log} />
        </div>
        {onEnd !== undefined && <Button variant="destructive" icon="cancel" className="w-full" onClick={onEnd}>End now</Button>}
      </div>
    </li>
  )
}

function SessionMonitor({ open, now, onEnd, onLog }: {
  readonly open: ReturnType<typeof useOpenSessions>
  readonly now: number
  readonly onEnd: (session: TenantSupportSession) => void
  readonly onLog: (session: TenantSupportSession) => void
}) {
  const { readOnly } = useSession()
  if (open.error !== null) return <LoadFailure error={open.error} onRetry={open.reload} section />
  if (open.loading) return <LoadingState label="Loading open sessions" />
  if (open.rows.length === 0) return <EmptyState title="No vendor session is open." />
  return (
    <ul className="flex flex-col gap-space-md">
      {open.rows.map((session) => (
        <OpenSessionCard key={session.id} session={session} now={now} onLog={() => onLog(session)} onEnd={readOnly ? undefined : () => onEnd(session)} />
      ))}
    </ul>
  )
}

function HistoryTable({ onLog }: { readonly onLog: (session: TenantSupportSession) => void }) {
  const sessions = usePagedList<TenantSupportSession>(PATH)
  const columns: readonly DataTableColumn<TenantSupportSession>[] = [
    { key: 'asked', header: 'Asked at', cell: (session) => <span className={`${MONO} text-primary`}>{formatDateTime(session.created_at)}</span> },
    { key: 'requester', header: 'Asked by', cell: requesterLabel },
    { key: 'reason', header: 'Reason', cell: (session) => session.reason },
    { key: 'scope', header: 'Areas (view only)', cell: scopeText },
    { key: 'window', header: 'Window', cell: (session) => (session.starts_at === null ? '—' : <span className={MONO}>{formatDateTime(session.starts_at)} to {formatDateTime(session.ends_at)}</span>) },
    { key: 'state', header: 'State', cell: (session) => <StatusBadge state={session.state} /> },
    { key: 'log', header: 'Log', align: 'end', cell: (session) => <Button variant="tertiary" size="sm" onClick={() => onLog(session)}>View log</Button> },
  ]
  return (
    <DataTable
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
  const requests = usePagedList<TenantSupportSession>(PATH, { state: 'requested' })
  const open = useOpenSessions()
  const now = useNow(COUNTDOWN_TICK_MS)
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const [version, setVersion] = useState(0)
  const tenantRegion = me.tenant?.region ?? null
  const changed = () => {
    setDialog(null)
    requests.reload()
    open.reload()
    setVersion((count) => count + 1)
  }
  const canReadAudit = me.navigation.some((entry) => entry.path === AUDIT_PATH)
  return (
    <>
      <PageHeader
        title="Vendor access"
        display
        summary="Vendor staff ask, you decide, and every view in a session is logged here."
        actions={canReadAudit ? <LinkButton href={AUDIT_PATH} icon="history_edu">View audit log</LinkButton> : undefined}
      />
      <NoticeCard icon="policy" title="Vendor staff have no standing access to your data">
        A support session is read-only, limited in time and starts only after one of your admins approves it. You can end it at any time.
      </NoticeCard>
      <AccessKpis open={open} requests={requests} region={tenantRegion} now={now} />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
        <section aria-labelledby="access-requests" className="xl:col-span-7 flex flex-col gap-space-md">
          <NumberedHeading id="access-requests" number={1} title="Requests waiting for your decision" />
          <DecisionQueue requests={requests} tenantRegion={tenantRegion} onDecide={(session, approve) => setDialog({ kind: 'decide', session, approve })} />
        </section>
        <section aria-labelledby={OPEN_HEADING_ID} className="xl:col-span-5 flex flex-col gap-space-md">
          <NumberedHeading id={OPEN_HEADING_ID} number={2} title="Open sessions" />
          <SessionMonitor open={open} now={now} onEnd={(session) => setDialog({ kind: 'end', session })} onLog={(session) => setDialog({ kind: 'log', session })} />
        </section>
      </div>
      <section aria-labelledby="access-history" className="flex flex-col gap-space-md">
        <NumberedHeading id="access-history" number={3} title="Session history" />
        <HistoryTable key={version} onLog={(session) => setDialog({ kind: 'log', session })} />
      </section>
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
        returnFocusTo={`#${OPEN_HEADING_ID}`}
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
