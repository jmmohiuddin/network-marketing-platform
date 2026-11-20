'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { SegmentedControl } from '../../components/segmented-control'
import { StatusBadge } from '../../components/status-badge'
import { NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { formatDateTime } from '../../lib/format'
import { marketName, MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource, type Query } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { ExceptionsTab } from './exceptions-tab'
import { ATTRIBUTION_LABELS, moneyText, PURPOSE_LABELS, sourceText, volumesText } from './format'
import { OrderInspector, useConnectorNames, useMinorUnits } from './order-inspector'
import type { OrderListRow, OrderSummary } from './types'
import { VolumesTab } from './volumes-tab'
import { ColumnChooser, ListExport, type ColumnOption } from '../views/list-tools'
import { SavedViewsBar, type SavedView } from '../views/saved-views'

const ID_PREFIX = 'orders'
const FILTERS = ['market_id', 'source_system', 'purpose', 'flag', 'late', 'from', 'to'] as const
type Filter = (typeof FILTERS)[number]
type Filters = Readonly<Record<Filter, string>>
/** URL keys of the list's state: an opening without any of them gets the user's default view (a shared ?order= link keeps its inspector). */
const LIST_PARAMS = [...FILTERS, 'order', 'sort', 'columns', 'view'] as const

/** PLAN B6 2.5 order sorts, as GET /v1/orders and the export take them. */
const SORT_OPTIONS = [
  { value: 'credited_at_desc', label: 'Credited, newest first' },
  { value: 'credited_at_asc', label: 'Credited, oldest first' },
  { value: 'amount_desc', label: 'Amount, high to low' },
  { value: 'amount_asc', label: 'Amount, low to high' },
] as const
const DEFAULT_SORT = SORT_OPTIONS[0].value
/** The registry's order columns (PLAN B6 2.5), in its order; the order itself is always shown, as the row's link. */
const COLUMN_OPTIONS: readonly ColumnOption[] = [
  { key: 'source_order_id', label: 'Order', required: true }, { key: 'ordered_at', label: 'Ordered' }, { key: 'credited_at', label: 'Credited' },
  { key: 'market', label: 'Market' }, { key: 'buyer_ref', label: 'Buyer' }, { key: 'buyer_type', label: 'Buyer type' }, { key: 'purpose', label: 'Purpose' },
  { key: 'attributed_position_ref', label: 'Attributed to' }, { key: 'amount', label: 'Amount and volume' }, { key: 'tax', label: 'Tax' },
  { key: 'currency', label: 'Currency' }, { key: 'period', label: 'Period' }, { key: 'late', label: 'Status' }, { key: 'flags', label: 'Flags' },
]
const DEFAULT_COLUMNS = ['source_order_id', 'buyer_ref', 'credited_at', 'purpose', 'amount', 'attributed_position_ref', 'late']
const DENSITY_OPTIONS = [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]

/** The columns of ?columns= that the registry knows, the order first; the default set when none is valid. */
function columnsOf(param: string | null): readonly string[] {
  const chosen = COLUMN_OPTIONS.map((option) => option.key).filter((key) => (param ?? '').split(',').includes(key))
  return chosen.length === 0 ? DEFAULT_COLUMNS : chosen.includes('source_order_id') ? chosen : ['source_order_id', ...chosen]
}

/** The local day (YYYY-MM-DD) of an instant, moved by days: the inverse of dayStart for a saved view's from/to. */
function dayOf(value: unknown, plusDays = 0): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() + plusDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** The URL of a saved view: its API filters back as the filter form's values, its columns, sort and id. */
function viewParams(view: SavedView): Record<string, string | null> {
  const f = view.filters
  return {
    market_id: text(f.market_id), source_system: text(f.source_system), purpose: text(f.purpose), flag: text(f.flag),
    late: f.late === 'true' || f.late === true ? 'true' : null, from: dayOf(f.from), to: dayOf(f.to, -1),
    sort: view.sort, columns: view.columns.join(','), view: view.id, order: null,
  }
}

const PURPOSE_OPTIONS = [{ value: '', label: 'Any purpose' }, ...Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label }))]
const FLAG_OPTIONS = [{ value: '', label: 'Any' }, { value: 'purpose_missing', label: 'Purpose missing' }, { value: 'attribution_conflict', label: 'Attribution conflict' }]
const FILTER_LABELS: Readonly<Record<Filter, string>> = {
  market_id: 'Market', source_system: 'Source', purpose: 'Purpose', flag: 'Flag', late: 'Late', from: 'Credited from', to: 'Credited to',
}

/** A local calendar day as the instant it starts; `to` is exclusive, so the day after the chosen end. */
function dayStart(day: string, plusDays = 0): string | undefined {
  if (day === '') return undefined
  const date = new Date(`${day}T00:00`)
  date.setDate(date.getDate() + plusDays)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function apiQuery(filters: Filters): Query {
  return {
    market_id: filters.market_id || undefined,
    source_system: filters.source_system || undefined,
    purpose: filters.purpose || undefined,
    flag: filters.flag || undefined,
    late: filters.late === 'true' ? 'true' : undefined,
    from: dayStart(filters.from),
    to: dayStart(filters.to, 1),
  }
}

/** sc_31 4 KPI cards from GET /v1/orders/summary (market and dates of the filters). */
function OrderKpis({ query }: { readonly query: Query }) {
  const summary = useResource<OrderSummary>('/v1/orders/summary', { market_id: query?.market_id, from: query?.from, to: query?.to })
  const count = (value: number | undefined) => (value === undefined ? null : value.toLocaleString())
  const data = summary.data ?? undefined
  if (summary.error !== null) return <LoadFailure error={summary.error} onRetry={summary.reload} section />
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Orders" icon="shopping_bag" value={count(data?.orders)} footer={{ label: 'Purpose missing', value: count(data?.purpose_missing) ?? '—' }} />
      <KpiCard label="Held in exception queue" icon="pause_circle" value={count(data?.held)} detail="All markets" />
      <KpiCard label="Late items pending" icon="schedule" value={count(data?.late_pending)} detail="Credited in a committed period" />
      <KpiCard label="Attribution conflicts" icon="call_split" value={count(data?.attribution_conflict)} detail="Hint differs from the servicer" />
    </div>
  )
}

function OrdersTable({ query, columns, density, selected, hrefOf }: {
  readonly query: Query
  readonly columns: readonly string[]
  readonly density: 'compact' | 'comfortable'
  readonly selected: string | null
  readonly hrefOf: (id: string) => string
}) {
  const list = usePagedList<OrderListRow>('/v1/orders', query)
  const minorUnits = useMinorUnits()
  const connectorNames = useConnectorNames()
  const MONO = 'font-data-mono-sm text-data-mono-sm'
  const cells: Readonly<Record<string, DataTableColumn<OrderListRow>>> = {
    source_order_id: {
      key: 'source_order_id', header: 'Order', cell: (row) => (
        <div className="flex flex-col">
          <Link className={`${MONO} font-bold text-primary hover:underline break-all`} href={hrefOf(row.id)} scroll={false}>{row.source_order_id}</Link>
          <span className="font-caption text-caption text-secondary break-all">{sourceText(row.source_system, connectorNames)} · {row.market.code}</span>
        </div>
      ),
    },
    ordered_at: { key: 'ordered_at', header: 'Ordered', cell: (row) => <span className={`${MONO} text-secondary`}>{formatDateTime(row.ordered_at)}</span> },
    credited_at: { key: 'credited_at', header: 'Credited', cell: (row) => <span className={`${MONO} text-secondary`}>{formatDateTime(row.credited_at)}</span> },
    market: { key: 'market', header: 'Market', cell: (row) => row.market.code },
    buyer_ref: { key: 'buyer_ref', header: 'Buyer', cell: (row) => <div className="flex flex-col"><span className="font-medium">{row.buyer.display_name ?? row.buyer.external_ref}</span><span className="font-caption text-caption text-secondary">{row.buyer.external_ref}</span></div> },
    buyer_type: { key: 'buyer_type', header: 'Buyer type', cell: (row) => row.buyer_type.code },
    purpose: { key: 'purpose', header: 'Purpose', cell: (row) => (row.purpose_missing ? <StatusBadge state="under_review" label="Purpose missing" /> : PURPOSE_LABELS[row.purpose]) },
    attributed_position_ref: {
      key: 'attributed_position_ref', header: 'Attributed to', cell: (row) => (
        <div className="flex flex-col">
          <span className={MONO}>{row.attributed_position?.position_ref ?? '—'}</span>
          <span className="font-caption text-caption text-secondary">{row.attribution_source === null ? 'Not attributed' : ATTRIBUTION_LABELS[row.attribution_source]}</span>
        </div>
      ),
    },
    amount: {
      key: 'amount', header: 'Amount and volume', align: 'end', cell: (row) => (
        <div className="flex flex-col items-end">
          <span className={`${MONO} font-bold`}>{moneyText(row.amount_minor, row.currency, minorUnits.get(row.market.id))}</span>
          <span className="font-data-mono-sm text-[11px] text-tertiary font-semibold">{volumesText(row.volumes, minorUnits.get(row.market.id))}</span>
        </div>
      ),
    },
    tax: { key: 'tax', header: 'Tax', align: 'end', cell: (row) => <span className={MONO}>{moneyText(row.tax_minor, row.currency, minorUnits.get(row.market.id))}</span> },
    currency: { key: 'currency', header: 'Currency', cell: (row) => row.currency },
    period: { key: 'period', header: 'Period', cell: (row) => <span className={MONO}>{row.period_id === null ? '—' : shortId(row.period_id)}</span> },
    late: { key: 'late', header: 'Status', cell: (row) => (row.late ? <StatusBadge state="held" label="Late" /> : <StatusBadge state="committed" label="Recorded" />) },
    flags: {
      key: 'flags', header: 'Flags', cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.purpose_missing && <StatusBadge state="under_review" label="Purpose missing" />}
          {row.attribution_conflict && <StatusBadge state="under_review" label="Conflict" />}
          {!row.purpose_missing && !row.attribution_conflict && '—'}
        </div>
      ),
    },
  }
  return (
    <DataTable
      caption="Orders"
      density={density}
      selectedKey={selected ?? undefined}
      columns={columns.flatMap((key) => cells[key] ?? [])}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No orders match these filters' }}
      pagination={list.pagination}
    />
  )
}

function OrdersTab({ filters, update, selected, opening }: {
  readonly filters: Filters
  readonly update: (changes: Readonly<Record<string, string | null>>) => void
  readonly selected: string | null
  /** The page opened without list state in the URL: apply the user's default view. */
  readonly opening: boolean
}) {
  const params = useSearchParams()
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const sort = SORT_OPTIONS.find((option) => option.value === params.get('sort'))?.value ?? DEFAULT_SORT
  const columns = columnsOf(params.get('columns'))
  const pathname = usePathname()
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [draft, setDraft] = useState<Filters>(filters)
  const query = apiQuery(filters)
  const set = (key: Filter, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    update({ ...draft, order: null, view: null })
  }
  const marketLabel = (id: string) => markets.data?.find((market) => market.id === id)?.code ?? id
  const chips: FilterChip[] = FILTERS.filter((key) => filters[key] !== '').map((key) => ({
    key,
    label: `${FILTER_LABELS[key]}: ${key === 'market_id' ? marketLabel(filters[key]) : key === 'purpose' ? PURPOSE_LABELS[filters[key] as keyof typeof PURPOSE_LABELS] ?? filters[key] : key === 'late' ? 'yes' : filters[key]}`,
    onRemove: () => {
      setDraft((current) => ({ ...current, [key]: '' }))
      update({ [key]: null, order: null, view: null })
    },
  }))
  const listQuery = { ...query, sort }
  const saved = Object.fromEntries(Object.entries(query ?? {}).filter(([, value]) => value !== undefined))
  const hrefOf = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('order', id)
    return `${pathname}?${next.toString()}`
  }
  return (
    <div className="flex flex-col gap-space-md">
      <OrderKpis query={query} />
      <div className="flex flex-wrap items-end justify-between gap-space-sm">
        <SavedViewsBar list="orders" current={{ filters: saved, columns, sort }} activeId={params.get('view')} applyDefault={opening}
          onApply={(view) => update(viewParams(view))} />
        <div className="flex flex-wrap items-end gap-space-xs">
          <div className="w-56"><Select label="Sort" value={sort} options={SORT_OPTIONS} onChange={(event) => update({ sort: event.target.value, view: null, order: null })} /></div>
          <ColumnChooser options={COLUMN_OPTIONS} selected={columns} onApply={(chosen) => update({ columns: chosen.join(','), view: null })} />
          <SegmentedControl label="Row density" options={DENSITY_OPTIONS} value={density} onChange={(value) => setDensity(value === 'comfortable' ? 'comfortable' : 'compact')} />
          <ListExport label="Export orders" path="/v1/orders/export" query={{ ...listQuery, columns: columns.join(',') }} filename="orders.csv" />
        </div>
      </div>
      <form onSubmit={apply} noValidate>
        <FiltersBar label="Filter orders" chips={chips} onClear={() => {
          setDraft(Object.fromEntries(FILTERS.map((key) => [key, ''])) as Filters)
          update({ ...Object.fromEntries(FILTERS.map((key) => [key, null])), order: null, view: null })
        }} actions={<Button type="submit" icon="filter_list">Apply filters</Button>}>
          <Select label="Market" value={draft.market_id} options={[{ value: '', label: 'All markets' }, ...(markets.data ?? []).map((market) => ({ value: market.id, label: marketName(market) }))]} onChange={(event) => set('market_id', event.target.value)} />
          <TextInput label="Source system" value={draft.source_system} onChange={(event) => set('source_system', event.target.value)} />
          <Select label="Purpose" value={draft.purpose} options={PURPOSE_OPTIONS} onChange={(event) => set('purpose', event.target.value)} />
          <Select label="Flag" value={draft.flag} options={FLAG_OPTIONS} onChange={(event) => set('flag', event.target.value)} />
          <TextInput label="Credited from" type="date" value={draft.from} onChange={(event) => set('from', event.target.value)} />
          <TextInput label="Credited to" type="date" value={draft.to} onChange={(event) => set('to', event.target.value)} />
          <Checkbox label="Late orders only" checked={draft.late === 'true'} onChange={(event) => set('late', event.target.checked ? 'true' : '')} />
        </FiltersBar>
      </form>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
        <div className="xl:col-span-8 min-w-0">
          <OrdersTable key={JSON.stringify(listQuery)} query={listQuery} columns={columns} density={density} selected={selected} hrefOf={hrefOf} />
        </div>
        <div className="xl:col-span-4 min-w-0">
          {selected === null
            ? <p className="p-space-md rounded-lg bg-surface-container-low font-body-sm text-body-sm text-secondary">Choose an order to inspect its buyer, attribution, line volumes and events.</p>
            : <OrderInspector key={selected} orderId={selected} />}
        </div>
      </div>
    </div>
  )
}

/** SC-31 Orders and returns (FR-ORD-001..005): ingested orders, the exception queue and product volumes; tab in ?tab=. */
export function OrdersPage() {
  const { can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const readsOrders = can('order.read')
  const [opening, setOpening] = useState(() => !LIST_PARAMS.some((key) => params.has(key)))
  if (!readsOrders && !can('product.manage')) return <NotAvailable />
  const tabs = [
    ...(readsOrders ? [{ id: 'orders', label: 'Orders' }] : []),
    { id: 'exceptions', label: 'Exception queue' },
    { id: 'volumes', label: 'Product volumes' },
  ]
  const tab = tabs.find((candidate) => candidate.id === params.get('tab'))?.id ?? tabs[0]!.id
  const update = (changes: Readonly<Record<string, string | null>>) => {
    setOpening(false)
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`, { scroll: false })
  }
  const filters = Object.fromEntries(FILTERS.map((key) => [key, params.get(key) ?? ''])) as Filters
  return (
    <>
      <PageHeader title="Orders and returns" summary="Orders as received from your stores and systems: fixed facts with buyer type, purpose and attribution. Returns and refunds arrive as events." />
      <div>
        <Tabs label="Orders" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={(id) => router.replace(`${pathname}?tab=${id}`, { scroll: false })} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          {tab === 'orders' && <OrdersTab key={JSON.stringify(filters)} filters={filters} update={update} selected={params.get('order')} opening={opening} />}
          {tab === 'exceptions' && <ExceptionsTab />}
          {tab === 'volumes' && <VolumesTab />}
        </TabPanel>
      </div>
    </>
  )
}
