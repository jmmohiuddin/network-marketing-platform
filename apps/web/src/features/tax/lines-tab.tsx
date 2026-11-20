'use client'

import Link from 'next/link'
import { DataTable } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { LoadingState } from '../../components/states'
import { formatDay } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { MONO, NOTE } from '../admin/ui'
import { marketMoney, periodName, RUN_STATE_LABELS } from '../periods/format'
import type { PeriodList, PeriodRow } from '../periods/types'
import { percentText, RATE_BASIS_LABELS } from './format'
import type { TaxTabProps } from './tax-page'
import type { TaxLine, WithholdingRule } from './types'

/** shortcut: the newest 200 periods in scope; page per calendar when a tenant keeps more. */
const PERIOD_LIMIT = 200

interface Totals {
  readonly taxable_minor: string
  readonly withheld_minor: string
}

/** The runs of a period that can hold withholding lines: its committed run and its latest run, once each. */
export function runChoices(period: Pick<PeriodRow, 'committed_run_id' | 'latest_run'>): { readonly value: string; readonly label: string }[] {
  const latest = period.latest_run
  return [
    ...(period.committed_run_id === null ? [] : [{ value: period.committed_run_id, label: 'Committed run' }]),
    ...(latest === null || latest.id === period.committed_run_id ? [] : [{ value: latest.id, label: `Latest run · ${RUN_STATE_LABELS[latest.state]}` }]),
  ]
}

interface TaxLinesProps {
  readonly runId: string
  readonly market: Market
  /** The market pack's withholding rules (GET /v1/tax/rules): a line names its rule by title. */
  readonly rules: readonly Pick<WithholdingRule, 'id' | 'title'>[]
}

/** GET /v1/tax/lines?run_id: per payee the rule, rate, basis, taxable and withheld amounts, with the run totals. */
export function TaxLines({ runId, market, rules }: TaxLinesProps) {
  const list = usePagedList<TaxLine>('/v1/tax/lines', { run_id: runId })
  const ruleTitle = (id: string) => rules.find((rule) => rule.id === id)?.title ?? id
  const totals = list.meta.totals as Totals | undefined
  const money = (minor: string) => <span className={MONO}>{marketMoney(minor, market)}</span>
  return (
    <>
      {totals !== undefined && (
        <p className="font-body-sm text-body-sm text-on-surface" data-testid="line-totals">
          Run total: taxable {marketMoney(totals.taxable_minor, market)}, withheld {marketMoney(totals.withheld_minor, market)}.
        </p>
      )}
      <DataTable
        caption="Withholding lines of the run"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <Link className={`${MONO} text-primary font-semibold hover:underline`} href={`/people/${row.payee.id}?tab=tax`}>{row.payee.external_ref}</Link> },
          { key: 'rule', header: 'Rule', cell: (row) => ruleTitle(row.rule_id) },
          { key: 'rate', header: 'Rate', align: 'end', cell: (row) => <span className={MONO}>{percentText(row.rate)}</span> },
          { key: 'basis', header: 'Basis', cell: (row) => RATE_BASIS_LABELS[row.rate_basis] },
          { key: 'taxable', header: `Taxable (${market.currency})`, align: 'end', cell: (row) => money(row.taxable_minor) },
          { key: 'withheld', header: `Withheld (${market.currency})`, align: 'end', cell: (row) => money(row.withheld_minor) },
          { key: 'date', header: 'Tax date', cell: (row) => formatDay(row.tax_date) },
        ]}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: 'This run has no withholding lines.' }}
        pagination={list.pagination}
        stackOnPhone
      />
    </>
  )
}

interface LinesTabProps extends TaxTabProps {
  readonly rules: TaxLinesProps['rules']
  readonly periodId: string | null
  readonly runId: string | null
  readonly onChoose: (changes: Readonly<Record<string, string | null>>) => void
}

/** SC-12 Withholding lines: a period of the market, one of its runs, then GET /v1/tax/lines?run_id with the run totals. */
export function LinesTab({ market, rules, periodId, runId, onChoose }: LinesTabProps) {
  const { can } = useSession()
  const periods = useResource<PeriodList>(can('period.read') ? '/v1/periods' : null, { limit: PERIOD_LIMIT })
  if (!can('period.read')) return <p className={NOTE}>Choosing a period needs period read access.</p>
  if (periods.error !== null) return <LoadFailure error={periods.error} onRetry={periods.reload} section />
  if (periods.data === null) return <LoadingState label="Loading the periods" />
  const calendars = periods.data.calendars.filter((calendar) => calendar.market.id === market.id)
  const choices = periods.data.periods.flatMap((period) => {
    const calendar = calendars.find((candidate) => candidate.id === period.calendar_id)
    return calendar === undefined || runChoices(period).length === 0 ? [] : [{ period, label: periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone) }]
  })
  const chosen = choices.find((choice) => choice.period.id === periodId)
  const runs = chosen === undefined ? [] : runChoices(chosen.period)
  const run = runs.find((choice) => choice.value === runId)?.value ?? runs[0]?.value
  return (
    <div className="flex flex-col gap-space-md">
      <p className={NOTE}>Withholding is calculated with each run from the pack&apos;s rules and posted to withholding payable when the run is committed.</p>
      <div className="flex flex-wrap gap-space-sm">
        <div className="w-72 max-w-full">
          <Select label="Period" placeholder={choices.length === 0 ? 'No period with a run' : 'Choose a period'} value={chosen?.period.id ?? ''}
            options={choices.map((choice) => ({ value: choice.period.id, label: choice.label }))} onChange={(event) => onChoose({ period: event.target.value, run: null })} />
        </div>
        {chosen !== undefined && (
          <div className="w-64 max-w-full">
            <Select label="Run" value={run ?? ''} options={runs} onChange={(event) => onChoose({ run: event.target.value })} />
          </div>
        )}
      </div>
      {run !== undefined && isUuid(run) && <TaxLines key={run} runId={run} market={market} rules={rules} />}
    </div>
  )
}
