'use client'

import { useState } from 'react'
import { Banner } from '../../components/banner'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { decimal } from '../data/format'
import { minorToDecimal } from '../orders/format'
import { periodName } from '../periods/format'
import { keyLabel, paidAsText, rankText, requirementText, timeText } from './format'
import { usePortal } from './shell'
import type { RankPeriod, RankRequirement, RankStatus } from './types'
import { CAPTION, CARD, ClosedNotice, MONO, PAGE_TITLE, PortalFailure, PortalSelect, Section, SHOW_FIRST, ShowMore, TILE, useShownList } from './ui'

// SC-19 rank status (FR-DIST-003, D-B5-09): paid-as rank and titles per committed period of one own position, what
// the current rank requires (measured value against the requirement, met / not met / —), one "Not final" row for a
// calculated open period, and a scheduled plan change. Never money, streaks, next ranks or named legs.

export function RankPage() {
  const { profile } = usePortal()
  const [positionId, setPositionId] = useState(profile.positions[0]?.id ?? '')
  if (profile.terminated) return <><h1 className={PAGE_TITLE}>Rank</h1><ClosedNotice /></>
  return (
    <>
      <h1 className={PAGE_TITLE}>Rank</h1>
      {profile.positions.length > 1 && (
        <div className={CARD}>
          <PortalSelect id="rank-position" label="Position" value={positionId} onChange={(event) => setPositionId(event.target.value)}
            options={profile.positions.map((position) => ({ value: position.id, label: position.position_ref }))} />
        </div>
      )}
      <RankView key={positionId} positionId={positionId} />
    </>
  )
}

function RankView({ positionId }: { readonly positionId: string }) {
  const { profile, zone } = usePortal()
  const list = useShownList<RankStatus, RankPeriod>('/v1/me/rank', positionId === '' ? {} : { position_id: positionId }, SHOW_FIRST, (data) => data.periods)
  // Volumes are minor units of the participant's market (rate × volume = money minor, BUG-087).
  const volume = (minor: string) => decimal(minorToDecimal(minor, profile.market.minor_unit))
  if (list.first.error !== null) return <PortalFailure error={list.first.error} onRetry={list.first.reload} />
  if (list.data === null || list.rows === null) return <LoadingState label="Loading your rank" />
  const status = list.data
  const newest = list.rows.find((row) => row.final)
  return (
    <>
      {status.transition_notice !== null && (
        <Banner tone="info" title="Plan change scheduled">A new version of the compensation plan takes effect on {timeText(status.transition_notice.effective_from, zone)}.</Banner>
      )}
      {newest === undefined && list.rows.length === 0
        ? <EmptyState title="No committed period yet">Your rank appears here once a period is committed.</EmptyState>
        : (
          <section aria-labelledby="rank-title" data-testid="card" className="bg-primary text-on-primary rounded-xl p-space-md shadow-md flex flex-col gap-space-sm">
            <span className="text-caption font-caption tracking-wider uppercase">
              {status.position.position_ref}{newest === undefined ? '' : ` · ${periodName(newest.period.starts_at, newest.period.ends_at, zone)}`}
            </span>
            <div className="flex flex-col">
              <h2 id="rank-title" className="text-caption font-caption">Paid as</h2>
              <span className="text-display-mobile font-display-mobile font-bold tracking-tight">{newest === undefined ? 'No committed period yet' : rankText(newest.paid_as)}</span>
            </div>
            {newest !== undefined && (
              <dl className="grid grid-cols-2 gap-space-xs pt-space-xs border-t border-on-primary/10">
                <div className="flex flex-col">
                  <dt className="text-caption font-caption">Highest title</dt>
                  <dd className="text-body-lg font-body-lg font-semibold">{rankText(newest.titles)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-caption font-caption">Grace periods used</dt>
                  <dd className="text-body-lg font-body-lg font-semibold">{graceText(newest)}</dd>
                </div>
              </dl>
            )}
          </section>
        )}
      {status.requirements.map((requirement) => <Requirements key={`${requirement.ladder}-${requirement.rank}`} requirement={requirement} volume={volume} />)}
      {list.rows.length > 0 && (
        <Section title="History" icon="history">
          <ul className="flex flex-col gap-space-xs">
            {list.rows.map((row) => (
              <li key={`${row.period.id}-${row.final}`} className={`${TILE} flex flex-col gap-1`}>
                <div className="flex items-center justify-between gap-space-sm flex-wrap">
                  <span className="font-body-lg text-body-lg font-medium text-on-surface">{periodName(row.period.starts_at, row.period.ends_at, zone)}</span>
                  {row.final ? <StatusBadge state="committed" label="Final" /> : <StatusBadge state="calculated" label="Not final" />}
                </div>
                <span className="font-body-lg text-body-lg text-on-surface">{paidAsText(row.paid_as)}</span>
                {row.measures.length > 0 && <span className={`${MONO} text-on-surface-variant`}>{row.measures.map((m) => `${keyLabel(m.measure)} ${volume(m.value)}`).join(' · ')}</span>}
              </li>
            ))}
          </ul>
          <ShowMore list={list} label="periods" />
        </Section>
      )}
    </>
  )
}

function graceText(row: RankPeriod): string {
  const used = (row.grace_used ?? []).filter((g) => g.periods > 0)
  return used.length === 0 ? 'None' : used.map((g) => `${keyLabel(g.ladder)}: ${g.periods}`).join(' · ')
}

function Requirements({ requirement, volume }: { readonly requirement: RankRequirement; readonly volume: (minor: string) => string }) {
  const grace = requirement.grace
  return (
    <Section title={`What ${requirement.rank} requires`} icon="fact_check"
      aside={<StatusBadge state={requirement.status === 'held' ? 'active' : 'grace'} label={requirement.status === 'held' ? 'Held' : `Held by grace${grace === undefined ? '' : ` (${grace.used} of ${grace.of})`}`} />}>
      <ul className="flex flex-col gap-space-xs">
        {requirement.items.map((item, index) => (
          <li key={index} className={`${TILE} flex flex-col gap-1`}>
            <div className="flex items-center justify-between gap-space-sm">
              <span className="font-body-lg text-body-lg font-semibold text-on-surface">{requirementText(item)}</span>
              <StatusBadge state={item.met === true ? 'active' : item.met === false ? 'blocked' : 'open'} label={item.met === true ? 'Met' : item.met === false ? 'Not met' : '—'} />
            </div>
            {item.kind === 'measure' && item.required !== undefined && (
              <span className={CAPTION}>
                Measured {item.measured == null ? '—' : volume(item.measured)} · required {volume(item.required)}
              </span>
            )}
            {item.kind === 'legs' && item.required !== undefined && <span className={CAPTION}>Required {item.required}; leg counts are not measured here.</span>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
