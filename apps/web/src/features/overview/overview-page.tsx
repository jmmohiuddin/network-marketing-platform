'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Banner } from '../../components/banner'
import { ChartCard, Legend } from '../../components/charts'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { countLabel } from '../../lib/format'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { inScope, marketScope } from '../markets/format'
import { isFinished, marketMoney, periodName, periodText, PERIOD_STATE_LABELS } from '../periods/format'
import type { Calendar, PeriodList } from '../periods/types'
import { DefinitionPopover, definitionsOf } from './definition'
import { TrendChart } from './trend-chart'
import type { Definition, ExecutiveDashboard, ExecutiveRow, PeriodRef } from './types'

const PERIOD_LIMIT = 200
const MONO = 'font-data-mono-sm text-data-mono-sm'
const CARD = 'bg-surface-container-lowest p-space-md rounded shadow-sm flex flex-col gap-space-sm'

const percent = (value: string | null) => (value === null ? null : `${value} %`)

/** The retail share in words when it has no value (D-B6-07 retail_share_reason). */
function retailShareNote(row: ExecutiveRow) {
  if (row.retail_share_reason === 'no_snapshot') {
    return <>No compliance snapshot for this period. <Link className="text-primary font-semibold hover:underline" href="/compliance">Open compliance reports</Link></>
  }
  return row.retail_share_reason === 'no_value' ? 'The compliance snapshot has no value for this month.' : undefined
}

/** A period named in its calendar's zone when the calendar is known, else by its exact bounds. */
function periodNamer(calendars: readonly Calendar[]) {
  return (period: PeriodRef, calendarId: string) => {
    const zone = calendars.find((calendar) => calendar.id === calendarId)?.cutoff_time_zone
    return zone === undefined ? periodText(period, undefined) : periodName(period.starts_at, period.ends_at, zone)
  }
}

/** A trend axis label in the calendar's zone ("Sep 2026", a week "Sep 7"), never the UTC month of the start instant. */
function periodShortener(calendars: readonly Calendar[]) {
  return (period: PeriodRef, calendarId: string) => {
    const calendar = calendars.find((candidate) => candidate.id === calendarId)
    const parts: Intl.DateTimeFormatOptions = calendar?.cadence === 'weekly' ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }
    return new Intl.DateTimeFormat(undefined, { ...parts, timeZone: calendar?.cutoff_time_zone }).format(new Date(period.starts_at))
  }
}

/** sc_35 "5 Executive KPI Strip" for one market's row, each figure with its definition. */
function Kpis({ row, definitions }: { readonly row: ExecutiveRow; readonly definitions: ReadonlyMap<string, Definition> }) {
  const money = { currency: row.market.currency, minor_unit: row.market.minor_unit }
  const define = (key: string) => <DefinitionPopover definition={definitions.get(key)} />
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-space-sm" data-testid="kpis">
      <KpiCard label="Net sales" icon="storefront" value={marketMoney(row.net_sales_minor, money)}>{define('net_sales_minor')}</KpiCard>
      <KpiCard label="Commission paid" icon="payments" value={row.payout_minor === null ? null : marketMoney(row.payout_minor, money)}>{define('payout_minor')}</KpiCard>
      <KpiCard label="Payout share of sales" icon="percent" value={percent(row.payout_share_pct)}
        detail={row.payout_share_pct === null ? 'Net sales are zero or less.' : undefined}>{define('payout_share_pct')}</KpiCard>
      <KpiCard label="Retail share" icon="shopping_bag" value={percent(row.retail_share_pct)} detail={retailShareNote(row)}>{define('retail_share_pct')}</KpiCard>
      <KpiCard label="Active earners" icon="group" value={row.active_earners.toLocaleString()}>{define('active_earners')}</KpiCard>
    </div>
  )
}

/** Partial-data banner: a market whose order sync is behind or failing may lack orders in its figures. */
function PartialBanner({ rows, definition }: { readonly rows: readonly ExecutiveRow[]; readonly definition: Definition | undefined }) {
  const partial = rows.filter((row) => row.partial)
  if (partial.length === 0) return null
  return (
    <Banner tone="warning" title="Some figures may lack orders">
      <ul>
        {partial.map((row) => (
          <li key={row.market.id}>{row.market.code}: {row.partial_reasons.map((reason) => `${reason.name} is ${reason.state}`).join(', ')}.</li>
        ))}
      </ul>
      {definition !== undefined && <p>{definition.definition}</p>}
    </Banner>
  )
}

function Trend({ data, row, name, short }: {
  readonly data: NonNullable<ExecutiveDashboard['trend']>
  readonly row: ExecutiveRow
  readonly name: (period: PeriodRef) => string
  readonly short: (period: PeriodRef) => string
}) {
  const money = { currency: row.market.currency, minor_unit: row.market.minor_unit }
  const columns: readonly DataTableColumn<(typeof data)[number]>[] = [
    { key: 'period', header: 'Period', cell: (point) => name(point.period) },
    { key: 'sales', header: `Net sales (${money.currency})`, align: 'end', cell: (point) => marketMoney(point.net_sales_minor, money) },
    { key: 'payout', header: `Commission paid (${money.currency})`, align: 'end', cell: (point) => marketMoney(point.payout_minor, money) },
    { key: 'share', header: 'Payout share of sales', align: 'end', cell: (point) => percent(point.payout_share_pct) ?? '—' },
    { key: 'earners', header: 'Active earners', align: 'end', cell: (point) => point.active_earners.toLocaleString() },
  ]
  return (
    <ChartCard
      headingLevel={2}
      title={`Last ${countLabel(data.length, 'finished period')} of ${row.market.code}`}
      summary="Net sales of each finished period as bars and the commission paid as a share of those sales as a line, oldest first."
      legend={<Legend items={[{ name: `Net sales (${money.currency})`, series: 'a' }, { name: 'Payout share of sales (%)', series: 'b' }]} />}
      table={<DataTable bare density="compact" caption={`Finished periods of ${row.market.code}`} columns={columns} rows={data} rowKey={(point) => point.period.id} empty={{ title: 'No finished period' }} />}
    >
      <TrendChart name={`Finished periods of ${row.market.code}`} currency={money.currency} minorUnit={money.minor_unit}
        points={data.map((point) => ({ id: point.period.id, label: short(point.period), salesMinor: point.net_sales_minor, sharePct: point.payout_share_pct }))} />
    </ChartCard>
  )
}

function MarketTable({ rows, name }: { readonly rows: readonly ExecutiveRow[]; readonly name: (row: ExecutiveRow) => string }) {
  const money = (row: ExecutiveRow) => ({ currency: row.market.currency, minor_unit: row.market.minor_unit })
  const columns: readonly DataTableColumn<ExecutiveRow>[] = [
    { key: 'market', header: 'Market', cell: (row) => <span className={`${MONO} px-1.5 py-0.5 bg-surface-container rounded text-secondary`}>{row.market.code}</span> },
    {
      key: 'period', header: 'Period', cell: (row) => (
        <span className="flex flex-col"><span className="whitespace-nowrap">{name(row)}</span><span className="font-caption text-caption text-secondary">{PERIOD_STATE_LABELS[row.period.state as keyof typeof PERIOD_STATE_LABELS] ?? row.period.state}</span></span>
      ),
    },
    { key: 'sales', header: 'Net sales', align: 'end', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{marketMoney(row.net_sales_minor, money(row))}</span> },
    { key: 'payout', header: 'Commission paid', align: 'end', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{marketMoney(row.payout_minor, money(row))}</span> },
    { key: 'share', header: 'Payout share', align: 'end', cell: (row) => <span className={`${MONO} font-semibold`}>{percent(row.payout_share_pct) ?? '—'}</span> },
    { key: 'retail', header: 'Retail share', align: 'end', cell: (row) => <span className={MONO}>{percent(row.retail_share_pct) ?? (row.retail_share_reason === 'no_snapshot' ? 'No snapshot' : '—')}</span> },
    { key: 'earners', header: 'Active earners', align: 'end', cell: (row) => <span className={MONO}>{row.active_earners.toLocaleString()}</span> },
    { key: 'sync', header: 'Order sync', cell: (row) => (row.partial ? <StatusBadge state="behind" /> : <StatusBadge state="healthy" label="Current" />) },
  ]
  return (
    <section className={CARD} aria-labelledby="markets-title">
      <div>
        <h2 id="markets-title" className="font-section-heading text-section-heading text-on-surface">Markets</h2>
        <p className="font-body-sm text-body-sm text-secondary">{countLabel(rows.length, 'market')} with a finished period: each row shows the figures of the period named.</p>
      </div>
      <DataTable bare density="compact" caption="Markets and their finished period" columns={columns} rows={rows} rowKey={(row) => row.market.id} empty={{ title: 'No market with a finished period' }} stackOnPhone />
    </section>
  )
}

/** SC-35 Executive overview (FR-RPT-001): committed figures per market; ?market=&period= in the URL. */
export function OverviewPage() {
  const { me, can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const allowed = can('dashboard.exec')
  const markets = useResource<Market[]>(allowed ? MARKETS_PATH : null)
  const periods = useResource<PeriodList>(allowed && can('period.read') ? '/v1/periods' : null, { limit: PERIOD_LIMIT })
  const scope = marketScope(me, 'dashboard.exec')
  const readable = (markets.data ?? []).filter((market) => inScope(scope, market.id))
  const marketParam = params.get('market')
  const marketId = marketParam !== null && isUuid(marketParam) ? marketParam : null
  const calendars = (periods.data?.calendars ?? []).filter((calendar) => calendar.market.id === marketId)
  const finished = (periods.data?.periods ?? []).filter((period) => isFinished(period.state) && calendars.some((calendar) => calendar.id === period.calendar_id))
  const periodParam = params.get('period')
  // Sent as the URL has it, before (or without) the period list: the API answers 404 for a period not in the market.
  const periodId = marketId !== null && periodParam !== null && isUuid(periodParam) ? periodParam : null
  const dashboard = useResource<ExecutiveDashboard>(allowed ? '/v1/dashboards/executive' : null, { market_id: marketId ?? undefined, period_id: periodId ?? undefined })
  const nameOf = periodNamer(periods.data?.calendars ?? [])
  const shortOf = periodShortener(periods.data?.calendars ?? [])
  if (!allowed) return <NotAvailable />
  const update = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    const search = next.toString()
    router.replace(search === '' ? pathname : `${pathname}?${search}`)
  }
  const definitions = definitionsOf(dashboard.meta)
  const rows = dashboard.data?.rows ?? []
  const only = rows.length === 1 ? rows[0] : undefined
  // The linked period while it is not in the loaded list, named from the answer once it is in.
  const linked = periodId === null || finished.some((period) => period.id === periodId) ? []
    : [{ value: periodId, label: only?.period.id === periodId ? nameOf(only.period, only.calendar_id) : 'Period from the link' }]
  const filters = (
    <div className="flex flex-wrap items-end gap-space-sm" data-testid="filters">
      <div className="w-56">
        <Select label="Market" value={marketId ?? ''} options={[{ value: '', label: 'All markets in scope' }, ...readable.map((market) => ({ value: market.id, label: marketName(market) }))]}
          onChange={(event) => update({ market: event.target.value, period: null })} />
      </div>
      {marketId !== null && finished.length > 0 && (
        <div className="w-64">
          <Select label="Period" value={periodId ?? ''}
            options={[{ value: '', label: 'Latest finished period' }, ...linked, ...finished.map((period) => ({ value: period.id, label: nameOf(period, period.calendar_id) }))]}
            onChange={(event) => update({ period: event.target.value })} />
        </div>
      )}
    </div>
  )
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        title="Executive overview"
        summary="Committed figures only: for each market in your scope, its latest finished period or the period you choose. Open a figure's definition to see what it counts."
        actions={filters}
      />
      {dashboard.error !== null && <LoadFailure error={dashboard.error} onRetry={dashboard.reload} section />}
      {dashboard.loading && <LoadingState label="Loading the overview" />}
      {dashboard.data !== null && rows.length === 0 && (
        <EmptyState title="No committed period yet">Figures appear here once a period of a market in your scope is committed.</EmptyState>
      )}
      {rows.length > 0 && (
        <>
          <PartialBanner rows={rows} definition={definitions.get('partial')} />
          {only === undefined
            ? <p className="font-body-sm text-body-sm text-secondary">Choose a market to see its figures with their definitions and its last finished periods. Each market&apos;s figures are in the table.</p>
            : <Kpis row={only} definitions={definitions} />}
          {/* Full width, one under the other: the eight-column Markets table never fits beside the trend (BUG-127). */}
          {only !== undefined && dashboard.data?.trend !== undefined && (
            <Trend data={dashboard.data.trend} row={only} name={(period) => nameOf(period, only.calendar_id)} short={(period) => shortOf(period, only.calendar_id)} />
          )}
          <MarketTable rows={rows} name={(row) => nameOf(row.period, row.calendar_id)} />
        </>
      )}
    </div>
  )
}
