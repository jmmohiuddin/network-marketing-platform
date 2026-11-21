'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { PageHeader } from '../../components/page-header'
import { RowMenu, type RowMenuItem } from '../../components/row-menu'
import { StatusBadge } from '../../components/status-badge'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { TabPanel, Tabs } from '../../components/tabs'
import { useCursorPages } from '../../lib/cursor-pages'
import { countLabel, formatDateTime } from '../../lib/format'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { inSentence, personName } from '../cases/format'
import { RestatementDialog, type RestatementPeriod } from '../cases/restatement-dialog'
import { CloseDialog, type ClosePeriod } from './close-dialog'
import { blockerLabel, calendarBadge, canCalculate, cutOffText, hasResults, isFinished, isRunning, marketAmount, PERIOD_STATE_LABELS, periodName, refusalTitle, reviewPath, RUN_STATE_LABELS, listedBlockers, targetPeriod } from './format'
import { blockerChip, Diagnostics, PeriodKpis, ReplayBanner, StateTimeline } from './period-panels'
import { useRunRequest } from './run-request'
import type { Calendar, PeriodDetail, PeriodList, PeriodRow, ReplayResult, RunDetail } from './types'

const ID_PREFIX = 'calendars'
const MONO = 'font-data-mono-sm text-data-mono-sm'

const LARGE = '(min-width: 1024px)'

/**
 * Whether the viewport is lg or wider: below it the period table keeps Period, State, Gross and Actions and folds the
 * rest under the period, so it never scrolls sideways at 768 (BUG-098). Wide until mounted and where matchMedia is missing.
 */
function useLargeScreen(): boolean {
  const [large, setLarge] = useState(true)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(LARGE)
    const update = () => setLarge(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return large
}

const busyPeriods = (list: PeriodList) => list.periods.some((period) => period.state === 'calculating' || (period.latest_run !== null && isRunning(period.latest_run.state)))

/** SC-01 Periods and runs (FR-COMP-001/002/008): calendars, the target period's lifecycle, its periods and run actions. */
export function PeriodsPage() {
  const { can } = useSession()
  const params = useSearchParams()
  if (!can('period.read')) return <NotAvailable />
  const requested = params.get('calendar')
  const calendarId = requested !== null && isUuid(requested) ? requested : null
  return <CalendarView key={calendarId ?? ''} calendarId={calendarId} />
}

function CalendarView({ calendarId }: { readonly calendarId: string | null }) {
  const api = useApi()
  const router = useRouter()
  const pathname = usePathname()
  const { me, can, readOnly } = useSession()
  const pages = useCursorPages()
  const list = useResource<PeriodList>('/v1/periods', { calendar_id: calendarId ?? undefined, cursor: pages.cursor }, busyPeriods)
  const markets = useResource<Market[]>(MARKETS_PATH)
  const runs = useRunRequest()
  const large = useLargeScreen()
  const [replay, setReplay] = useState<{ readonly period: string; readonly result: ReplayResult } | null>(null)
  const [replaying, setReplaying] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [restating, setRestating] = useState<RestatementPeriod | null>(null)
  const [closing, setClosing] = useState<ClosePeriod | null>(null)
  const calendars = list.data?.calendars ?? []
  const calendar = calendars.find((candidate) => candidate.id === calendarId)
  const first = calendars[0]?.id
  // No (or an unknown) calendar in the URL: show the first one, so the URL always names the calendar shown.
  useEffect(() => {
    if (calendar === undefined && first !== undefined) router.replace(`${pathname}?calendar=${first}`)
  }, [calendar, first, pathname, router])
  const periods = calendar === undefined ? [] : list.data?.periods ?? []
  // The target comes from the newest page, so paging the table never moves the lifecycle, KPIs and diagnostics.
  // shortcut: only the newest page (50 periods) is searched for the oldest pending period; add a server-side target to the period list when a calendar can have more pending periods than that.
  const head = useResource<PeriodList>(pages.cursor === undefined ? null : '/v1/periods', { calendar_id: calendarId ?? undefined }, busyPeriods)
  const target = targetPeriod(pages.cursor === undefined ? periods : calendar === undefined ? [] : head.data?.periods ?? [])
  const polling = (data: { readonly state: string }) => isRunning(data.state as RunDetail['state']) || data.state === 'calculating'
  const detail = useResource<PeriodDetail>(target === undefined ? null : `/v1/periods/${target.id}`, undefined, polling)
  const latestRunId = target?.latest_run?.id ?? null
  const run = useResource<RunDetail>(latestRunId === null ? null : `/v1/runs/${latestRunId}`, undefined, polling)

  if (list.error !== null) return <LoadFailure error={list.error} onRetry={list.reload} />
  if (list.data === null || (calendar === undefined && first !== undefined)) return <LoadingState label="Loading periods and runs" />
  if (calendar === undefined) {
    return (
      <>
        <PageHeader title="Periods and runs" />
        <EmptyState title="No calendar is set up yet">A tenant admin adds calendars to a market on the market settings; a plan then uses them.</EmptyState>
      </>
    )
  }
  const market = markets.data?.find((candidate) => candidate.id === calendar.market.id)
  const label = (period: PeriodRow) => periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone)
  const write = (permission: string) => !readOnly && can(permission)

  async function calculate(period: PeriodRow) {
    setProblem(null)
    if ((await runs.start(period.id)) !== null) list.reload()
  }
  async function replayRun(period: PeriodRow, runId: string) {
    setReplaying(period.id)
    setProblem(null)
    setReplay(null)
    try {
      const { data } = await api.post<ReplayResult>(`/v1/runs/${runId}/replay`, {})
      setReplay({ period: label(period), result: data })
    } catch (error) {
      setProblem(`The replay of ${label(period)} could not run. ${errorMessage(error)}`)
    } finally {
      setReplaying(null)
    }
  }
  const blockers = (period: PeriodRow) => (listedBlockers(period).length === 0 ? null : (
    <ul className="flex flex-wrap gap-1">{listedBlockers(period).map((b) => <li key={b.code} className={`${blockerChip(b)} font-caption text-caption`}>{blockerLabel(b)}</li>)}</ul>
  ))
  const reviewable = (period: PeriodRow) => can('run.review') && period.latest_run !== null && hasResults(period.latest_run.state)

  const primary = (() => {
    if (target === undefined) return null
    if (target.state === 'calculated' && reviewable(target)) {
      return <LinkButton variant="primary" icon="verified" href={reviewPath(target.id, target.latest_run!.id)} data-testid="primary-action">Open review</LinkButton>
    }
    if (target.state === 'open' && canCalculate(target) && write('run.execute')) {
      return <Button variant="primary" icon="calculate" loading={runs.busy === target.id} data-testid="primary-action" onClick={() => calculate(target)}>Calculate {label(target)}</Button>
    }
    return null
  })()

  /**
   * Row actions, sc_01 style: one button, the rest under "More actions", so a row stays one line (BUG-094). Open
   * review leads when offered.
   */
  const actions = (period: PeriodRow) => {
    const latest = period.latest_run
    const name = label(period)
    const verb = period.state === 'open' ? 'Calculate' : 'Re-run'
    const buttons: readonly (RowMenuItem & { readonly busy?: boolean })[] = [
      ...(canCalculate(period) && write('run.execute') && !(target?.id === period.id && period.state === 'open')
        ? [{ label: verb, ariaLabel: `${verb} ${name}`, icon: period.state === 'open' ? 'calculate' : 'restart_alt', busy: runs.busy === period.id, onSelect: () => calculate(period) }] : []),
      ...(period.committed_run_id !== null && write('run.execute')
        ? [{ label: 'Replay', ariaLabel: `Replay ${name}`, icon: 'history', busy: replaying === period.id, onSelect: () => replayRun(period, period.committed_run_id!) }] : []),
      ...(isFinished(period.state) && write('restatement.request')
        ? [{ label: 'Request restatement', ariaLabel: `Request restatement of ${name}`, icon: 'history_edu', onSelect: () => setRestating({ id: period.id, label: name }) }] : []),
      // D-B6-04: a paid period is closed by a period.close holder once nothing blocks it.
      ...(period.state === 'paid' && write('period.close')
        ? [{ label: 'Close period', ariaLabel: `Close ${name}`, icon: 'lock', onSelect: () => setClosing({ id: period.id, label: name, marketId: calendar.market.id }) }] : []),
    ]
    const review = reviewable(period) && latest !== null
    const shown = review ? undefined : buttons[0]
    const menu = review ? buttons : buttons.slice(1)
    return (
      <div className="flex items-center justify-end gap-1 sm:whitespace-nowrap">
        {review && <LinkButton size="sm" icon="fact_check" aria-label={`Open review of ${name}`} href={reviewPath(period.id, latest.id)}>Open review</LinkButton>}
        {shown !== undefined && <Button size="sm" icon={shown.icon} loading={shown.busy} aria-label={shown.ariaLabel} onClick={shown.onSelect}>{shown.label}</Button>}
        {menu.length > 0 && <RowMenu label={`More actions for ${name}`} items={menu} busy={menu.some((item) => item.busy === true)} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        title="Periods and runs"
        eyebrow={calendar.plan === null ? 'No plan uses this calendar' : calendar.plan.name}
        summary="Calculate each period after its cut-off once its order sync is healthy, review the run, and have a second person commit it. Committed periods are never edited."
        actions={<>
          {can('late.manage') && <LinkButton icon="pending_actions" href={`/periods/late?market_id=${calendar.market.id}`}>Late-transaction queue</LinkButton>}
          {primary}
        </>}
      />
      {target !== undefined && <StateTimeline period={target} calendar={calendar} />}
      {runs.error !== null && <Banner tone="danger" title={refusalTitle(runs.error)}>{errorMessage(runs.error)}</Banner>}
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      {replay !== null && <ReplayBanner period={replay.period} result={replay.result} />}
      {target !== undefined && <PeriodKpis period={target} calendar={calendar} detail={detail} market={market} />}
      {/* Diagnostics beside the table only where the 8-column table fits in 8/12 (BUG-094); below it until then. */}
      <div className="grid grid-cols-1 min-[1920px]:grid-cols-12 gap-space-lg items-start">
        <div className="min-[1920px]:col-span-8 min-w-0 bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
          <Tabs label="Calendars" idPrefix={ID_PREFIX} tabs={calendars.map((c: Calendar) => ({ id: c.id, label: [`${c.name} (${c.market.code})`, calendarBadge(c)].filter((part) => part !== null).join(' · ') }))} selected={calendar.id}
            onSelect={(id) => router.replace(`${pathname}?calendar=${id}`)} />
          <TabPanel idPrefix={ID_PREFIX} tabId={calendar.id}>
            <p className="px-space-md pb-space-sm font-caption text-caption text-secondary">Cut-off time zone: <span className={`${MONO} text-on-surface font-semibold`}>{calendar.cutoff_time_zone}</span> · {calendar.cadence}</p>
            <DataTable
              bare
              stackOnPhone
              caption={`Periods of ${calendar.name}`}
              columns={[
                // Cut-off under the period name, not its own column: the table fits beside nothing at 1280 (BUG-094).
                { key: 'period', header: 'Period · cut-off', cell: (row) => (
                  <span className="flex flex-col sm:whitespace-nowrap">
                    <span className={`${MONO} font-semibold text-on-surface`}>{label(row)}</span>
                    <span className="font-caption text-caption text-secondary font-normal">Cut-off {cutOffText(row.ends_at, calendar.cutoff_time_zone)}</span>
                    {/* D-V1A-02: a final period's latest run that offsets advances. */}
                    {row.latest_run !== null && row.latest_run.true_up_runs > 0 && <span className="font-caption text-caption text-secondary font-normal">Trues up {countLabel(row.latest_run.true_up_runs, 'provisional run')}</span>}
                    {row.closed_at !== null && <span className="font-caption text-caption text-secondary font-normal">Closed {formatDateTime(row.closed_at)} by {inSentence(personName(row.closed_by, me.user.id))}</span>}
                    {!large && row.latest_run !== null && <span className="font-caption text-caption text-secondary font-normal">Latest run: {RUN_STATE_LABELS[row.latest_run.state]}</span>}
                    {!large && row.late.pending > 0 && <span className="font-caption text-caption text-secondary font-normal">Late pending: {row.late.pending}</span>}
                    {!large && blockers(row)}
                  </span>
                ) },
                { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state} label={PERIOD_STATE_LABELS[row.state]} /> },
                ...(large ? [
                  { key: 'run', header: 'Latest run', cell: (row: PeriodRow) => (row.latest_run === null ? '—' : <span className="flex flex-col sm:whitespace-nowrap"><span>{RUN_STATE_LABELS[row.latest_run.state]}</span><span className="font-caption text-caption text-secondary">{formatDateTime(row.latest_run.finished_at)}</span></span>) },
                ] : []),
                // The currency is in the header only, so the amount stays on one line (BUG-097).
                { key: 'gross', header: `Gross${market === undefined ? '' : ` (${market.currency})`}`, align: 'end' as const, cell: (row: PeriodRow) => <span className="whitespace-nowrap">{marketAmount(row.latest_run?.gross_minor, market)}</span> },
                ...(large ? [
                  { key: 'late', header: 'Late pending', align: 'end' as const, cell: (row: PeriodRow) => (row.late.pending === 0 || !can('late.manage') ? row.late.pending : <Link className="text-primary font-semibold hover:underline" href={`/periods/late?state=pending&market_id=${calendar.market.id}`}>{row.late.pending}</Link>) },
                  { key: 'blockers', header: 'Blockers', cell: (row: PeriodRow) => blockers(row) ?? '—' },
                ] : []),
                { key: 'actions', header: 'Actions', align: 'end', cell: actions },
              ]}
              rows={periods}
              rowKey={(row) => row.id}
              selectedKey={target?.id}
              empty={{ title: 'This calendar has no periods yet' }}
              pagination={{
                hasPrevious: pages.hasPrevious,
                hasNext: typeof list.meta.next_cursor === 'string',
                onPrevious: pages.previous,
                onNext: () => typeof list.meta.next_cursor === 'string' && pages.next(list.meta.next_cursor),
              }}
            />
          </TabPanel>
        </div>
        <div className="min-[1920px]:col-span-4 min-w-0">
          {target === undefined ? <EmptyState title="No period to work on" /> : <Diagnostics period={target} run={latestRunId === null ? null : run} canReview={can('run.review')} />}
        </div>
      </div>
      {restating !== null && <RestatementDialog period={restating} onClose={() => setRestating(null)} />}
      {closing !== null && <CloseDialog period={closing} onClose={() => setClosing(null)} onClosed={() => { setClosing(null); list.reload() }} />}
    </div>
  )
}
