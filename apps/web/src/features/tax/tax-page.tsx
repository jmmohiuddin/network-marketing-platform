'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { Select } from '../../components/form-field'
import { KpiCard } from '../../components/kpi-card'
import { PageHeader } from '../../components/page-header'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource, type Resource } from '../../lib/use-resource'
import { LoadFailure } from '../admin/page-states'
import { inScope, marketScope } from '../markets/format'
import { marketMoney } from '../periods/format'
import { taxYearOf, todayIn } from './format'
import { LinesTab } from './lines-tab'
import { HistoryTab, MissingTab } from './lists'
import { RulesTab } from './rules-tab'
import type { TaxRules, YearEnd } from './types'
import { YearEndTab } from './year-end-tab'

const ID_PREFIX = 'tax'
/** Tax years offered in the year select: the current one and the ones before it. */
const YEAR_CHOICES = 6
/** The API's tax_year range (TAX_YEAR in apps/api tax/access.ts). */
const YEAR_MIN = 2000
const YEAR_MAX = 2100

/** What every SC-12 tab gets: the market shown and the tax year chosen. */
export interface TaxTabProps {
  readonly market: Market
  readonly taxYear: number
}

/** SC-12 4 KPI cards from GET /v1/tax/year-end totals (over every payee of the tax year). */
function YearEndKpis({ yearEnd, market }: { readonly yearEnd: Resource<YearEnd>; readonly market: Market }) {
  if (yearEnd.error !== null) return <LoadFailure error={yearEnd.error} onRetry={yearEnd.reload} section />
  const totals = yearEnd.data?.totals
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis" aria-busy={totals === undefined || undefined}>
      <KpiCard label="Payees due a statement" icon="badge" value={totals === undefined ? null : String(totals.included - totals.held)}
        detail={totals === undefined ? undefined : `${totals.included} included in the tax year`} />
      <KpiCard label="Held: missing tax id" icon="report_problem" value={totals === undefined ? null : String(totals.held)} detail="Included, but no tax id on file: no statement" />
      <KpiCard label="Withheld in tax year" icon="account_balance" value={totals === undefined ? null : marketMoney(totals.withheld_minor, market)} detail="Sum of the withholding lines of committed runs" />
      <KpiCard label="Ledger check" icon={totals?.equal === false ? 'error' : 'task_alt'} value={totals === undefined ? null : totals.equal ? 'Equal' : 'Mismatch'}
        detail={totals === undefined ? undefined : `Withholding payable in the ledger: ${marketMoney(totals.ledger_withheld_minor, market)}`} />
    </div>
  )
}

function validYear(value: string | null): number | null {
  if (value === null || !/^\d{4}$/.test(value)) return null
  const year = Number(value)
  return year >= YEAR_MIN && year <= YEAR_MAX ? year : null
}

/**
 * SC-12 Tax configuration and year-end statements (FR-TAX-002/003): market and tax year in the URL (?market=&year=&tab=),
 * KPIs, then tabs Year-end statements, Withholding rules, Withholding lines, Missing tax ids and History.
 */
export function TaxPage() {
  const { me, can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const markets = useResource<Market[]>(can('tax.read') ? MARKETS_PATH : null)
  const scope = marketScope(me, 'tax.read')
  const readable = markets.data?.filter((candidate) => inScope(scope, candidate.id))
  const market = readable?.find((candidate) => candidate.id === params.get('market'))
  const first = readable?.[0]?.id
  // No (or an unknown) market in the URL: show the first, so the URL always names the market shown.
  useEffect(() => {
    if (market !== undefined || first === undefined) return
    router.replace(`${pathname}?market=${first}`)
  }, [market, first, pathname, router])
  const rules = useResource<TaxRules>(market === undefined ? null : '/v1/tax/rules', { market_id: market?.id })
  // The last tax year that has ended is the one to prepare statements for.
  const current = market === undefined || rules.data === null ? null : taxYearOf(todayIn(market.time_zone), rules.data.tax_year)
  const taxYear = validYear(params.get('year')) ?? (current === null ? null : current - 1)
  const yearEnd = useResource<YearEnd>(market === undefined || taxYear === null ? null : '/v1/tax/year-end', { market_id: market?.id, tax_year: taxYear ?? undefined, limit: 1 })

  if (!can('tax.read')) return <NotAvailable />
  if (markets.error !== null) return <LoadFailure error={markets.error} onRetry={markets.reload} />
  if (readable === undefined || (market === undefined && first !== undefined)) return <LoadingState label="Loading tax configuration" />
  if (market === undefined) {
    return (
      <>
        <PageHeader title="Tax and year-end statements" />
        <EmptyState title="No market in your scope">Your roles do not grant tax access in any market.</EmptyState>
      </>
    )
  }
  if (rules.error !== null) return <LoadFailure error={rules.error} onRetry={rules.reload} />
  if (current === null || taxYear === null) return <LoadingState label="Loading tax configuration" />

  const update = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    router.replace(`${pathname}?${next.toString()}`)
  }
  const held = yearEnd.data?.totals.held
  const tabs = [
    { id: 'year-end', label: 'Year-end statements' },
    { id: 'rules', label: 'Withholding rules' },
    { id: 'lines', label: 'Withholding lines' },
    { id: 'missing', label: 'Missing tax ids', ...(held === undefined ? {} : { count: held, countLabel: 'held' }) },
    { id: 'history', label: 'History' },
  ]
  const tab = tabs.find((candidate) => candidate.id === params.get('tab'))?.id ?? 'year-end'
  const years = Array.from({ length: YEAR_CHOICES }, (_, index) => current - index)
  const yearOptions = (years.includes(taxYear) ? years : [taxYear, ...years]).map((year) => ({ value: String(year), label: `Tax year ${year}` }))
  const props: TaxTabProps = { market, taxYear }
  const key = `${market.id}:${taxYear}`
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        title="Tax and year-end statements"
        summary="Withholding follows the rules of each market's pack. Year-end statements are built from committed runs and exported for your own filing tool; nothing is sent to a tax authority."
        actions={(
          <div className="flex flex-wrap gap-space-sm">
            <div className="w-56">
              <Select label="Market" value={market.id} options={readable.map((candidate) => ({ value: candidate.id, label: marketName(candidate) }))}
                onChange={(event) => router.replace(`${pathname}?market=${event.target.value}${tab === 'year-end' ? '' : `&tab=${tab}`}`)} />
            </div>
            <div className="w-40">
              <Select label="Tax year" value={String(taxYear)} options={yearOptions} onChange={(event) => update({ year: event.target.value, payee: null, period: null, run: null })} />
            </div>
          </div>
        )}
      />
      <YearEndKpis yearEnd={yearEnd} market={market} />
      <div className="bg-surface-container-lowest rounded-xl shadow-sm min-w-0">
        <Tabs label="Tax views" idPrefix={ID_PREFIX} tabs={tabs} selected={tab} onSelect={(id) => update({ tab: id === 'year-end' ? null : id })} />
        <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
          <div className="p-space-md flex flex-col gap-space-md">
            {tab === 'year-end' && <YearEndTab key={key} {...props} onChanged={yearEnd.reload} payeeId={params.get('payee')} onInspect={(id) => update({ payee: id })} onShowMissing={() => update({ tab: 'missing', payee: null })} />}
            {tab === 'rules' && rules.data !== null && <RulesTab rules={rules.data} market={market} />}
            {tab === 'lines' && rules.data !== null && <LinesTab key={key} {...props} rules={rules.data.withholding} periodId={params.get('period')} runId={params.get('run')} onChoose={update} />}
            {tab === 'missing' && <MissingTab key={key} {...props} />}
            {tab === 'history' && <HistoryTab key={key} {...props} />}
          </div>
        </TabPanel>
      </div>
    </div>
  )
}
