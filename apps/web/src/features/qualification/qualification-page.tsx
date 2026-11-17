'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { LinkButton } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { EmptyState, LoadingState, NotAvailable } from '../../components/states'
import { useSession } from '../../lib/session'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import type { ParticipantDetail } from '../cases/types'
import { periodText as periodLabelIn, reviewPath } from '../periods/format'
import type { Calendar, PeriodList } from '../periods/types'
import { versionApi } from '../plans/format'
import type { VersionView } from '../plans/types'
import { countMeasures, factsOf, measureKeys, measureText, ranksText, STATE_FACTS, stateFacts, type MeasureScale } from './format'
import type { QualificationRow } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const CARD = 'bg-surface-container-lowest rounded-xl shadow-sm'
const HEADING = 'font-section-heading text-section-heading text-on-surface font-bold'

/** SC-43 Rank and qualification detail (FR-COMP-004, AC-46.1): committed state per period, read-only. */
export function QualificationPage({ participantId }: { readonly participantId: string }) {
  const { can } = useSession()
  if (!can('participant.read')) return <NotAvailable />
  return <Qualification participantId={participantId} />
}

function Qualification({ participantId }: { readonly participantId: string }) {
  const { can } = useSession()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const participant = useResource<ParticipantDetail>(`/v1/participants/${participantId}`)
  // Calendars (names and cut-off zones) come with the period list, which needs period.read.
  const periods = useResource<PeriodList>(can('period.read') ? '/v1/periods' : null, { limit: 1 })
  if (participant.error !== null) return <LoadFailure error={participant.error} onRetry={participant.reload} />
  const detail = participant.data
  if (detail === null) return <LoadingState label="Loading the participant" />
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value === '') next.delete(key)
    else next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`)
  }
  const position = detail.positions.find((candidate) => candidate.id === params.get('position')) ?? detail.positions[0]
  const calendars = (periods.data?.calendars ?? []).filter((calendar) => calendar.market.id === detail.market.id)
  const calendarId = calendars.find((calendar) => calendar.id === params.get('calendar'))?.id ?? ''
  const name = detail.display_name ?? detail.external_ref
  return (
    <div className="flex flex-col gap-space-lg">
      <div className="-mx-space-lg -mt-space-md px-space-lg py-space-sm bg-surface-container-low flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
        <nav aria-label="Breadcrumb" className="flex items-center gap-space-xs font-caption text-caption text-secondary">
          <Link className="hover:text-primary hover:underline" href="/people">People</Link>
          <span aria-hidden="true">›</span>
          <Link className={`${MONO} text-on-surface hover:underline`} href={`/people/${detail.id}`}>{detail.external_ref}</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page" className="text-on-surface font-semibold">Qualification</span>
        </nav>
      </div>
      <section className={`${CARD} p-space-lg flex flex-col lg:flex-row lg:items-center justify-between gap-space-lg`}>
        <div className="flex flex-col gap-space-xs min-w-0">
          <div className="flex items-center gap-space-sm flex-wrap">
            <h1 className="font-title-lg-mobile text-title-lg-mobile sm:font-title-lg sm:text-title-lg text-on-surface tracking-tight">Rank and qualification: {name}</h1>
            {position !== undefined && <span className="font-data-mono-md text-data-mono-md text-primary bg-primary-fixed px-2 py-0.5 rounded font-semibold">{position.position_ref}</span>}
          </div>
          <p className="font-body-md text-body-md text-secondary">Committed qualification state per period: paid-as and title per ladder, measures, carry, counters, flags and banked amounts. State changes only through a committed run.</p>
        </div>
        {position !== undefined && can('genealogy.read') && (
          <LinkButton variant="primary" icon="account_tree" href={`/genealogy?root=${position.id}`} data-testid="primary-action">Open sponsor tree</LinkButton>
        )}
      </section>
      {position === undefined ? <EmptyState title="This participant holds no position, so there is no qualification state." /> : (
        <>
          <div className="flex flex-wrap gap-space-sm items-end" role="group" aria-label="Choose position and calendar">
            <Select label="Position" value={position.id} options={detail.positions.map((p) => ({ value: p.id, label: `${p.position_ref}${p.owned_to === null ? '' : ' (no longer owned)'}` }))} onChange={(event) => update('position', event.target.value)} />
            {calendars.length > 0 && (
              <Select label="Calendar" value={calendarId} options={[{ value: '', label: 'All calendars' }, ...calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))]} onChange={(event) => update('calendar', event.target.value)} />
            )}
          </div>
          <History key={`${position.id}|${calendarId}`} positionId={position.id} calendarId={calendarId} calendars={calendars} />
        </>
      )}
    </div>
  )
}

interface HistoryProps {
  readonly positionId: string
  readonly calendarId: string
  readonly calendars: readonly Calendar[]
}

function History({ positionId, calendarId, calendars }: HistoryProps) {
  const { can } = useSession()
  const list = usePagedList<QualificationRow>(`/v1/positions/${positionId}/qualification`, { calendar_id: calendarId || undefined })
  const rows = list.rows
  const keys = measureKeys(rows)
  const latest = rows[0]
  const latestCalendar = calendars.find((candidate) => candidate.id === latest?.period.calendar_id)
  // shortcut: measure kinds come from the newest row's plan version for every row; read each row's version if kinds change between versions.
  const version = useResource<VersionView>(latest === undefined || latestCalendar?.plan == null || !can('plan.read') ? null : versionApi(latestCalendar.plan.id, latest.plan_version.version))
  const markets = useResource<Market[]>(version.data === null ? null : MARKETS_PATH)
  const minorUnit = markets.data?.find((market) => market.id === latestCalendar?.market.id)?.minor_unit
  const scale: MeasureScale | null = version.data === null || minorUnit === undefined ? null : { minorUnit, counts: countMeasures(version.data.rules) }
  const periodText = (row: QualificationRow) => {
    const calendar = calendars.find((candidate) => candidate.id === row.period.calendar_id)
    return periodLabelIn(row.period, calendar?.cutoff_time_zone)
  }
  return (
    <>
      {latest !== undefined && (
        <section className="flex flex-col gap-space-sm" aria-labelledby="metrics-title">
          <div className="flex flex-wrap items-center justify-between gap-space-sm">
            <h2 id="metrics-title" className={HEADING}>Latest committed period: {periodText(latest)}</h2>
            <span className="flex flex-wrap gap-space-xs">
              <StatusBadge state="committed" label={`Paid-as ${ranksText(latest.paid_as)}`} />
              <StatusBadge state="neutral" label={`Title ${ranksText(latest.titles)}`} />
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-space-md" data-testid="metrics">
            {latest.measures.map((measure) => (
              <div key={measure.measure} className={`${CARD} p-space-md flex flex-col gap-space-xs`}>
                <span className="font-caption text-caption text-secondary uppercase font-semibold">{measure.measure}</span>
                <span className="font-data-mono-lg text-data-mono-lg text-on-surface font-bold">{measureText(latest, measure.measure, scale)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className={`${CARD} overflow-hidden`} aria-labelledby="matrix-title">
        <div className="p-space-md"><h2 id="matrix-title" className={HEADING}>Qualification by committed period</h2></div>
        <DataTable
          bare
          caption="Qualification by committed period"
          columns={[
            { key: 'period', header: 'Period', cell: (row) => <span className={`${MONO} font-semibold`}>{periodText(row)}</span> },
            {
              key: 'run', header: 'Committed run', cell: (row) => (can('run.review')
                ? <Link className={`${MONO} text-primary hover:underline`} href={reviewPath(row.period.id, row.run_id)}>{shortId(row.run_id)}</Link>
                : <span className={MONO}>{shortId(row.run_id)}</span>),
            },
            { key: 'paid', header: 'Paid-as', cell: (row) => ranksText(row.paid_as) },
            { key: 'title', header: 'Title', cell: (row) => ranksText(row.titles) },
            ...keys.map((key) => ({ key: `m-${key}`, header: key, align: 'end' as const, cell: (row: QualificationRow) => <span className={MONO}>{measureText(row, key, scale)}</span> })),
            ...STATE_FACTS.map((label, index) => ({ key: `f-${label}`, header: label, cell: (row: QualificationRow) => stateFacts(row, scale)[index] })),
          ]}
          rows={rows}
          rowKey={(row) => row.period.id}
          loading={list.loading}
          error={tableError(list)}
          empty={{ title: 'No committed period yet for this position' }}
          pagination={list.pagination}
          stickyFirstColumn
        />
      </section>
      {rows.length > 1 && <Compare rows={rows} keys={keys} scale={scale} periodText={periodText} />}
    </>
  )
}

/** Two committed periods side by side; changed facts are marked (SC-43 Compare periods). */
function Compare({ rows, keys, scale, periodText }: { readonly rows: readonly QualificationRow[]; readonly keys: readonly string[]; readonly scale: MeasureScale | null; readonly periodText: (row: QualificationRow) => string }) {
  const [first, setFirst] = useState(rows[1]!.period.id)
  const [second, setSecond] = useState(rows[0]!.period.id)
  const a = rows.find((row) => row.period.id === first) ?? rows[1]!
  const b = rows.find((row) => row.period.id === second) ?? rows[0]!
  const left = factsOf(a, keys, scale)
  const right = factsOf(b, keys, scale)
  const options = rows.map((row) => ({ value: row.period.id, label: periodText(row) }))
  return (
    <section className={`${CARD} p-space-md flex flex-col gap-space-sm`} aria-labelledby="compare-title" data-testid="compare">
      <h2 id="compare-title" className={HEADING}>Compare periods</h2>
      <div className="flex flex-wrap gap-space-sm items-end">
        <Select label="Earlier period" value={a.period.id} options={options} onChange={(event) => setFirst(event.target.value)} />
        <Select label="Later period" value={b.period.id} options={options} onChange={(event) => setSecond(event.target.value)} />
      </div>
      <DataTable
        bare
        density="compact"
        caption="Compared facts"
        columns={[
          { key: 'fact', header: 'Fact', cell: (index) => left[index]![0] },
          { key: 'a', header: periodText(a), cell: (index) => <span className={MONO}>{left[index]![1]}</span> },
          { key: 'b', header: periodText(b), cell: (index) => <span className={MONO}>{right[index]![1]}</span> },
          { key: 'changed', header: 'Change', cell: (index) => (left[index]![1] === right[index]![1] ? 'Same' : <StatusBadge state="pending" label="Changed" />) },
        ]}
        rows={left.map((_, index) => index)}
        rowKey={(index) => String(index)}
        empty={{ title: 'Nothing to compare' }}
      />
    </section>
  )
}
