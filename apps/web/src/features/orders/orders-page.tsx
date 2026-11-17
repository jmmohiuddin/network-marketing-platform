'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Checkbox, Select, TextInput } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { formatDateTime } from '../../lib/format'
import { marketName, MARKETS_PATH, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource, type Query } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { ExceptionsTab } from './exceptions-tab'
import { ATTRIBUTION_LABELS, moneyText, PURPOSE_LABELS, sourceText, volumesText } from './format'
import { OrderInspector, useConnectorNames, useMinorUnits } from './order-inspector'
import type { OrderListRow, OrderSummary } from './types'
import { VolumesTab } from './volumes-tab'

const ID_PREFIX = 'orders'
const FILTERS = ['market_id', 'source_system', 'purpose', 'flag', 'late', 'from', 'to'] as const
type Filter = (typeof FILTERS)[number]
type Filters = Readonly<Record<Filter, string>>

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

function OrdersTable({ query, selected, hrefOf }: { readonly query: Query; readonly selected: string | null; readonly hrefOf: (id: string) => string }) {
  const list = usePagedList<OrderListRow>('/v1/orders', query)
  const minorUnits = useMinorUnits()
  const connectorNames = useConnectorNames()
  return (
    <DataTable
      caption="Orders"
      density="compact"
      selectedKey={selected ?? undefined}
      columns={[
        {
          key: 'order', header: 'Order', cell: (row) => (
            <div className="flex flex-col">
              <Link className="font-data-mono-sm text-data-mono-sm font-bold text-primary hover:underline break-all" href={hrefOf(row.id)} scroll={false}>{row.source_order_id}</Link>
              <span className="font-caption text-caption text-secondary break-all">{sourceText(row.source_system, connectorNames)} · {row.market.code}</span>
            </div>
          ),
        },
        { key: 'buyer', header: 'Buyer and type', cell: (row) => <div className="flex flex-col"><span className="font-medium">{row.buyer.display_name ?? row.buyer.external_ref}</span><span className="font-caption text-caption text-secondary">{row.buyer.external_ref} · {row.buyer_type.code}</span></div> },
        { key: 'credited', header: 'Credited', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm text-secondary">{formatDateTime(row.credited_at)}</span> },
        { key: 'purpose', header: 'Purpose', cell: (row) => (row.purpose_missing ? <StatusBadge state="under_review" label="Purpose missing" /> : PURPOSE_LABELS[row.purpose]) },
        {
          key: 'amount', header: 'Amount and volume', align: 'end', cell: (row) => (
            <div className="flex flex-col items-end">
              <span className="font-data-mono-sm text-data-mono-sm font-bold">{moneyText(row.amount_minor, row.currency, minorUnits.get(row.market.id))}</span>
              <span className="font-data-mono-sm text-[11px] text-tertiary font-semibold">{volumesText(row.volumes)}</span>
            </div>
          ),
        },
        {
          key: 'attributed', header: 'Attributed to', cell: (row) => (
            <div className="flex flex-col">
              <span className="font-data-mono-sm text-data-mono-sm">{row.attributed_position?.position_ref ?? '—'}</span>
              <span className="font-caption text-caption text-secondary">{row.attribution_source === null ? 'Not attributed' : ATTRIBUTION_LABELS[row.attribution_source]}</span>
              {row.attribution_conflict && <StatusBadge state="under_review" label="Conflict" />}
            </div>
          ),
        },
        { key: 'events', header: 'Events', align: 'end', cell: (row) => row.events },
        { key: 'late', header: 'Status', cell: (row) => (row.late ? <StatusBadge state="held" label="Late" /> : <StatusBadge state="committed" label="Recorded" />) },
      ]}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No orders match these filters' }}
      pagination={list.pagination}
    />
  )
}

function OrdersTab({ filters, update, selected }: { readonly filters: Filters; readonly update: (changes: Readonly<Record<string, string | null>>) => void; readonly selected: string | null }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const markets = useResource<Market[]>(MARKETS_PATH)
  const [draft, setDraft] = useState<Filters>(filters)
  const query = apiQuery(filters)
  const set = (key: Filter, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    update({ ...draft, order: null })
  }
  const marketLabel = (id: string) => markets.data?.find((market) => market.id === id)?.code ?? id
  const chips: FilterChip[] = FILTERS.filter((key) => filters[key] !== '').map((key) => ({
    key,
    label: `${FILTER_LABELS[key]}: ${key === 'market_id' ? marketLabel(filters[key]) : key === 'purpose' ? PURPOSE_LABELS[filters[key] as keyof typeof PURPOSE_LABELS] ?? filters[key] : key === 'late' ? 'yes' : filters[key]}`,
    onRemove: () => {
      setDraft((current) => ({ ...current, [key]: '' }))
      update({ [key]: null, order: null })
    },
  }))
  const hrefOf = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('order', id)
    return `${pathname}?${next.toString()}`
  }
  return (
    <div className="flex flex-col gap-space-md">
      <OrderKpis query={query} />
      <form onSubmit={apply} noValidate>
        <FiltersBar label="Filter orders" chips={chips} onClear={() => {
          setDraft(Object.fromEntries(FILTERS.map((key) => [key, ''])) as Filters)
          update({ ...Object.fromEntries(FILTERS.map((key) => [key, null])), order: null })
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
          <OrdersTable key={JSON.stringify(query)} query={query} selected={selected} hrefOf={hrefOf} />
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
  if (!readsOrders && !can('product.manage')) return <NotAvailable />
  const tabs = [
    ...(readsOrders ? [{ id: 'orders', label: 'Orders' }] : []),
    { id: 'exceptions', label: 'Exception queue' },
    { id: 'volumes', label: 'Product volumes' },
  ]
  const tab = tabs.find((candidate) => candidate.id === params.get('tab'))?.id ?? tabs[0]!.id
  const update = (changes: Readonly<Record<string, string | null>>) => {
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
          {tab === 'orders' && <OrdersTab key={JSON.stringify(filters)} filters={filters} update={update} selected={params.get('order')} />}
          {tab === 'exceptions' && <ExceptionsTab />}
          {tab === 'volumes' && <VolumesTab />}
        </TabPanel>
      </div>
    </>
  )
}
