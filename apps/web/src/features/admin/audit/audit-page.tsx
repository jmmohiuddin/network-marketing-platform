'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button } from '../../../components/button'
import { Dialog } from '../../../components/dialog'
import { PageHeader } from '../../../components/page-header'
import { Table, type TableColumn } from '../../../components/table'
import { errorMessage, isNotAvailable } from '../../../lib/messages'
import { useSession } from '../../../lib/session'
import { useResource } from '../../../lib/use-resource'
import { actorLabel, formatDateTime, personLabel, shortId } from '../format'
import { LoadFailure } from '../page-states'
import { tableError, usePagedList } from '../resource'
import type { AuditEvent, ChainVerification, UserView } from '../types'
import { AuditFilterBar, filtersFrom, type AuditFilters } from './audit-filters'
import { AuditExportDialog } from './export-dialog'
import { ConsoleNav } from '../vendor/console-nav'

function objectLabel(event: AuditEvent): string {
  if (event.object_type === null) return '—'
  return event.object_id === null ? event.object_type : `${event.object_type} ${shortId(event.object_id)}`
}

// shortcut: names come from the first 200 users of the log's realm (GET /v1/users needs user.manage; vendor users
// read GET /v1/vendor-users) and the signed-in user; any other actor shows its kind and short id. Upgrade when audit
// events carry the actor's name.
const USER_PAGE_SIZE = 200
const TENANT_EVENTS_PATH = '/v1/audit-events'
const VENDOR_EVENTS_PATH = '/v1/vendor-audit-events'

/** Names of the users of the log's realm that the signed-in user may list; usersPath null: only their own. */
function useActorNames(usersPath: string | null): ReadonlyMap<string, string> {
  const { me } = useSession()
  const users = useResource<Pick<UserView, 'id' | 'email' | 'display_name'>[]>(usersPath, { limit: USER_PAGE_SIZE })
  return new Map([[me.user.id, personLabel(me.user)], ...(users.data ?? []).map((user) => [user.id, personLabel(user)] as const)])
}

function Json({ value }: { readonly value: unknown }) {
  return value === null || value === undefined ? <>—</> : <pre className="admin-json">{JSON.stringify(value, null, 2)}</pre>
}

/** SC-30 event drawer content: every recorded field of one event. */
function EventDialog({ event, names, onClose }: { readonly event: AuditEvent; readonly names: ReadonlyMap<string, string>; readonly onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={`Audit event ${event.seq}`} size="lg">
      <dl className="admin-details">
        <dt>Time</dt><dd>{formatDateTime(event.occurred_at)}</dd>
        <dt>Action</dt><dd>{event.action}</dd>
        <dt>Actor</dt><dd>{actorLabel(event, names)}{event.actor_id === null ? '' : <span className="admin-mono"> · {event.actor_type} {event.actor_id}</span>}</dd>
        <dt>Object</dt><dd className="admin-mono">{event.object_type ?? '—'}{event.object_id === null ? '' : ` ${event.object_id}`}</dd>
        <dt>Support session</dt><dd className="admin-mono">{event.support_session_id ?? '—'}</dd>
        <dt>Reason</dt><dd>{event.reason ?? '—'}</dd>
        <dt>Before</dt><dd><Json value={event.before} /></dd>
        <dt>After</dt><dd><Json value={event.after} /></dd>
        <dt>Request</dt><dd className="admin-mono">{event.request_id ?? '—'}</dd>
        <dt>Chain hash</dt><dd className="admin-mono">{event.hash ?? '—'}</dd>
      </dl>
    </Dialog>
  )
}

function EventsTable({ path, filters, names, onOpen }: {
  readonly path: string
  readonly filters: AuditFilters
  readonly names: ReadonlyMap<string, string>
  readonly onOpen: (event: AuditEvent) => void
}) {
  const events = usePagedList<AuditEvent>(path, filters)
  if (isNotAvailable(events.error)) return <LoadFailure error={events.error} onRetry={events.reload} section />
  const columns: readonly TableColumn<AuditEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (event) => <Button variant="tertiary" aria-label={`Open event ${event.seq}, ${event.action}`} onClick={() => onOpen(event)}>{formatDateTime(event.occurred_at)}</Button>,
    },
    { key: 'action', header: 'Action', cell: (event) => event.action },
    { key: 'actor', header: 'Actor', cell: (event) => actorLabel(event, names) },
    { key: 'object', header: 'Object', cell: objectLabel },
    { key: 'seq', header: 'Sequence', align: 'end', cell: (event) => event.seq },
  ]
  const filtered = Object.keys(filters).length > 0
  return (
    <Table
      caption={filtered ? 'Events matching the filters, newest first' : 'All events, newest first'}
      columns={columns}
      rows={events.rows}
      rowKey={(event) => event.seq}
      loading={events.loading}
      error={tableError(events)}
      empty={{ title: filtered ? 'No events match these filters. Clear the filters to see every event.' : 'No events recorded yet.' }}
      pagination={events.pagination}
    />
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

/** Filters in the URL, the events matching them and the event opened from the list: one audit log's search. */
function EventSearch({ path, usersPath }: { readonly path: string; readonly usersPath: string | null }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filters = filtersFrom(params)
  const filterKey = JSON.stringify(filters)
  const [opened, setOpened] = useState<AuditEvent | null>(null)
  const names = useActorNames(usersPath)
  function apply(next: AuditFilters) {
    const search = new URLSearchParams(next as Record<string, string>).toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  return (
    <>
      <AuditFilterBar key={`filters ${filterKey}`} applied={filters} onApply={apply} />
      <EventsTable key={`events ${filterKey}`} path={path} filters={filters} names={names} onOpen={setOpened} />
      {opened !== null && <EventDialog event={opened} names={names} onClose={() => setOpened(null)} />}
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
    <div className="admin-stack">
      <PageHeader
        title="Audit log"
        summary="Every security- and data-relevant action, append-only and hash-chained. Search by actor, action, object and time."
        actions={(
          <>
            <Button loading={verifying} onClick={verify}>Verify audit chain</Button>
            {!readOnly && can('export') && <Button onClick={() => setExporting(true)}>Export events</Button>}
          </>
        )}
      />
      {chain?.result !== undefined && <ChainResult result={chain.result} />}
      {chain?.error !== undefined && <Banner tone="danger" title="The chain could not be verified">{chain.error}</Banner>}
      <EventSearch path={TENANT_EVENTS_PATH} usersPath={can('user.manage') ? '/v1/users' : null} />
      {exporting && <AuditExportDialog filters={filters} onClose={() => setExporting(false)} />}
    </div>
  )
}

/**
 * Vendor audit log (BUG-012, FR-OPS-001, E-ADR-06): every vendor action and refused vendor access, from
 * GET /v1/vendor-audit-events, searched like the tenant's log. Actors are named from the vendor users.
 */
export function VendorAuditPage() {
  return (
    <>
      <ConsoleNav />
      <div className="admin-stack">
        <PageHeader
          title="Vendor audit log"
          summary="Every action of vendor users: provisioning, approvals, support sessions and refused access to tenant data. Append-only and hash-chained."
        />
        <EventSearch path={VENDOR_EVENTS_PATH} usersPath="/v1/vendor-users" />
      </div>
    </>
  )
}
