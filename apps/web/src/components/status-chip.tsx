import { Archive, Check, CircleAlert, Circle, Clock, Lock, Pause } from 'lucide-react'

export type ChipTone = 'neutral' | 'info' | 'locked' | 'success' | 'warning' | 'danger' | 'muted'

// UI_UX 1.5 state families, plus the O-04 proposals for states the docs leave unmapped.
const TONE_BY_STATE: Readonly<Record<string, ChipTone>> = {
  open: 'neutral', draft: 'neutral', uploaded: 'neutral', validated: 'neutral', mapped: 'neutral',
  calculating: 'info', instructing: 'info', computing: 'info', in_review: 'info', calculated: 'info',
  reviewed: 'info', awaiting_approval: 'info', requested: 'info', pending: 'info', scheduled: 'info',
  instructed: 'info', provisioning: 'info',
  committed: 'locked', approved: 'locked',
  paid: 'success', settled: 'success', closed: 'success', healthy: 'success', ready: 'success',
  loaded: 'success', active: 'success', live: 'success', accepted: 'success',
  held: 'warning', cooling_off: 'warning', behind: 'warning', stale: 'warning', outdated: 'warning',
  grace: 'warning', unmatched: 'warning', under_review: 'warning',
  failed: 'danger', rejected: 'danger', returned: 'danger', blocked: 'danger', lapsed: 'danger',
  denied: 'danger', auto_denied: 'danger',
  superseded: 'muted', discarded: 'muted', retired: 'muted', expired: 'muted', ended: 'muted', archived: 'muted',
}

const ICONS = { neutral: Circle, info: Clock, locked: Lock, success: Check, warning: Pause, danger: CircleAlert, muted: Archive } as const

export function toneOf(state: string): ChipTone {
  return TONE_BY_STATE[state.toLowerCase()] ?? 'neutral'
}

/** "auto_denied" -> "Auto denied". */
function labelOf(state: string): string {
  const words = state.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface StatusChipProps {
  /** API state value, for example "loaded" or "auto_denied". */
  readonly state: string
  /** Glossary label when it differs from the state name. */
  readonly label?: string
}

/** Non-interactive state chip: colour + icon + label, never colour alone (UI-03 2.4). */
export function StatusChip({ state, label }: StatusChipProps) {
  const tone = toneOf(state)
  const Icon = ICONS[tone]
  return (
    <span className={`chip chip-${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {label ?? labelOf(state)}
    </span>
  )
}
