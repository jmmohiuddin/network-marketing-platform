'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Select, TextInput } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { usePagedList, tableError } from '../admin/resource'
import { MONO } from '../admin/ui'
import { PARTICIPANT_TYPES_PATH, type ParticipantType } from '../admin/settings/types'
import { EnrolDialog } from './enrol-dialog'
import { participantBadge } from './format'
import { PARTICIPANTS_PATH, type ParticipantRow } from './types'
import { useQueryParams } from './url'

const COLUMNS: readonly DataTableColumn<ParticipantRow>[] = [
  {
    key: 'ref', header: 'Reference', cell: (row) => (
      <Link href={`/people/${row.id}`} className={`${MONO} text-primary hover:underline`}>{row.external_ref}</Link>
    ),
  },
  { key: 'name', header: 'Name', cell: (row) => row.display_name ?? '—' },
  { key: 'market', header: 'Market', cell: (row) => <span className={MONO}>{row.market.code}</span> },
  { key: 'type', header: 'Type', cell: (row) => (row.current_type === null ? 'No type today' : `${row.current_type.name} (${row.current_type.code})`) },
  { key: 'positions', header: 'Positions', align: 'end', cell: (row) => (row.positions.count === 0 ? '0' : `${row.positions.count} (${row.positions.active} active)`) },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge {...participantBadge(row.status)} /> },
  { key: 'enrolled', header: 'Enrolled', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.enrolled_at)}</span> },
]

interface Filters {
  readonly q: string
  readonly market_id: string
  readonly type_code: string
}

function ParticipantTable({ filters, filtered }: { readonly filters: Filters; readonly filtered: boolean }) {
  const list = usePagedList<ParticipantRow>(PARTICIPANTS_PATH, {
    q: filters.q || undefined, market_id: filters.market_id || undefined, type_code: filters.type_code || undefined,
  })
  return (
    <DataTable
      caption="Participants" columns={COLUMNS} rows={list.rows} rowKey={(row) => row.id} loading={list.loading}
      error={tableError(list)} pagination={list.pagination}
      empty={{ title: filtered ? 'No participant matches these filters.' : 'No participant is enrolled yet.' }}
    />
  )
}

/**
 * People list (PLAN B2 5, no Stitch drawing: guidelines §9 with the sc_28 table and sc_30 filter console): search by
 * reference or name, market and type filters in the URL, and "Enrol participant" for participant.manage.
 */
export function PeopleList() {
  const { can, readOnly } = useSession()
  const router = useRouter()
  const [params, update] = useQueryParams()
  const filters: Filters = { q: params.get('q') ?? '', market_id: params.get('market') ?? '', type_code: params.get('type') ?? '' }
  const [search, setSearch] = useState(filters.q)
  const [enrolling, setEnrolling] = useState(false)
  const markets = useResource<readonly Market[]>(MARKETS_PATH)
  const types = useResource<readonly ParticipantType[]>(PARTICIPANT_TYPES_PATH, { state: 'active' })
  const marketCode = markets.data?.find((market) => market.id === filters.market_id)?.code ?? filters.market_id
  const chips: FilterChip[] = [
    ...(filters.q === '' ? [] : [{ key: 'q', label: `Search: ${filters.q}`, onRemove: () => { setSearch(''); update({ q: null }) } }]),
    ...(filters.market_id === '' ? [] : [{ key: 'market', label: `Market: ${marketCode}`, onRemove: () => update({ market: null }) }]),
    ...(filters.type_code === '' ? [] : [{ key: 'type', label: `Type: ${filters.type_code}`, onRemove: () => update({ type: null }) }]),
  ]
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    update({ q: search.trim() })
  }
  return (
    <>
      <PageHeader
        title="People"
        summary="Participants of your markets: their references, types and positions. Contact details stay masked."
        actions={can('participant.manage') && !readOnly
          ? <Button variant="primary" icon="person_add" data-testid="primary-action" onClick={() => setEnrolling(true)}>Enrol participant</Button>
          : undefined}
      />
      <FiltersBar label="Filter participants" chips={chips} onClear={() => { setSearch(''); update({ q: null, market: null, type: null }) }}>
        <form role="search" className="md:col-span-2 flex items-end gap-space-xs" onSubmit={submit}>
          <div className="flex-1 min-w-0">
            <TextInput label="Reference or name" icon="search" type="search" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Select label="Market" value={filters.market_id} onChange={(event) => update({ market: event.target.value })}
          options={[{ value: '', label: 'All markets' }, ...(markets.data ?? []).map((market) => ({ value: market.id, label: market.code }))]} />
        <Select label="Type" value={filters.type_code} onChange={(event) => update({ type: event.target.value })}
          options={[{ value: '', label: 'All types' }, ...(types.data ?? []).map((type) => ({ value: type.code, label: `${type.name} (${type.code})` }))]} />
      </FiltersBar>
      <ParticipantTable key={`${filters.q}|${filters.market_id}|${filters.type_code}`} filters={filters} filtered={chips.length > 0} />
      {enrolling && <EnrolDialog markets={markets.data ?? []} types={types.data ?? []} onClose={() => setEnrolling(false)} onEnrolled={(id) => router.push(`/people/${id}`)} />}
    </>
  )
}
