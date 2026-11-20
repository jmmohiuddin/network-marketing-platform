import { countLabel } from '../../lib/format'
import { periodRange } from '../data/format'
import type { Step } from '../../components/stepper'
import type { DifferenceClass, Migration, MigrationState, OpeningRow, ParallelRunState } from './types'

export const MIGRATIONS_PATH = '/v1/migrations'
export const MIGRATIONS_PAGE = '/imports/migration'
export const migrationPage = (id: string): string => `${MIGRATIONS_PAGE}/${id}`

export const STATE_LABELS: Readonly<Record<MigrationState, string>> = {
  draft: 'Draft', applied: 'Applied', opening_submitted: 'Opening submitted', opening_posted: 'Opening posted', signed_off: 'Signed off', cancelled: 'Cancelled',
}
/** StatusBadge states (tone) per migration state. */
export const STATE_BADGES: Readonly<Record<MigrationState, string>> = {
  draft: 'draft', applied: 'mapped', opening_submitted: 'awaiting_approval', opening_posted: 'committed', signed_off: 'approved', cancelled: 'retired',
}
export const RUN_STATE_LABELS: Readonly<Record<ParallelRunState, string>> = { calculating: 'Calculating', compared: 'Compared', failed: 'Failed', superseded: 'Superseded' }
export const CLASS_LABELS: Readonly<Record<DifferenceClass, string>> = { rule: 'Rule', data: 'Data', rounding: 'Rounding' }

/** Applied counts in words, in a fixed order; unknown keys follow. */
const COUNT_LABELS: Readonly<Record<string, string>> = {
  participants: 'Participants', positions: 'Positions', relationships: 'Sponsor relationships', servicing: 'Servicing links', orders: 'Orders', refund_events: 'Refunds',
}
export const countRows = (counts: Readonly<Record<string, number>>): readonly { readonly key: string; readonly label: string; readonly value: number }[] =>
  [...Object.keys(COUNT_LABELS).filter((key) => key in counts), ...Object.keys(counts).filter((key) => !(key in COUNT_LABELS))]
    .map((key) => ({ key, label: COUNT_LABELS[key] ?? key, value: counts[key]! }))

const ORDER: readonly MigrationState[] = ['draft', 'applied', 'opening_submitted', 'opening_posted', 'signed_off']
const reached = (state: MigrationState, at: MigrationState): boolean => ORDER.indexOf(state) >= ORDER.indexOf(at)

/** SC-16 stepper: Upload & validate → Apply → Opening → Parallel run → Sign-off. */
export function migrationSteps(migration: Migration): Step[] {
  const { state, latest_parallel_run: run } = migration
  if (state === 'cancelled') {
    return [
      { label: 'Upload & validate', status: 'done' },
      { label: 'Apply', status: 'blocked', detail: 'Cancelled as a draft' },
      { label: 'Opening', status: 'todo' }, { label: 'Parallel run', status: 'todo' }, { label: 'Sign-off', status: 'todo' },
    ]
  }
  const runStep: Step = run === null
    ? { label: 'Parallel run', status: state === 'opening_posted' ? 'current' : 'todo' }
    : run.state === 'calculating' ? { label: 'Parallel run', status: 'current', detail: 'Calculating' }
      : run.state === 'failed' ? { label: 'Parallel run', status: 'blocked', detail: 'Failed: run it again' }
        : run.unexplained > 0 && state !== 'signed_off' ? { label: 'Parallel run', status: 'current', detail: `${countLabel(run.unexplained, 'unexplained difference')}` }
          : { label: 'Parallel run', status: 'done', detail: 'Compared, all explained' }
  return [
    { label: 'Upload & validate', status: 'done', detail: `Batch ${periodRange(migration.batch.period_from, migration.batch.period_to)}` },
    { label: 'Apply', status: state === 'draft' ? 'current' : 'done' },
    { label: 'Opening', status: reached(state, 'opening_posted') ? 'done' : state === 'draft' ? 'todo' : 'current', detail: state === 'opening_submitted' ? 'Awaiting approval' : undefined },
    runStep,
    { label: 'Sign-off', status: state === 'signed_off' ? 'done' : 'todo' },
  ]
}

/** A staged opening state row as its state items ("title.main R1, counter.streak 3"). */
export function stateText(state: OpeningRow['state']): string {
  if (state === null) return '—'
  const items = [
    ...state.paid_as.map((x) => `paid_as.${x.ladder} ${x.rank}`),
    ...state.titles.map((x) => `title.${x.ladder} ${x.rank}`),
    ...state.counters.map((x) => `counter.${x.key} ${x.value}`),
    ...state.carry.map((x) => `carry.${x.key} ${x.amountMinor}`),
    ...state.banked.map((x) => `banked.${x.key} ${x.amountMinor}`),
    ...state.one_time_flags.map((key) => `one_time.${key}`),
  ]
  return items.length === 0 ? '—' : items.join(', ')
}
