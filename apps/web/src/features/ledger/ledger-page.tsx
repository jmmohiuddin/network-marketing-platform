'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon } from '../../components/icon'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { Select } from '../../components/form-field'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { inScope, marketScope } from '../markets/format'
import { DefinitionPopover, definitionsOf } from '../overview/definition'
import type { FinanceDashboard } from '../overview/types'
import { marketMoney, periodName } from '../periods/format'
import type { PeriodList, PeriodState } from '../periods/types'
import { sumMinor } from './format'
import { MappingTab, ExportsTab } from './gl-tabs'
import { AccountsTab, JournalTab } from './ledger-tabs'
import { ReceivablesTab } from './receivables-tab'
import type { LedgerSummary } from './types'

const ID_PREFIX = 'ledger'
const PERIOD_LIMIT = 200
/**
 * URL keys of the journal list's state: an opening without any of them gets the user's default view. A link naming a
 * market or an entry (SC-02 review, SC-16 opening) is list state too, so the default never moves it or closes the drawer.
 */
const JOURNAL_PARAMS = ['market', 'entry', 'period', 'origin', 'sort', 'columns', 'view'] as const
const MONO = 'font-data-mono-md text-data-mono-md'

/** Currency and minor unit of the market shown. */
export type Money = Pick<Market, 'currency' | 'minor_unit'>

export interface PeriodChoice {
  readonly id: string
  readonly label: string
  readonly state: PeriodState
}

/** What every tab gets: the market, its money, its periods and the URL updater. */
export interface LedgerTabProps {
  readonly marketId: string
  readonly money: Money
  readonly periods: readonly PeriodChoice[]
  readonly params: URLSearchParams
  readonly update: (changes: Readonly<Record<string, string | null>>) => void
  /** The page opened without journal state in the URL: the journal applies the user's default view. */
  readonly opening: boolean
}

/**
 * The market's periods named in their calendar's zone, newest first (period.read only).
 * shortcut: the newest 200 periods of all calendars in scope; page through GET /v1/periods per calendar when a tenant keeps more.
 */
function useMarketPeriods(marketId: string | null): readonly PeriodChoice[] {
  const { can } = useSession()
  const list = useResource<PeriodList>(marketId !== null && can('period.read') ? '/v1/periods' : null, { limit: PERIOD_LIMIT })
  const calendars = (list.data?.calendars ?? []).filter((calendar) => calendar.market.id === marketId)
  return (list.data?.periods ?? []).flatMap((period) => {
    const calendar = calendars.find((candidate) => candidate.id === period.calendar_id)
    if (calendar === undefined) return []
    const name = periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone)
    return [{ id: period.id, state: period.state, label: period.state === 'closed' ? `${name} · Closed` : name }]
  })
}

/** sc_33 accounting invariant banner: debits = credits over every posting of the market. */
function InvariantBanner({ summary, money }: { readonly summary: LedgerSummary; readonly money: Money }) {
  const debits = sumMinor(summary.by_type.map((row) => row.debit_minor))
  const credits = sumMinor(summary.by_type.map((row) => row.credit_minor))
  return (
    <section className="rounded-xl bg-surface-container-low p-space-md shadow-sm" aria-labelledby="invariant-title" data-testid="invariant">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon name={summary.balanced ? 'check_circle' : 'error'} size={20} className={summary.balanced ? 'text-tertiary' : 'text-error'} />
            <h2 id="invariant-title" className={`font-section-heading text-section-heading font-bold tracking-tight ${summary.balanced ? 'text-tertiary' : 'text-error'}`}>
              {summary.balanced ? 'Balanced: debits = credits' : 'Not balanced: debits and credits differ'}
            </h2>
          </div>
          <p className={`${MONO} text-on-surface tracking-tight bg-surface-container-lowest/80 px-space-sm py-1.5 rounded inline-block break-words`}>
            Debits {marketMoney(debits, money)} {summary.balanced ? '=' : '≠'} Credits {marketMoney(credits, money)}
          </p>
        </div>
        <div className="flex items-center gap-space-lg shrink-0">
          <div className="space-y-0.5">
            <div className="font-caption text-caption text-secondary uppercase tracking-wider">Journal entries</div>
            <div className={`${MONO} text-on-surface font-bold`}>{summary.entry_count.toLocaleString()}</div>
          </div>
          <div className="h-8 w-px bg-outline-variant" />
          <div className="space-y-0.5">
            <div className="font-caption text-caption text-secondary uppercase tracking-wider">Entries</div>
            <div className="font-caption text-caption text-on-surface-variant font-semibold">Append-only</div>
          </div>
        </div>
      </div>
    </section>
  )
}

/** SC-33 KPI row from GET /v1/dashboards/finance (FR-RPT-001), each figure with its definition. */
function FinanceKpis({ marketId, money }: { readonly marketId: string; readonly money: Money }) {
  const finance = useResource<FinanceDashboard>('/v1/dashboards/finance', { market_id: marketId })
  if (finance.error !== null) return <LoadFailure error={finance.error} onRetry={finance.reload} section />
  const data = finance.data
  const definitions = definitionsOf(finance.meta)
  const card = (label: string, icon: string, key: string, minor: string | undefined, detail?: string) => (
    <KpiCard label={label} icon={icon} value={minor === undefined ? null : marketMoney(minor, money)} detail={detail}>
      <DefinitionPopover definition={definitions.get(key)} />
    </KpiCard>
  )
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-space-md" data-testid="kpis" aria-busy={data === null || undefined}>
      {card('Payables', 'payments', 'payables_minor', data?.payables_minor)}
      {card('In transit', 'local_shipping', 'in_transit_minor', data?.in_transit_minor)}
      {card('Receivables', 'trending_down', 'receivables_minor', data?.receivables_minor)}
      {card('Withholding', 'account_balance', 'withholding_minor', data?.withholding_minor)}
      {card('Failed payouts', 'error', 'failed_payouts', data?.failed_payouts.amount_minor,
        data === null ? undefined : `${data.failed_payouts.count.toLocaleString()} ${data.failed_payouts.count === 1 ? 'payout' : 'payouts'} not retried`)}
    </div>
  )
}

/** SC-33 Ledger and journal export (FR-FIN-001..005): ?market=&tab= in the URL, entry and account drawers too. */
export function LedgerPage() {
  const { me, can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const markets = useResource<Market[]>(can('ledger.read') ? MARKETS_PATH : null)
  const scope = marketScope(me, 'ledger.read')
  // Only the markets the user's ledger.read roles cover: the API answers 404 for the others.
  const readable = markets.data?.filter((candidate) => inScope(scope, candidate.id))
  const requested = params.get('market')
  const market = readable?.find((candidate) => candidate.id === requested)
  const first = readable?.[0]?.id
  // No (or an unknown) market in the URL: show the first, so the URL always names the market shown.
  useEffect(() => {
    if (market !== undefined || first === undefined) return
    const next = new URLSearchParams(params)
    next.set('market', first)
    router.replace(`${pathname}?${next.toString()}`)
  }, [market, first, params, pathname, router])
  const marketId = market?.id ?? null
  const summary = useResource<LedgerSummary>(marketId === null ? null : '/v1/ledger/summary', { market_id: marketId ?? undefined })
  const periods = useMarketPeriods(marketId)
  const [opening, setOpening] = useState(() => !JOURNAL_PARAMS.some((key) => params.has(key)))
  if (!can('ledger.read')) return <NotAvailable />
  if (markets.error !== null) return <LoadFailure error={markets.error} onRetry={markets.reload} />
  if (readable === undefined || (market === undefined && first !== undefined)) return <LoadingState label="Loading the ledger" />
  if (market === undefined) {
    return (
      <>
        <PageHeader title="Ledger and exports" />
        {markets.data !== null && markets.data.length > 0
          ? <EmptyState title="No market in your scope">Your roles do not grant ledger access in any market.</EmptyState>
          : <EmptyState title="No market is set up yet">The ledger starts with the first committed run of a market.</EmptyState>}
      </>
    )
  }

  const update = (changes: Readonly<Record<string, string | null>>) => {
    setOpening(false)
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    router.replace(`${pathname}?${next.toString()}`)
  }
  const tabs = [
    { id: 'journal', label: 'Journal entries' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'receivables', label: 'Receivables' },
    { id: 'mapping', label: 'Chart of accounts mapping' },
    ...(can('ledger.export') ? [{ id: 'exports', label: 'Exports' }] : []),
  ]
  const tab = tabs.find((candidate) => candidate.id === params.get('tab'))?.id ?? 'journal'
  const money: Money = market
  const props: LedgerTabProps = { marketId: market.id, money, periods, params, update, opening }
  const valid = (key: string) => {
    const value = params.get(key)
    return value !== null && isUuid(value) ? value : null
  }
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        title="Ledger and exports"
        summary="Double-entry obligations of each market: every committed run, payout and write-off posts one balanced journal entry. Balances are summed from the postings."
        actions={(
          <div className="w-56">
            <Select label="Market" value={market.id} options={readable.map((candidate) => ({ value: candidate.id, label: marketName(candidate) }))}
              onChange={(event) => router.replace(`${pathname}?market=${event.target.value}${tab === 'journal' ? '' : `&tab=${tab}`}`)} />
          </div>
        )}
      />
      {summary.error !== null && <LoadFailure error={summary.error} onRetry={summary.reload} section />}
      {summary.data === null && summary.error === null && <LoadingState label="Loading the balances" />}
      {summary.data !== null && <InvariantBanner summary={summary.data} money={money} />}
      <FinanceKpis key={market.id} marketId={market.id} money={money} />
      <div className="bg-surface-container-lowest rounded-xl shadow-sm min-w-0">
        <Tabs label="Ledger views" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={(id) => update({ tab: id === 'journal' ? null : id, entry: null, account: null })} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          <div className="p-space-md flex flex-col gap-space-md">
            {tab === 'journal' && <JournalTab key={market.id} {...props} entryId={valid('entry')} />}
            {tab === 'accounts' && <AccountsTab key={market.id} {...props} accountId={valid('account')} />}
            {tab === 'receivables' && <ReceivablesTab key={market.id} {...props} onChanged={summary.reload} />}
            {tab === 'mapping' && <MappingTab key={market.id} {...props} />}
            {tab === 'exports' && <ExportsTab key={market.id} {...props} />}
          </div>
        </TabPanel>
      </div>
    </div>
  )
}
