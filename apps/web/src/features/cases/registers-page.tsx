'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DataTable } from '../../components/data-table'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Select } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { isApiError } from '../../lib/api'
import { useCursorPages } from '../../lib/cursor-pages'
import { formatDateTime, formatDay } from '../../lib/format'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource, type Query } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { MONO, NOTE } from '../admin/ui'
import { BASIS_STATUS, inScope, marketScope } from '../markets/format'
import type { BasisStatus } from '../markets/types'
import { ListExport } from '../views/list-tools'
import { reasonLabel, STATE_BADGES } from './format'
import { CHANNEL_LABELS, GRIEVANCE_STATE, GrievanceDeadlines, OUTCOME_LABELS, type GrievanceRow } from './grievance'
import type { CaseState } from './types'

const ID_PREFIX = 'registers'
const LINK = 'text-primary font-semibold hover:underline'
const STATES: readonly CaseState[] = ['open', 'submitted', 'approved', 'rejected', 'withdrawn']
const OVERDUE_LABELS: Readonly<Record<string, string>> = { ack: 'Acknowledgement overdue', resolution: 'Resolution overdue' }
const FIELD_LABELS: Readonly<Record<string, string>> = { external_ref: 'Reference', display_name: 'Name', terminated_on: 'Terminated on' }

type DelistedField = 'external_ref' | 'display_name' | 'terminated_on'

/** GET /v1/registers/delisted: the pack rule and the rows with the rule's fields only. */
interface Delisted {
  readonly rule: { readonly id: string; readonly fields: readonly DelistedField[]; readonly window_days: number | null; readonly basis_status: BasisStatus }
  readonly rows: readonly ({ readonly participant_id: string } & Partial<Readonly<Record<DelistedField, string | null>>>)[]
}

type Update = (changes: Readonly<Record<string, string | null>>) => void

function GrievanceTable({ query, markets }: { readonly query: Query; readonly markets: readonly Market[] }) {
  const list = usePagedList<GrievanceRow>('/v1/registers/grievances', query)
  const code = (id: string) => markets.find((market) => market.id === id)?.code ?? shortId(id)
  return (
    <DataTable
      caption="Grievance register"
      columns={[
        { key: 'case', header: 'Grievance', cell: (row) => <Link className={`${MONO} ${LINK}`} href={`/cases/${row.case_id}`}>{shortId(row.case_id)}</Link> },
        { key: 'complainant', header: 'Complainant', cell: (row) => (row.subject.type === 'market' ? 'Not on record'
          : <Link className={`${MONO} ${LINK}`} href={`/people/${row.subject.id}`}>{row.subject.external_ref ?? shortId(row.subject.id)}</Link>) },
        { key: 'market', header: 'Market', cell: (row) => <span className={MONO}>{code(row.market_id)}</span> },
        { key: 'category', header: 'Category', cell: (row) => <span className="flex flex-col"><span>{reasonLabel(row.category)}</span><span className="font-caption text-caption text-secondary">{CHANNEL_LABELS[row.channel] ?? row.channel}{row.external_ref === null ? '' : ` · ${row.external_ref}`}</span></span> },
        { key: 'received', header: 'Received', cell: (row) => <span className={MONO}>{formatDateTime(row.received_at)}</span> },
        { key: 'deadlines', header: 'Deadlines', cell: (row) => <GrievanceDeadlines row={row} /> },
        { key: 'state', header: 'State', cell: (row) => <StatusBadge state={STATE_BADGES[row.state]} label={row.outcome === null ? GRIEVANCE_STATE[row.state] : `Resolved: ${OUTCOME_LABELS[row.outcome].toLowerCase()}`} /> },
      ]}
      rows={list.rows}
      rowKey={(row) => row.case_id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No grievance matches these filters' }}
      pagination={list.pagination}
      stackOnPhone
    />
  )
}

/** Grievances tab: market, state and overdue filters in the URL, the register and "Export register" (same filters, audited). */
function GrievancesTab({ params, update, markets }: { readonly params: URLSearchParams; readonly update: Update; readonly markets: readonly Market[] }) {
  const market = markets.find((candidate) => candidate.id === params.get('market'))
  const state = STATES.find((candidate) => candidate === params.get('state')) ?? null
  const overdue = params.get('overdue') === 'ack' || params.get('overdue') === 'resolution' ? params.get('overdue')! : null
  const query = { market_id: market?.id, state: state ?? undefined, overdue: overdue ?? undefined }
  const chips: FilterChip[] = [
    ...(market === undefined ? [] : [{ key: 'market', label: `Market: ${market.code}`, onRemove: () => update({ market: null }) }]),
    ...(state === null ? [] : [{ key: 'state', label: `State: ${GRIEVANCE_STATE[state]}`, onRemove: () => update({ state: null }) }]),
    ...(overdue === null ? [] : [{ key: 'overdue', label: OVERDUE_LABELS[overdue]!, onRemove: () => update({ overdue: null }) }]),
  ]
  return (
    <div className="flex flex-col gap-space-md">
      <p className={NOTE}>Every grievance recorded in your markets with the deadlines of its market pack: acknowledge by, resolve by, and whether either has passed.</p>
      <FiltersBar label="Filter the register" chips={chips} onClear={() => update({ market: null, state: null, overdue: null })}>
        <Select label="Market" value={market?.id ?? ''} options={[{ value: '', label: 'All markets' }, ...markets.map((candidate) => ({ value: candidate.id, label: marketName(candidate) }))]}
          onChange={(event) => update({ market: event.target.value })} />
        <Select label="State" value={state ?? ''} options={[{ value: '', label: 'All states' }, ...STATES.map((value) => ({ value, label: GRIEVANCE_STATE[value] }))]}
          onChange={(event) => update({ state: event.target.value })} />
        <Select label="Overdue" value={overdue ?? ''} options={[{ value: '', label: 'Any' }, ...Object.entries(OVERDUE_LABELS).map(([value, label]) => ({ value, label }))]}
          onChange={(event) => update({ overdue: event.target.value })} />
      </FiltersBar>
      <div className="flex justify-end">
        <ListExport label="Export register" path="/v1/registers/grievances/export" query={query} filename="grievance-register.csv" />
      </div>
      <GrievanceTable key={JSON.stringify(query)} query={query} markets={markets} />
    </div>
  )
}

function DelistedTable({ marketId }: { readonly marketId: string }) {
  const pages = useCursorPages()
  const register = useResource<Delisted>('/v1/registers/delisted', { market_id: marketId, cursor: pages.cursor })
  if (isApiError(register.error, 'REGISTER_NOT_ENABLED')) {
    return <EmptyState title="Not enabled for this market's pack">The market pack keeps no delisted-seller register for this market.</EmptyState>
  }
  if (register.error !== null) return <LoadFailure error={register.error} onRetry={register.reload} section />
  if (register.data === null) return <LoadingState label="Loading the delisted sellers" />
  const { rule, rows } = register.data
  const nextCursor = typeof register.meta.next_cursor === 'string' ? register.meta.next_cursor : null
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <p className={NOTE}>
          Participants of this market whose every position is terminated{rule.window_days === null ? '' : `, terminated in the last ${rule.window_days} days`}. Only the fields the pack rule names are shown. Basis status of the pack rule:{' '}
          <StatusBadge {...BASIS_STATUS[rule.basis_status]} />
        </p>
        <ListExport label="Export CSV" path="/v1/registers/delisted/export" query={{ market_id: marketId }} filename="delisted-register.csv" />
      </div>
      <DataTable
        caption="Delisted sellers"
        columns={rule.fields.map((field) => ({
          key: field, header: FIELD_LABELS[field] ?? field,
          cell: (row: Delisted['rows'][number]) => field === 'terminated_on' ? (row.terminated_on == null ? '—' : formatDay(row.terminated_on)) : <span className={field === 'display_name' ? undefined : MONO}>{row[field] ?? '—'}</span>,
        }))}
        rows={rows}
        rowKey={(row) => row.participant_id}
        loading={register.loading}
        empty={{ title: 'No delisted seller in this market' }}
        pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
        stackOnPhone
      />
    </>
  )
}

/** Delisted sellers tab: one market at a time (the pack decides whether it keeps the register and which fields it shows). */
function DelistedTab({ params, update, markets }: { readonly params: URLSearchParams; readonly update: Update; readonly markets: readonly Market[] }) {
  const market = markets.find((candidate) => candidate.id === params.get('market')) ?? markets[0]
  if (market === undefined) return <EmptyState title="No market in your scope">Your roles do not grant register access in any market.</EmptyState>
  return (
    <div className="flex flex-col gap-space-md">
      <div className="w-64 max-w-full">
        <Select label="Market" value={market.id} options={markets.map((candidate) => ({ value: candidate.id, label: marketName(candidate) }))} onChange={(event) => update({ market: event.target.value })} />
      </div>
      <DelistedTable key={market.id} marketId={market.id} />
    </div>
  )
}

/** /cases/registers (FR-CPL-013): the grievance register and the delisted-seller register of the market packs. */
export function RegistersPage() {
  const { me, can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const tabs = [
    ...(can('case.grievance.read') ? [{ id: 'grievances', label: 'Grievances' }] : []),
    ...(can('register.read') ? [{ id: 'delisted', label: 'Delisted sellers' }] : []),
  ]
  const tab = tabs.find((candidate) => candidate.id === params.get('tab'))?.id ?? tabs[0]?.id
  const markets = useResource<Market[]>(tab === undefined ? null : MARKETS_PATH)
  if (tab === undefined) return <NotAvailable />
  if (markets.error !== null) return <LoadFailure error={markets.error} onRetry={markets.reload} />
  if (markets.data === null) return <LoadingState label="Loading the registers" />
  const scope = marketScope(me, tab === 'grievances' ? 'case.grievance.read' : 'register.read')
  const scoped = markets.data.filter((market) => inScope(scope, market.id))
  const update: Update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        title="Registers"
        breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Registers' }]}
        summary="Registers the market packs require: grievances with their response deadlines, and sellers whose positions are all terminated. Exports are recorded in the audit log; publishing them is up to you."
      />
      <div className="bg-surface-container-lowest rounded-xl shadow-sm min-w-0" data-testid="card">
        <Tabs label="Registers" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={(id) => router.replace(`${pathname}?tab=${id}`)} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          <div className="p-space-md">
            {tab === 'grievances' ? <GrievancesTab params={params} update={update} markets={scoped} /> : <DelistedTab params={params} update={update} markets={scoped} />}
          </div>
        </TabPanel>
      </div>
    </div>
  )
}
