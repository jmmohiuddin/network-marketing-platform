'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Checkbox, Select } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { useResource, type Query } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { caseTypeLabel, readableTypes, reasonLabel, STATE_BADGES, STATE_LABELS, type CaseTypeInfo } from './format'
import { useRefLabel } from './refs'
import type { CaseCounts, CaseRecord, CaseState } from './types'

const ID_PREFIX = 'cases'
const ALL = 'all'
const STATE_OPTIONS = [{ value: '', label: 'All states' }, ...Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label }))]
const FILTER_KEYS = ['state', 'assigned', 'overdue', 'subject_type', 'subject_id'] as const

const sumOf = (rows: readonly CaseCounts[], field: keyof Omit<CaseCounts, 'type'>) => rows.reduce((total, row) => total + row[field], 0)

/** sc_06 4 KPI cards from GET /v1/cases/counts (the selected tab's type, or every readable type). */
function CaseKpis({ counts }: { readonly counts: readonly CaseCounts[] | null }) {
  const value = (field: keyof Omit<CaseCounts, 'type'>) => (counts === null ? null : String(sumOf(counts, field)))
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Open" icon="pending_actions" value={value('open')} detail="Being prepared" />
      <KpiCard label="Waiting for decision" icon="gavel" value={value('submitted')} detail="Submitted, a second person decides" />
      <KpiCard label="Overdue" icon="timer" value={value('overdue')} detail="Submitted and past the due date" />
      <KpiCard label="Decided in 30 days" icon="task_alt" value={value('decided_30d')} detail="Approved or rejected" />
    </div>
  )
}

/**
 * Which position or participant the case is about (BUG-070), with its kind under it.
 * shortcut: one GET per row (case rows carry only subject ids, PLAN B2 GET /v1/cases); add subject refs to the list to drop it.
 */
function SubjectCell({ subjectType, id }: { readonly subjectType: string; readonly id: string }) {
  const label = useRefLabel(subjectType, id)
  return (
    <div className="flex flex-col">
      <span className="font-data-mono-sm text-data-mono-sm">{label}</span>
      <span className="font-caption text-caption text-secondary capitalize">{subjectType}</span>
    </div>
  )
}

function caseColumns(myId: string) {
  return [
    {
      key: 'case', header: 'Case', cell: (row: CaseRecord) => (
        <div className="flex flex-col">
          <Link className="text-primary font-semibold hover:underline" href={`/cases/${row.id}`}>{caseTypeLabel(row.type)}</Link>
          <span className="font-data-mono-sm text-data-mono-sm text-secondary">{shortId(row.id)}</span>
        </div>
      ),
    },
    { key: 'subject', header: 'Subject', cell: (row: CaseRecord) => <SubjectCell subjectType={row.subject_type} id={row.subject_id} /> },
    { key: 'reason', header: 'Reason', cell: (row: CaseRecord) => reasonLabel(row.reason_code) },
    {
      key: 'opened', header: 'Opened', cell: (row: CaseRecord) => (
        <div className="flex flex-col"><span>{formatDateTime(row.created_at)}</span><span className="font-caption text-caption text-secondary">{row.opened_by_kind === 'system' ? 'By the system' : row.opened_by === myId ? 'By you' : 'By another user'}</span></div>
      ),
    },
    { key: 'assigned', header: 'Assigned', cell: (row: CaseRecord) => (row.assigned_to === null ? '—' : row.assigned_to === myId ? 'You' : 'Another user') },
    { key: 'due', header: 'Due', cell: (row: CaseRecord) => formatDateTime(row.due_at) },
    { key: 'state', header: 'State', cell: (row: CaseRecord) => <StatusBadge state={STATE_BADGES[row.state]} label={STATE_LABELS[row.state]} /> },
  ]
}

function CaseQueue({ query, myId }: { readonly query: Query; readonly myId: string }) {
  const list = usePagedList<CaseRecord>('/v1/cases', query)
  return (
    <DataTable
      caption="Case queue"
      columns={caseColumns(myId)}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No cases match these filters' }}
      pagination={list.pagination}
      stackOnPhone
    />
  )
}

/** SC-06 Cases (FR-CAS-001): KPI cards, a tab per readable registered type, filters in the URL, the queue. */
export function CasesPage() {
  const { me, can, readOnly } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const readable = readableTypes(can)
  const requested = params.get('type')
  const tab = readable.find((info) => info.type === requested)?.type ?? ALL
  const counts = useResource<CaseCounts[]>(readable.length === 0 ? null : '/v1/cases/counts')
  const subjectType = params.get('subject_type')
  const subjectId = params.get('subject_id')
  const subjectLabel = useRefLabel(subjectType, subjectId)
  if (readable.length === 0) return <NotAvailable />

  const update = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  const state = (Object.keys(STATE_LABELS) as CaseState[]).find((value) => value === params.get('state')) ?? ''
  const mine = params.get('assigned') === 'me'
  const overdue = params.get('overdue') === 'true'
  const tabCounts = (info: CaseTypeInfo | null) => {
    const rows = (counts.data ?? []).filter((row) => info === null || row.type === info.type)
    return counts.data === null ? {} : { count: sumOf(rows, 'open') + sumOf(rows, 'submitted') }
  }
  const tabs = [{ id: ALL, label: 'All cases', ...tabCounts(null) }, ...readable.map((info) => ({ id: info.type, label: info.plural, ...tabCounts(info) }))]
  const chips: FilterChip[] = [
    ...(state === '' ? [] : [{ key: 'state', label: `State: ${STATE_LABELS[state]}`, onRemove: () => update({ state: null }) }]),
    ...(mine ? [{ key: 'assigned', label: 'Assigned to me', onRemove: () => update({ assigned: null }) }] : []),
    ...(overdue ? [{ key: 'overdue', label: 'Overdue', onRemove: () => update({ overdue: null }) }] : []),
    ...(subjectId === null || subjectType === null ? [] : [{ key: 'subject', label: `Subject: ${subjectLabel ?? ''}`, onRemove: () => update({ subject_type: null, subject_id: null }) }]),
  ]
  const query: Query = {
    type: tab === ALL ? undefined : tab,
    state: state === '' ? undefined : state,
    assigned_to: mine ? me.user.id : undefined,
    overdue: overdue ? 'true' : undefined,
    subject_type: subjectType ?? undefined,
    subject_id: subjectId ?? undefined,
  }
  const canFile = !readOnly && can('case.genealogy.create')
  const kpiCounts = counts.data === null ? null : counts.data.filter((row) => tab === ALL || row.type === tab)
  return (
    <>
      <PageHeader
        title="Cases"
        summary="Genealogy changes, ownership transfers, duplicate reviews and restatements of committed periods. Each case keeps its evidence and history and is decided by a second person."
        actions={(
          <>
            {can('case.duplicate.read') && <LinkButton href="/cases/duplicates" icon="group_remove">Duplicate investigation</LinkButton>}
            {canFile && <LinkButton variant="primary" icon="add_circle" href="/cases/genealogy/new" data-testid="primary-action">File genealogy case</LinkButton>}
          </>
        )}
      />
      {counts.error === null ? <CaseKpis counts={kpiCounts} /> : <LoadFailure error={counts.error} onRetry={counts.reload} section />}
      <div>
        <Tabs label="Case types" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={(id) => update({ type: id === ALL ? null : id })} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          <div className="flex flex-col gap-space-md">
            <FiltersBar label="Filter cases" chips={chips} onClear={() => update(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])))}>
              <Select label="State" value={state} options={STATE_OPTIONS} onChange={(event) => update({ state: event.target.value })} />
              <Checkbox label="Assigned to me" checked={mine} onChange={(event) => update({ assigned: event.target.checked ? 'me' : null })} />
              <Checkbox label="Overdue only" checked={overdue} onChange={(event) => update({ overdue: event.target.checked ? 'true' : null })} />
            </FiltersBar>
            <CaseQueue key={JSON.stringify(query)} query={query} myId={me.user.id} />
          </div>
        </TabPanel>
      </div>
    </>
  )
}
