import { Icon } from './icon'

export type BadgeTone = 'neutral' | 'info' | 'locked' | 'success' | 'warning' | 'danger' | 'muted'

// UI_UX 1.5 state families, plus the O-04 proposals for states the docs leave unmapped.
const TONE_BY_STATE: Readonly<Record<string, BadgeTone>> = {
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

// Canonical instances: info sc_01 CALCULATED, success sc_01 Synced, warning sc_03, danger sc_02, neutral sc_06.
const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-surface-container-high text-on-surface',
  info: 'bg-primary-fixed text-primary',
  locked: 'bg-surface-container-high text-on-surface',
  success: 'bg-tertiary-fixed text-on-tertiary-fixed',
  warning: 'bg-amber-100 text-amber-900 border border-amber-300',
  danger: 'bg-error-container text-on-error-container',
  muted: 'bg-surface-container text-secondary',
}

const TONE_ICON: Readonly<Record<BadgeTone, string>> = {
  neutral: 'radio_button_unchecked', info: 'schedule', locked: 'lock', success: 'check', warning: 'warning', danger: 'error', muted: 'archive',
}

export function toneOf(state: string): BadgeTone {
  return TONE_BY_STATE[state.toLowerCase()] ?? 'neutral'
}

/** "auto_denied" -> "Auto denied". */
function labelOf(state: string): string {
  const words = state.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface StatusBadgeProps {
  /** API state value, for example "loaded" or "auto_denied". */
  readonly state: string
  /** Glossary label when it differs from the state name. */
  readonly label?: string
}

/** Non-interactive state chip: colour + icon + label, never colour alone. */
export function StatusBadge({ state, label }: StatusBadgeProps) {
  const tone = toneOf(state)
  return (
    <span data-tone={tone} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-caption font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      <Icon name={TONE_ICON[tone]} size={13} />
      {label ?? labelOf(state)}
    </span>
  )
}
