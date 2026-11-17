'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Banner } from '../../components/banner'
import { Icon } from '../../components/icon'
import { KpiCard } from '../../components/kpi-card'
import { StatusBadge } from '../../components/status-badge'
import { LoadingState } from '../../components/states'
import { formatDateTime } from '../../lib/format'
import type { Market } from '../../lib/markets'
import type { Resource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { blockerLabel, blockerText, cutOffText, isRunning, marketMoney, PERIOD_STATE_LABELS, periodName, REPLAY_LABELS, reviewPath, RUN_STATE_LABELS } from './format'
import type { Blocker, Calendar, PeriodDetail, PeriodRow, ReplayResult, RunDetail, Sync } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const SECTION = 'bg-surface-container-lowest rounded-xl p-space-md shadow-sm'
const HEADING = 'font-section-heading text-section-heading text-on-surface'

const STEPS = ['Open', 'Cut-off', 'Calculating', 'Calculated', 'Committed', 'Paid', 'Closed'] as const

/** Index of the period's current step in STEPS: "Cut-off" once the cut-off passed while still open. */
function stepOf(period: PeriodRow): number {
  if (period.state === 'open') return period.cut_off_passed ? 1 : 0
  return STEPS.indexOf(PERIOD_STATE_LABELS[period.state] as (typeof STEPS)[number])
}

/** sc_01 period state ribbon: the target period's lifecycle as data (wraps below lg, 7 across from lg). */
export function StateTimeline({ period, calendar }: { readonly period: PeriodRow; readonly calendar: Calendar }) {
  const current = stepOf(period)
  const detail: Readonly<Record<number, string>> = {
    0: periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone),
    1: cutOffText(period.ends_at, calendar.cutoff_time_zone),
    ...(period.latest_run === null ? {} : { [current]: RUN_STATE_LABELS[period.latest_run.state] }),
  }
  return (
    <section className="bg-surface-container-low rounded-lg p-space-sm" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="font-semibold text-on-surface uppercase tracking-wider text-[11px] font-caption mb-2">
        Lifecycle · <span className={`${MONO} normal-case tracking-normal text-on-surface-variant font-medium`}>{periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone)}</span>
      </h2>
      <ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {STEPS.map((step, index) => {
          const done = index < current
          const now = index === current
          return (
            <li key={step} aria-current={now ? 'step' : undefined} className={`flex flex-col gap-1 p-2 rounded ${now ? 'bg-primary-fixed' : 'bg-surface-container-lowest'}${index > current ? ' opacity-60' : ''}`}>
              <div className="flex items-center justify-between gap-1">
                <span className={`text-[11px] font-bold font-caption tracking-wider uppercase ${now ? 'text-primary' : 'text-secondary'}`}>{String(index + 1).padStart(2, '0')} {step}</span>
                <Icon name={done ? 'check_circle' : now ? 'visibility' : 'hourglass_empty'} size={15} className={done ? 'text-tertiary' : now ? 'text-primary' : 'text-outline'} />
              </div>
              {detail[index] !== undefined && <span className={`font-data-mono-sm text-[11px] ${now ? 'text-on-primary-fixed-variant font-medium' : 'text-secondary'}`}>{detail[index]}</span>}
              <div className={`w-full h-1 rounded-full ${done ? 'bg-tertiary-fixed' : now ? 'bg-primary' : 'bg-surface-container-high'}`} />
              <span className="sr-only">{done ? 'done' : now ? 'current' : 'not reached'}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

const SYNC_LABELS: Readonly<Record<Sync['state'], string>> = {
  failing: 'Failing', behind: 'Behind', thresholds_not_set: 'Thresholds not set', healthy: 'Healthy', none: 'No sources',
}

/** The newest successful sync among the market's sources. */
function lastSuccess(sync: Sync): string | null {
  return sync.sources.map((source) => source.last_success_at).filter((at): at is string => at !== null).sort().at(-1) ?? null
}

/** sc_01 KPI strip for the target period. */
export function PeriodKpis({ period, calendar, detail, market }: { readonly period: PeriodRow; readonly calendar: Calendar; readonly detail: Resource<PeriodDetail>; readonly market: Market | undefined }) {
  const sync = detail.data?.sync
  const latest = period.latest_run
  const blockers = period.blockers
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="kpis">
      <KpiCard label="Target period" icon="event" value={periodName(period.starts_at, period.ends_at, calendar.cutoff_time_zone)}
        detail={<StatusBadge state={period.state} label={PERIOD_STATE_LABELS[period.state]} />} footer={{ label: 'Cut-off', value: cutOffText(period.ends_at, calendar.cutoff_time_zone) }} />
      <KpiCard label="Order sync" icon="sensors" value={sync === undefined ? null : SYNC_LABELS[sync.state]}
        detail={detail.error !== null ? 'Sync health could not be read.' : sync === undefined ? 'Loading' : sync.sources.length === 0 ? 'No source delivered orders of this market' : sync.sources.map((source) => source.name).join(', ')}
        footer={{ label: 'Last successful sync', value: sync === undefined ? '—' : formatDateTime(lastSuccess(sync)) }} />
      <KpiCard label="Latest gross" icon="payments" value={latest === null ? null : marketMoney(latest.gross_minor, market)}
        detail={latest === null ? 'Not calculated yet' : `Run ${RUN_STATE_LABELS[latest.state].toLowerCase()}`} footer={{ label: 'Finished', value: formatDateTime(latest?.finished_at) }} />
      <KpiCard label="Readiness" icon="rule_folder" value={blockers.length === 0 ? 'Ready' : `${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'}`}
        detail={blockers.length === 0 ? 'Nothing blocks a calculation' : blockerText(blockers[0]!)} />
    </div>
  )
}

/** The replay verdict with its hashes (FR-COMP-008, W-B3-5). */
export function ReplayBanner({ period, result }: { readonly period: string; readonly result: ReplayResult }) {
  return (
    <Banner tone={result.status === 'match' ? 'success' : 'danger'} title={`Replay of ${period}: ${REPLAY_LABELS[result.status] ?? result.status}`}>
      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-space-sm font-caption text-caption" data-testid="replay-hashes">
        <dt className="text-secondary">Inputs hash</dt><dd className={`${MONO} break-all`}>{result.inputs_hash}</dd>
        <dt className="text-secondary">Result hash</dt><dd className={`${MONO} break-all`}>{result.result_hash ?? '—'}</dd>
        <dt className="text-secondary">Lines hash</dt><dd className={`${MONO} break-all`}>{result.lines_hash ?? '—'}</dd>
        <dt className="text-secondary">Engine version</dt><dd className={MONO}>{result.engine_version}</dd>
      </dl>
    </Banner>
  )
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-space-sm p-2 rounded bg-surface-container-low">
      <dt className="font-body-sm text-body-sm text-secondary">{label}</dt>
      <dd className={`${MONO} text-on-surface text-right min-w-0 break-all`}>{children}</dd>
    </div>
  )
}

/** sc_01 run diagnostics: the target period's latest run (progress, failure, inputs) and what blocks the period. */
/** A blocker chip: sync health in the error tone (it can clear any moment), structural blockers neutral. */
export const blockerChip = (blocker: Blocker): string =>
  `px-2 py-0.5 rounded ${blocker.code === 'SYNC_BEHIND' ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'}`

export function Diagnostics({ period, run, canReview }: { readonly period: PeriodRow; readonly run: Resource<RunDetail> | null; readonly canReview: boolean }) {
  const data = run?.data ?? null
  return (
    <section className={`${SECTION} flex flex-col gap-space-sm`} aria-labelledby="diagnostics-title" data-testid="diagnostics">
      <div className="flex items-center justify-between gap-space-sm pb-space-sm border-b border-surface-container">
        <h2 id="diagnostics-title" className={HEADING}>Run diagnostics</h2>
        {data !== null && <StatusBadge state={data.state} label={RUN_STATE_LABELS[data.state]} />}
      </div>
      {run === null && <p className="font-body-sm text-body-sm text-secondary">No run of this period yet.</p>}
      {run?.error != null && <LoadFailure error={run.error} onRetry={run.reload} section />}
      {run !== null && run.error === null && data === null && <LoadingState label="Loading the run" />}
      {data !== null && (
        <>
          {isRunning(data.state) && <p role="status" className="font-body-sm text-body-sm text-primary font-medium">{data.progress ?? 'Waiting for a worker'}…</p>}
          {data.error !== null && <Banner tone="danger" title="The run failed">{data.error.message} ({data.error.code})</Banner>}
          <dl className="flex flex-col gap-1">
            <Fact label="Run">{shortId(data.id)}</Fact>
            <Fact label="Plan version">{`${data.plan_version.plan.name} v${data.plan_version.version}`}</Fact>
            <Fact label="Prepared by">{data.prepared_by.display_name ?? '—'}</Fact>
            {data.snapshot !== null && <Fact label="Inputs known at">{formatDateTime(data.snapshot.known_at)}</Fact>}
            {data.snapshot !== null && <Fact label="Orders · events">{`${data.snapshot.row_counts.orders ?? 0} · ${data.snapshot.row_counts.order_events ?? 0}`}</Fact>}
            {data.inputs_hash !== null && <Fact label="Inputs hash">{data.inputs_hash}</Fact>}
          </dl>
          {canReview && (data.state === 'calculated' || data.state === 'committed') && (
            <Link className="font-caption text-caption text-primary hover:underline font-semibold" href={reviewPath(period.id, data.id)}>Open the run review</Link>
          )}
        </>
      )}
      <div className="pt-space-sm border-t border-surface-container flex flex-col gap-2">
        <h3 className="font-caption text-caption text-secondary uppercase font-semibold">Blockers ({period.blockers.length})</h3>
        {period.blockers.length === 0 ? <p className="font-body-sm text-body-sm text-secondary">Nothing blocks a calculation of this period.</p> : (
          <ul className="flex flex-col gap-2">
            {period.blockers.map((blocker) => (
              <li key={blocker.code} className="p-space-sm rounded bg-surface-container-low flex items-start gap-3">
                <span className={`${blockerChip(blocker)} whitespace-nowrap text-[11px] font-data-mono-sm font-semibold mt-0.5`}>{blockerLabel(blocker)}</span>
                <span className="font-body-sm text-body-sm text-on-surface">{blockerText(blocker)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
