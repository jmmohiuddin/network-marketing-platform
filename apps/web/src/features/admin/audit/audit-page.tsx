'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { Drawer } from '../../../components/drawer'
import { Icon } from '../../../components/icon'
import { KpiCard } from '../../../components/kpi-card'
import { PageHeader } from '../../../components/page-header'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { errorMessage, isNotAvailable } from '../../../lib/messages'
import { useSession } from '../../../lib/session'
import { useResource } from '../../../lib/use-resource'
import { actorLabel, formatDateTime, personLabel, shortId } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList } from '../resource'
import type { AuditEvent, ChainVerification, UserView } from '../types'
import { CODE_BLOCK, MONO } from '../ui'
import { AuditFilterBar, filtersFrom, type AuditFilters } from './audit-filters'
import { AuditExportDialog } from './export-dialog'

function objectLabel(event: AuditEvent): string {
  if (event.object_type === null) return '—'
  return event.object_id === null ? event.object_type : `${event.object_type} ${shortId(event.object_id)}`
}

// shortcut: names come from the first 200 users of the log's realm (GET /v1/users needs user.manage; vendor users
// read GET /v1/vendor-users) and the signed-in user; any other actor shows its kind and short id. Upgrade when audit
// events carry the actor's name.
const USER_PAGE_SIZE = 200
// The table shows the start of each event's chain hash; the drawer shows all of it.
const HASH_PREFIX = 12
const NUMBER = new Intl.NumberFormat()
const TENANT_EVENTS_PATH = '/v1/audit-events'
const VENDOR_EVENTS_PATH = '/v1/vendor-audit-events'

/** Names of the users of the log's realm that the signed-in user may list; usersPath null: only their own. */
function useActorNames(usersPath: string | null): ReadonlyMap<string, string> {
  const { me } = useSession()
  const users = useResource<Pick<UserView, 'id' | 'email' | 'display_name'>[]>(usersPath, { limit: USER_PAGE_SIZE })
  return new Map([[me.user.id, personLabel(me.user)], ...(users.data ?? []).map((user) => [user.id, personLabel(user)] as const)])
}

function Json({ value }: { readonly value: unknown }) {
  return value === null || value === undefined ? <span className={MONO}>—</span> : <pre className={CODE_BLOCK}>{JSON.stringify(value, null, 2)}</pre>
}

/** sc_30 event inspector, as a Drawer: metadata grid, before/after side by side, chain hash in the proof box. */
function EventDrawer({ event, names, onClose }: { readonly event: AuditEvent; readonly names: ReadonlyMap<string, string>; readonly onClose: () => void }) {
  const rows: readonly { readonly label: string; readonly value: ReactNode }[] = [
    { label: 'Time', value: formatDateTime(event.occurred_at) },
    { label: 'Action', value: <span className={MONO}>{event.action}</span> },
    { label: 'Actor', value: <>{actorLabel(event, names)}{event.actor_id === null ? '' : <span className={`${MONO} block text-secondary`}>{event.actor_type} {event.actor_id}</span>}</> },
    { label: 'Object', value: <span className={`${MONO} break-all`}>{event.object_type ?? '—'}{event.object_id === null ? '' : ` ${event.object_id}`}</span> },
    { label: 'Support session', value: <span className={`${MONO} break-all`}>{event.support_session_id ?? '—'}</span> },
    { label: 'Reason', value: event.reason ?? '—' },
    { label: 'Request', value: <span className={`${MONO} break-all`}>{event.request_id ?? '—'}</span> },
  ]
  return (
    <Drawer open onClose={onClose} title={`Audit event ${event.seq}`} description={event.action} icon="history_edu" width="lg">
      <dl className="p-space-sm rounded bg-surface-container-low flex flex-col gap-space-xs">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-space-md">
            <dt className="text-secondary">{row.label}</dt>
            <dd className="text-on-surface min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="event-change" className="flex flex-col gap-space-xs">
        <h3 id="event-change" className="font-caption text-caption text-secondary uppercase tracking-wider font-semibold">Before and after</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
          <div className="flex flex-col gap-1"><span className="font-caption text-caption text-secondary">Before</span><Json value={event.before} /></div>
          <div className="flex flex-col gap-1"><span className="font-caption text-caption text-secondary">After</span><Json value={event.after} /></div>
        </div>
      </section>
      <section aria-labelledby="event-proof" className="p-space-sm rounded bg-surface-container-low flex flex-col gap-space-xs">
        <h3 id="event-proof" className="font-caption text-caption text-secondary uppercase tracking-wider font-semibold">Chain hash</h3>
        <span className={`${MONO} text-primary break-all`}>{event.hash ?? '—'}</span>
      </section>
    </Drawer>
  )
}

function EventsTable({ path, filters, names, opened, onOpen }: {
  readonly path: string
  readonly filters: AuditFilters
  readonly names: ReadonlyMap<string, string>
  /** Sequence number of the event open in the drawer (from the URL), or null. */
  readonly opened: string | null
  readonly onOpen: (seq: string | null) => void
}) {
  const events = usePagedList<AuditEvent>(path, filters)
  if (isNotAvailable(events.error)) return <LoadFailure error={events.error} onRetry={events.reload} section />
  const openedEvent = opened === null ? undefined : events.rows.find((event) => event.seq === opened)
  const columns: readonly DataTableColumn<AuditEvent>[] = [
    {
      key: 'event',
      header: 'Event / time',
      cell: (event) => (
        <div className="flex flex-col items-start">
          <Button variant="tertiary" size="sm" className="font-data-mono-sm" aria-label={`Open event ${event.seq}, ${event.action}`} onClick={() => onOpen(event.seq)}>#{event.seq}</Button>
          <span className={`${MONO} text-on-surface-variant font-normal whitespace-nowrap`}>{formatDateTime(event.occurred_at)}</span>
        </div>
      ),
    },
    { key: 'actor', header: 'Actor', cell: (event) => actorLabel(event, names) },
    { key: 'action', header: 'Action', cell: (event) => <span className="bg-surface-variant text-on-surface font-data-mono-sm text-[11px] px-1.5 py-0.5 rounded font-semibold">{event.action}</span> },
    { key: 'object', header: 'Target object', cell: (event) => <span className={`${MONO} text-on-surface`}>{objectLabel(event)}</span> },
    { key: 'hash', header: 'Chain hash', align: 'end', cell: (event) => <span className={`${MONO} text-on-surface-variant`}>{event.hash === undefined ? '—' : `${event.hash.slice(0, HASH_PREFIX)}…`}</span> },
  ]
  const filtered = Object.keys(filters).length > 0
  return (
    <section aria-labelledby="event-sequence" data-testid="card" className="bg-surface-container-lowest rounded shadow-sm overflow-hidden flex flex-col">
      <div className="px-space-md py-space-sm bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <Icon name="view_timeline" size={18} className="text-primary" />
          <h2 id="event-sequence" className="font-section-heading text-section-heading text-on-surface">Event sequence</h2>
        </div>
        <span className={`${MONO} text-on-surface-variant`}>Append-only: events are never changed or deleted</span>
      </div>
    <DataTable
      bare
      caption={filtered ? 'Events matching the filters, newest first' : 'All events, newest first'}
      columns={columns}
      rows={events.rows}
      rowKey={(event) => event.seq}
      loading={events.loading}
      error={tableError(events)}
      empty={{ title: filtered ? 'No events match these filters. Clear the filters to see every event.' : 'No events recorded yet.' }}
      pagination={events.pagination}
      stickyFirstColumn
    />
    {/* No route reads one event by number: a shared link opens it only while it is among the rows loaded here. */}
    {opened !== null && openedEvent === undefined && !events.loading && events.error === null && (
      <Banner tone="info" title={`Event ${opened} is not in this list`} action={<Button variant="tertiary" onClick={() => onOpen(null)}>Dismiss</Button>}>
        It is not among the events loaded for these filters. Narrow the filters (for example by time) to find it.
      </Banner>
    )}
    {openedEvent !== undefined && <EventDrawer event={openedEvent} names={names} onClose={() => onOpen(null)} />}
    </section>
  )
}

/** sc_30 KPI strip: what the last verification in this view found (nothing until it is run). */
function ChainKpis({ result }: { readonly result: ChainVerification | undefined }) {
  const state = result === undefined ? null : result.intact ? 'Intact' : 'Broken'
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <KpiCard
        label="Hash-chain state"
        icon={result === undefined ? 'lock' : result.intact ? 'check_circle' : 'error'}
        value={state}
        detail={result === undefined ? 'Not verified in this view yet. Run the verification to check every event.' : result.intact ? 'No event was changed or removed' : `Breaks at event ${result.first_broken_seq}`}
      />
      <KpiCard label="Events checked" icon="dataset" value={result === undefined ? null : NUMBER.format(BigInt(result.events))} detail={result === undefined ? 'Counted when the chain is verified' : 'Every event since the first'} />
      <KpiCard label="Verified at" icon="schedule" value={result === undefined ? null : formatDateTime(result.verified_at)} detail={result === undefined ? 'Not verified in this view yet' : 'By the server, over the whole log'} />
    </div>
  )
}

function ChainResult({ result }: { readonly result: ChainVerification }) {
  const checked = `${result.events} events checked at ${formatDateTime(result.verified_at)}.`
  if (result.intact && result.events === '0') return <Banner tone="info" title="Nothing to verify yet">No events have been recorded.</Banner>
  if (result.intact) return <Banner tone="success" title="The audit chain is intact">{checked} No event was changed or removed.</Banner>
  return (
    <Banner tone="danger" title="The audit chain is broken">
      The chain breaks at event {result.first_broken_seq}: that event or one before it was changed or removed. {checked} Tell your security contact and your vendor now.
    </Banner>
  )
}

const EVENT_PARAM = 'event'

/** Filters in the URL, the events matching them and the event opened from the list: one audit log's search. */
function EventSearch({ path, usersPath }: { readonly path: string; readonly usersPath: string | null }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filters = filtersFrom(params)
  const filterKey = JSON.stringify(filters)
  // The open event lives in the URL (?event=<seq>, guidelines 6.1 step 5) so a reload or a shared link reopens it;
  // the state mirrors it so the drawer opens at once (BUG-039).
  const [opened, setOpened] = useState<string | null>(params.get(EVENT_PARAM))
  const names = useActorNames(usersPath)
  function show(next: AuditFilters, event: string | null) {
    const search = new URLSearchParams({ ...next, ...(event === null ? {} : { [EVENT_PARAM]: event }) } as Record<string, string>).toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  function open(seq: string | null) {
    setOpened(seq)
    show(filters, seq)
  }
  function apply(next: AuditFilters) {
    setOpened(null)
    show(next, null)
  }
  return (
    <>
      <AuditFilterBar key={`filters ${filterKey}`} applied={filters} onApply={apply} />
      <EventsTable key={`events ${filterKey}`} path={path} filters={filters} names={names} opened={opened} onOpen={open} />
    </>
  )
}

/** SC-30 Audit log (FR-AUD-001/002, API-09): search, open an event, export within the row cap, verify the chain. */
export function AuditPage() {
  const { can, readOnly } = useSession()
  const api = useApi()
  const filters = filtersFrom(useSearchParams())
  const [exporting, setExporting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [chain, setChain] = useState<{ result?: ChainVerification; error?: string } | null>(null)
  async function verify() {
    setVerifying(true)
    try {
      const { data } = await api.get<ChainVerification>('/v1/audit-chain/verification')
      setChain({ result: data })
    } catch (error) {
      setChain({ error: errorMessage(error) })
    } finally {
      setVerifying(false)
    }
  }
  return (
    <>
      <PageHeader
        title="Audit log"
        summary="Every security- and data-relevant action, append-only and hash-chained. Search by actor, action, object and time."
        actions={(
          <>
            {!readOnly && can('export') && <Button icon="download" onClick={() => setExporting(true)}>Export events</Button>}
            <Button variant="primary" icon="sync" loading={verifying} data-testid="primary-action" onClick={verify}>Verify audit chain</Button>
          </>
        )}
      />
      <ChainKpis result={chain?.result} />
      {chain?.result !== undefined && <ChainResult result={chain.result} />}
      {chain?.error !== undefined && <Banner tone="danger" title="The chain could not be verified">{chain.error}</Banner>}
      <EventSearch path={TENANT_EVENTS_PATH} usersPath={can('user.manage') ? '/v1/users' : null} />
      {exporting && <AuditExportDialog filters={filters} onClose={() => setExporting(false)} />}
    </>
  )
}

/**
 * Vendor audit log (BUG-012, FR-OPS-001, E-ADR-06): every vendor action and refused vendor access, from
 * GET /v1/vendor-audit-events, searched like the tenant's log. Actors are named from the vendor users.
 */
export function VendorAuditPage() {
  return (
    <>
      <PageHeader
        title="Vendor audit log"
        summary="Every action of vendor users: provisioning, approvals, support sessions and refused access to tenant data. Append-only and hash-chained."
      />
      <EventSearch path={VENDOR_EVENTS_PATH} usersPath="/v1/vendor-users" />
    </>
  )
}
