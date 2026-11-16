'use client'

import { useState, type ReactNode } from 'react'
import { Button, LinkButton } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { PageHeader } from '../../components/page-header'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource, type Resource } from '../../lib/use-resource'
import { LoadFailure, useTabParam } from '../admin/page-states'
import { tableError } from '../admin/resource'
import { NOTE, NoticeCard, ROW_ACTIONS, SectionTitle } from '../admin/ui'
import { CalendarDialog, ExtendDialog, RenameCalendarDialog } from './calendar-dialogs'
import { inScope, localBound, marketScope } from './format'
import { PeriodsDrawer } from './periods-drawer'
import { BrandDialog, DeleteDialog, MarketDialog } from './structure-dialogs'
import type { Market } from '../../lib/markets'
import type { Brand, Calendar } from './types'

const ID_PREFIX = 'structure'
const TABS = [
  { id: 'markets', label: 'Markets' },
  { id: 'brands', label: 'Brands' },
  { id: 'calendars', label: 'Calendars' },
] as const
const ADD_LABELS = { markets: 'Add market', brands: 'Add brand', calendars: 'Add calendar' } as const

type Open =
  | { readonly kind: 'market'; readonly market: Market | null }
  | { readonly kind: 'brand'; readonly brand: Brand | null }
  | { readonly kind: 'calendar' }
  | { readonly kind: 'rename-calendar' | 'extend' | 'periods'; readonly calendar: Calendar }
  | { readonly kind: 'delete'; readonly title: string; readonly consequence: string; readonly path: string; readonly done: string }

/** sc_29 section card holding an sc_28 table. */
function TableCard({ id, icon, title, note, children }: { readonly id: string; readonly icon: string; readonly title: string; readonly note: string; readonly children: ReactNode }) {
  return (
    <section className="bg-surface-container-lowest rounded shadow-sm overflow-hidden" aria-labelledby={id}>
      <div className="p-space-lg flex flex-col gap-0.5">
        <SectionTitle id={id} icon={icon} title={title} />
        <p className={NOTE}>{note}</p>
      </div>
      {children}
    </section>
  )
}

/** Whether the user may change what belongs to a market (settings.manage with the market in scope). */
type Editable = (marketId: string) => boolean

function marketColumns(editable: Editable, launch: boolean, open: (next: Open) => void): DataTableColumn<Market>[] {
  return [
    { key: 'market', header: 'Market', cell: (row) => <span className="font-semibold text-on-surface">{row.name} <span className="font-data-mono-sm text-data-mono-sm text-secondary">{row.code}</span></span> },
    { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state} /> },
    { key: 'currency', header: 'Currency', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{row.currency} · {row.minor_unit} decimals</span> },
    { key: 'zone', header: 'Time zone', cell: (row) => row.time_zone },
    { key: 'languages', header: 'Languages', cell: (row) => row.languages.join(', ') },
    { key: 'pack', header: 'Market pack', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{row.market_pack}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className={ROW_ACTIONS}>
          {launch && <LinkButton size="sm" href={`/settings/markets/${row.id}`} aria-label={`Launch checklist of ${row.code}`}>Launch checklist</LinkButton>}
          {editable(row.id) && <Button size="sm" aria-label={`Edit market ${row.code}`} onClick={() => open({ kind: 'market', market: row })}>Edit</Button>}
          {editable(row.id) && row.state === 'draft' && (
            <Button size="sm" variant="destructive" aria-label={`Delete market ${row.code}`} onClick={() => open({ kind: 'delete', title: `Delete market ${row.code}`, consequence: `Deletes the draft market ${row.code}. A market that anything refers to cannot be deleted.`, path: `/v1/markets/${row.id}`, done: `Market ${row.code} deleted.` })}>Delete</Button>
          )}
        </div>
      ),
    },
  ]
}

function brandColumns(writable: boolean, open: (next: Open) => void): DataTableColumn<Brand>[] {
  return [
    { key: 'name', header: 'Brand', cell: (row) => <span className="font-semibold text-on-surface">{row.name}</span> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (writable ? (
        <div className={ROW_ACTIONS}>
          <Button size="sm" aria-label={`Rename brand ${row.name}`} onClick={() => open({ kind: 'brand', brand: row })}>Rename</Button>
          <Button size="sm" variant="destructive" aria-label={`Delete brand ${row.name}`} onClick={() => open({ kind: 'delete', title: `Delete brand ${row.name}`, consequence: `Deletes the brand ${row.name}. A brand that a role grant is scoped to cannot be deleted.`, path: `/v1/brands/${row.id}`, done: `Brand ${row.name} deleted.` })}>Delete</Button>
        </div>
      ) : null),
    },
  ]
}

function calendarColumns(editable: Editable, open: (next: Open) => void): DataTableColumn<Calendar>[] {
  return [
    { key: 'name', header: 'Calendar', cell: (row) => <span className="font-semibold text-on-surface">{row.name}</span> },
    { key: 'market', header: 'Market', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm">{row.market.code}</span> },
    { key: 'cadence', header: 'Cadence', cell: (row) => (row.cadence === 'monthly' ? 'Monthly' : 'Weekly') },
    { key: 'zone', header: 'Cut-off time zone', cell: (row) => row.cutoff_time_zone },
    { key: 'periods', header: 'Periods', cell: (row) => `${row.periods.count} (${row.periods.open} open)` },
    // In the calendar's cut-off zone, as the periods drawer shows it: a local-midnight cut-off reads as midnight (BUG-054).
    { key: 'through', header: 'Generated through', cell: (row) => (row.periods.last_ends_at === null ? '—' : localBound(row.periods.last_ends_at, row.cutoff_time_zone)) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className={ROW_ACTIONS}>
          <Button size="sm" aria-label={`Periods of ${row.name}`} onClick={() => open({ kind: 'periods', calendar: row })}>Periods</Button>
          {editable(row.market.id) && <Button size="sm" aria-label={`Rename calendar ${row.name}`} onClick={() => open({ kind: 'rename-calendar', calendar: row })}>Rename</Button>}
          {editable(row.market.id) && <Button size="sm" aria-label={`Extend calendar ${row.name}`} onClick={() => open({ kind: 'extend', calendar: row })}>Extend</Button>}
          {editable(row.market.id) && (
            <Button size="sm" variant="destructive" aria-label={`Delete calendar ${row.name}`} onClick={() => open({ kind: 'delete', title: `Delete calendar ${row.name}`, consequence: `Deletes ${row.name} and its periods. Only a calendar whose periods are all open can be deleted.`, path: `/v1/calendars/${row.id}`, done: `Calendar ${row.name} deleted.` })}>Delete</Button>
          )}
        </div>
      ),
    },
  ]
}

function rowsOf<T>(resource: Resource<readonly T[]>): readonly T[] {
  return resource.data ?? []
}

/** FR-TEN-002 Markets, brands and calendars (no Stitch file: sc_29 section cards + sc_28 tables, guidelines §9). */
export function MarketsPage() {
  const { me, can, readOnly } = useSession()
  const markets = useResource<readonly Market[]>('/v1/markets')
  const brands = useResource<readonly Brand[]>('/v1/brands')
  const calendars = useResource<readonly Calendar[]>('/v1/calendars')
  const [tab, selectTab] = useTabParam(TABS)
  const [open, setOpen] = useState<Open | null>(null)
  const failure = [markets.error, calendars.error].find(isNotAvailable)
  if (failure !== undefined) return <LoadFailure error={failure} onRetry={markets.reload} />
  const writable = can('settings.manage') && !readOnly
  // PLAN B1 2.2: a market's edits need it in scope; creating a market needs every market in scope.
  const scope = marketScope(me, 'settings.manage')
  const editable: Editable = (marketId) => writable && inScope(scope, marketId)
  const editableMarkets = rowsOf(markets).filter((market) => editable(market.id))
  const canAdd = { markets: writable && scope === 'all', brands: writable, calendars: editableMarkets.length > 0 }
  const launch = can('market.manage') || can('market.signoff')
  const close = () => setOpen(null)
  // Every change is a structure version and can change what the other tabs show (calendar counts, references).
  const saved = () => {
    setOpen(null)
    markets.reload()
    brands.reload()
    calendars.reload()
  }
  const selected = tab as (typeof TABS)[number]['id']
  return (
    <>
      <PageHeader
        title="Markets, brands and calendars"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Markets' }]}
        summary="Where you sell, under which brands, and the calendars whose periods results are calculated for."
        actions={canAdd[selected]
          ? <Button variant="primary" icon="add" data-testid="primary-action" onClick={() => setOpen(selected === 'markets' ? { kind: 'market', market: null } : selected === 'brands' ? { kind: 'brand', brand: null } : { kind: 'calendar' })}>{ADD_LABELS[selected]}</Button>
          : undefined}
      />
      <NoticeCard icon="history_edu" title="Each change is a new settings version">
        Every change asks for a reason and is kept as a settings version you can inspect in Settings. A new market starts as a draft and goes live only through its launch checklist.
      </NoticeCard>
      <div>
        <Tabs label="Markets, brands and calendars" idPrefix={ID_PREFIX} tabs={TABS} selected={tab} onSelect={selectTab} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          {selected === 'markets' && (
            <TableCard id="markets-title" icon="public" title="Markets" note="A market’s pack and currency change only while it is a draft.">
              <DataTable bare caption="Markets" columns={marketColumns(editable, launch, setOpen)} rows={rowsOf(markets)} rowKey={(row) => row.id} loading={markets.loading} error={tableError(markets)} empty={{ title: 'No markets yet' }} />
            </TableCard>
          )}
          {selected === 'brands' && (
            <TableCard id="brands-title" icon="sell" title="Brands" note="Role grants can be scoped to a brand.">
              <DataTable bare caption="Brands" columns={brandColumns(writable, setOpen)} rows={rowsOf(brands)} rowKey={(row) => row.id} loading={brands.loading} error={tableError(brands)} empty={{ title: 'No brands yet' }} />
            </TableCard>
          )}
          {selected === 'calendars' && (
            <TableCard id="calendars-title" icon="calendar_month" title="Calendars" note="Each calendar cuts off at local midnight of its own time zone. Its timing never changes once created.">
              <DataTable bare caption="Calendars" columns={calendarColumns(editable, setOpen)} rows={rowsOf(calendars)} rowKey={(row) => row.id} loading={calendars.loading} error={tableError(calendars)} empty={{ title: 'No calendars yet' }} />
            </TableCard>
          )}
        </TabPanel>
      </div>
      {open?.kind === 'market' && <MarketDialog market={open.market} onClose={close} onSaved={saved} />}
      {open?.kind === 'brand' && <BrandDialog brand={open.brand} onClose={close} onSaved={saved} />}
      {open?.kind === 'calendar' && <CalendarDialog markets={editableMarkets}onClose={close} onSaved={saved} />}
      {open?.kind === 'rename-calendar' && <RenameCalendarDialog calendar={open.calendar} onClose={close} onSaved={saved} />}
      {open?.kind === 'extend' && <ExtendDialog calendar={open.calendar} onClose={close} onSaved={saved} />}
      {open?.kind === 'periods' && <PeriodsDrawer calendar={open.calendar} onClose={close} />}
      {open?.kind === 'delete' && <DeleteDialog {...open} onClose={close} onDeleted={saved} />}
    </>
  )
}
