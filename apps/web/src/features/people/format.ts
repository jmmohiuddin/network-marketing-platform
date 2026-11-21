// Display helpers of the People screens (participant list, SC-09) and the genealogy explorer (SC-07).
import type { ParentRef } from '../genealogy/types'
import type { PositionStatus } from './types'

/**
 * Placement legs offered in forms. D-B3-06: the width lives on the market's plan version (2..20), which enrolers and
 * case openers cannot read (plan.read), so every leg up to the largest width is offered and the API refuses one beyond it.
 */
export const LEG_OPTIONS: readonly { readonly value: string; readonly label: string }[] = Array.from({ length: 20 }, (_, index) => ({ value: String(index + 1), label: `Leg ${index + 1}` }))

const PARENT_ORIGINS: Readonly<Record<Exclude<ParentRef['event_type'], 'rule'>, string>> = {
  enrolment: 'At enrolment', change: 'By a change case', correction: 'By a correction case', migration: 'By migration',
}

/** How a current parent came to be (W-B3-8): a re-parent by the plan names the plan rule ("<plan version id>:<rule key>"). */
export function parentOrigin(parent: Pick<ParentRef, 'event_type' | 'rule_id'>): string {
  if (parent.event_type === 'rule') return parent.rule_id === null ? 'By a plan rule' : `By plan rule “${parent.rule_id.slice(parent.rule_id.lastIndexOf(':') + 1)}”`
  return PARENT_ORIGINS[parent.event_type]
}

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

export const ACCOUNT_TYPES = { individual: 'Individual', joint: 'Joint', entity: 'Business' } as const

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
