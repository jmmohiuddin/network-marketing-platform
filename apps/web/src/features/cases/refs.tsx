'use client'

import Link from 'next/link'
import { MARKETS_PATH, marketName, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { periodText } from '../periods/format'
import type { PeriodList } from '../periods/types'
import type { ParticipantDetail, PositionDetail } from './types'

const LINK = 'text-primary font-semibold hover:underline'
const MONO = 'font-data-mono-sm text-data-mono-sm'

export const positionPath = (id: string): string => `/v1/positions/${id}`
export const participantPath = (id: string): string => `/v1/participants/${id}`
export const periodPath = (id: string): string => `/v1/periods/${id}`

interface PeriodRef {
  readonly calendar_id: string
  readonly starts_at: string
  readonly ends_at: string
}

/** A period by id, named in its calendar's zone (GET /v1/periods?calendar_id gives the zone); null while unread. */
function usePeriodName(id: string | null): { readonly label: string | null; readonly calendarId: string | null } {
  const period = useResource<PeriodRef>(id === null ? null : periodPath(id))
  const calendars = useResource<PeriodList>(period.data === null ? null : '/v1/periods', { calendar_id: period.data?.calendar_id, limit: 1 })
  if (period.data === null) return { label: null, calendarId: null }
  const zone = calendars.data?.calendars.find((calendar) => calendar.id === period.data!.calendar_id)?.cutoff_time_zone
  return { label: periodText(period.data, zone), calendarId: period.data.calendar_id }
}

/** "P-1A2B" for a position, "DIST-1 · Ann Example" for a participant; the short id while loading or unreadable. */
export function useRefLabel(subjectType: string | null, id: string | null): string | null {
  const position = useResource<PositionDetail>(subjectType === 'position' && id !== null ? positionPath(id) : null)
  const participant = useResource<ParticipantDetail>(subjectType === 'participant' && id !== null ? participantPath(id) : null)
  const period = usePeriodName(subjectType === 'period' ? id : null)
  if (id === null) return null
  if (position.data !== null) return position.data.position_ref
  if (participant.data !== null) return participantText(participant.data)
  if (period.label !== null) return period.label
  return shortId(id)
}

function participantText(participant: Pick<ParticipantDetail, 'external_ref' | 'display_name'>): string {
  return participant.display_name === null ? participant.external_ref : `${participant.external_ref} · ${participant.display_name}`
}

/**
 * A position by id: its reference, linked to the genealogy explorer (SC-07), and its owner now. withOwner false for
 * history (a decided case): the owner now may not be the owner then (BUG-080), so the reference alone names it.
 */
export function PositionLink({ id, withOwner = true }: { readonly id: string; readonly withOwner?: boolean }) {
  const position = useResource<PositionDetail>(positionPath(id))
  const owner = withOwner ? position.data?.owner : null
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <Link className={`${MONO} ${LINK}`} href={`/genealogy?root=${id}`}>{position.data?.position_ref ?? shortId(id)}</Link>
      {owner != null && <span className="font-body-sm text-body-sm text-on-surface-variant">{participantText(owner)}</span>}
    </span>
  )
}

/** A participant by id: reference and name, linked to the participant record (SC-09). */
export function ParticipantLink({ id }: { readonly id: string }) {
  const participant = useResource<ParticipantDetail>(participantPath(id))
  return <Link className={LINK} href={`/people/${id}`}>{participant.data === null ? shortId(id) : participantText(participant.data)}</Link>
}

/** A period (restatement subject) by its bounds, linked to its calendar on SC-01; the short id when not readable. */
export function PeriodLink({ id }: { readonly id: string }) {
  const period = usePeriodName(id)
  if (period.label === null) return <span className={MONO}>{shortId(id)}</span>
  return <Link className={LINK} href={`/periods?calendar=${period.calendarId}`}>{period.label}</Link>
}

/** A market (a grievance whose complainant is not on record) by name; the short id while unread. */
export function MarketLabel({ id }: { readonly id: string }) {
  const markets = useResource<Market[]>(MARKETS_PATH)
  const market = markets.data?.find((candidate) => candidate.id === id)
  return <span>{market === undefined ? shortId(id) : marketName(market)}</span>
}

export function SubjectLink({ subjectType, id, withOwner }: { readonly subjectType: string; readonly id: string; readonly withOwner?: boolean }) {
  if (subjectType === 'position') return <PositionLink id={id} withOwner={withOwner} />
  if (subjectType === 'participant') return <ParticipantLink id={id} />
  if (subjectType === 'period') return <PeriodLink id={id} />
  if (subjectType === 'market') return <MarketLabel id={id} />
  return <span className={MONO}>{shortId(id)}</span>
}
