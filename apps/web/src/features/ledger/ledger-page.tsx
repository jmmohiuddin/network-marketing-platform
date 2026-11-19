'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
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
import { marketMoney, periodName } from '../periods/format'
import type { PeriodList, PeriodState } from '../periods/types'
import { sumMinor } from './format'
import { MappingTab, ExportsTab } from './gl-tabs'
import { AccountsTab, JournalTab } from './ledger-tabs'
import { ReceivablesTab } from './receivables-tab'
import type { AccountType, LedgerSummary } from './types'

const ID_PREFIX = 'ledger'
const PERIOD_LIMIT = 200
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
    return calendar === undefined ? [] : [{ id: period.id, state: period.state, label: periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone) }]
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

function LedgerKpis({ summary, money }: { readonly summary: LedgerSummary; readonly money: Money }) {
  const balance = (type: AccountType) => marketMoney(summary.by_type.find((row) => row.type === type)?.balance_minor ?? '0', money)
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Payables" icon="payments" value={balance('payee_payable')} detail="Earnings balance owed by the tenant" />
      <KpiCard label="In transit" icon="local_shipping" value={balance('payout_in_transit')} detail="Instructed payouts not settled yet" />
      <KpiCard label="Receivables" icon="trending_down" value={balance('clawback_receivable')} detail="Clawbacks recovered from future earnings" />
      <KpiCard label="Settled clearing" icon="task_alt" value={balance('settled_clearing')} detail="Payouts the provider confirmed" />
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
  const props: LedgerTabProps = { marketId: market.id, money, periods, params, update }
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
      {summary.data !== null && <LedgerKpis summary={summary.data} money={money} />}
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
