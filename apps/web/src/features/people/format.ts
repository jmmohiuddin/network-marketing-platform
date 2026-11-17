// Display helpers of the People screens (participant list, SC-09) and the genealogy explorer (SC-07).
import type { PositionStatus } from './types'

/** StatusBadge state (for its tone) and the label shown. */
export interface Badge {
  readonly state: string
  readonly label: string
}

const POSITION_BADGES: Readonly<Record<PositionStatus, Badge>> = {
  pending: { state: 'pending', label: 'Pending' },
  active: { state: 'active', label: 'Active' },
  suspended: { state: 'held', label: 'Suspended' },
  terminated: { state: 'ended', label: 'Terminated' },
}

/** A position status as a badge; an unknown or missing status (not valid at the date) shows as such. */
export function positionBadge(status: string | null): Badge {
  return POSITION_BADGES[status as PositionStatus] ?? { state: 'draft', label: status === null ? 'No status at this date' : status }
}

export function participantBadge(status: 'active' | 'merged'): Badge {
  return status === 'active' ? { state: 'active', label: 'Active' } : { state: 'superseded', label: 'Merged' }
}

export const ACCOUNT_TYPES = { individual: 'Individual', joint: 'Joint', entity: 'Entity' } as const

const SERVICING_SOURCES: Readonly<Record<string, string>> = {
  enrolment: 'At enrolment', first_order: 'First order', manual: 'Changed by staff', reassignment: 'Reassigned on termination', migration: 'Migrated',
}

export function servicingSource(source: string): string {
  return SERVICING_SOURCES[source] ?? source
}

/** "Ada Lovelace (DIST-1)", or the reference alone when the participant has no name. */
export function participantName(participant: { readonly display_name: string | null; readonly external_ref: string }): string {
  return participant.display_name === null ? participant.external_ref : `${participant.display_name} (${participant.external_ref})`
}

/** Valid range of an effective-dated row: "from – to" or "from – now". */
export function rangeText(from: string, to: string | null, format: (value: string) => string): string {
  return `${format(from)} – ${to === null ? 'now' : format(to)}`
}
