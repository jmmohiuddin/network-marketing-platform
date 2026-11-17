// Words and exact formatting of SC-01 / SC-02 / SC-43. Money stays a minor-unit string (orders/format moneyText).
import { formatDateTime, formatDateTimeIn } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { moneyText } from '../orders/format'
import type { Blocker, PeriodRow, PeriodState, RunException, RunState } from './types'

/** "Oct 1, 2026 – Oct 31, 2026" in the calendar's zone ([starts_at, ends_at): the end day is the one before ends_at). */
export function periodName(startsAt: string, endsAt: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone })
  const first = day.format(new Date(startsAt))
  const last = day.format(new Date(new Date(endsAt).getTime() - 1))
  return first === last ? first : `${first} – ${last}`
}

/** The cut-off instant in the calendar's zone, with the zone named ("Nov 1, 2026, 12:00 AM GMT+1"). */
export const cutOffText = (endsAt: string, timeZone: string): string => formatDateTimeIn(endsAt, timeZone)

/**
 * A period in its calendar's zone when known (periodName), else its exact bounds with the viewer's zone named: day
 * names without the zone could name the wrong days (BUG-091).
 */
export function periodText(period: { readonly starts_at: string; readonly ends_at: string }, timeZone: string | undefined): string {
  return timeZone === undefined
    ? `${formatDateTimeIn(period.starts_at, undefined)} – ${formatDateTimeIn(period.ends_at, undefined)}`
    : periodName(period.starts_at, period.ends_at, timeZone)
}

/** Money of a market (currency and minor unit from GET /v1/markets); "—" when absent. */
export function marketMoney(minor: string | null | undefined, market: Pick<Market, 'currency' | 'minor_unit'> | undefined): string {
  if (minor === null || minor === undefined) return '—'
  return market === undefined ? `${BigInt(minor).toLocaleString()} minor units` : moneyText(minor, market.currency, market.minor_unit)
}

/** A signed delta with an explicit "+" (never a judgement colour). */
export function signedMoney(minor: string, market: Pick<Market, 'currency' | 'minor_unit'> | undefined): string {
  return `${BigInt(minor) > 0n ? '+' : ''}${marketMoney(minor, market)}`
}

export const PERIOD_STATE_LABELS: Readonly<Record<PeriodState, string>> = {
  open: 'Open', calculating: 'Calculating', calculated: 'Calculated', committed: 'Committed', paid: 'Paid', closed: 'Closed',
}

export const RUN_STATE_LABELS: Readonly<Record<RunState, string>> = {
  queued: 'Queued', running: 'Running', calculated: 'Calculated', committed: 'Committed', discarded: 'Superseded', failed: 'Failed',
}

/** Whether a run has results a reviewer can open (GET review answers 409 for the others). */
export const hasResults = (state: RunState): boolean => state === 'calculated' || state === 'committed' || state === 'discarded'

export const isRunning = (state: RunState): boolean => state === 'queued' || state === 'running'

/** A blocker in words: sync blockers name the sources and the last successful sync (W-B3-3); others say the API's sentence. */
export function blockerText(blocker: Blocker): string {
  if (blocker.code !== 'SYNC_BEHIND') return blocker.message
  const sources = (blocker.details.sources ?? []) as readonly { name: string; state: string }[]
  const states = sources.map((source) => `${source.state} for ${source.name}`).join(', ')
  const last = typeof blocker.details.last_sync_at === 'string' ? formatDateTime(blocker.details.last_sync_at) : 'never'
  return `Order sync ${states === '' ? 'behind' : states} — last successful sync ${last}.`
}

const BLOCKER_LABELS: Readonly<Record<string, string>> = {
  BEFORE_CUTOFF: 'Before cut-off', PLAN_VERSION_MISSING: 'No plan version', PRIOR_PERIOD_OPEN: 'Previous period not committed',
  PRIOR_STATE_MISSING: 'Prior state not migrated', SYNC_BEHIND: 'Order sync behind',
}

/** A blocker as a short label for chips and table cells (the sentence is blockerText); an unknown code shows its sentence. */
export const blockerLabel = (blocker: Blocker): string => BLOCKER_LABELS[blocker.code] ?? blocker.message

/** Blockers worth listing beside a period: "already committed" repeats the period's state. */
export const listedBlockers = (period: Pick<PeriodRow, 'blockers'>): readonly Blocker[] => period.blockers.filter((blocker) => blocker.code !== 'PERIOD_COMMITTED')

/** Blockers that no click can clear now: the Calculate button is not offered for them. */
const STRUCTURAL = new Set(['PERIOD_COMMITTED', 'BEFORE_CUTOFF', 'PLAN_VERSION_MISSING', 'PRIOR_PERIOD_OPEN', 'PRIOR_STATE_MISSING'])

/**
 * Calculate (or re-run) is offered for an open or calculated period whose only blockers can clear at any moment
 * (sync health); the server's refusal then explains the rest (AC-06.2).
 */
export function canCalculate(period: Pick<PeriodRow, 'state' | 'blockers'>): boolean {
  return (period.state === 'open' || period.state === 'calculated') && !period.blockers.some((blocker) => STRUCTURAL.has(blocker.code))
}

const FINISHED = new Set<PeriodState>(['committed', 'paid', 'closed'])

/**
 * The period whose next action the page offers: the oldest period past its cut-off that is not committed and is
 * covered by a plan version (the head of the calendar's chain; uncovered periods before a plan's start never block);
 * else the period now open for orders. Periods come newest first.
 */
export function targetPeriod(periods: readonly PeriodRow[]): PeriodRow | undefined {
  const pending = periods.filter((period) => period.cut_off_passed && !FINISHED.has(period.state) && !period.blockers.some((b) => b.code === 'PLAN_VERSION_MISSING'))
  return pending.at(-1) ?? periods.filter((period) => !period.cut_off_passed).at(-1)
}

/** A review exception in words: the API names a settings key for an unset check, which has no screen (BUG-092). */
export function exceptionText(exception: Pick<RunException, 'kind' | 'message'>): string {
  return exception.kind === 'large_line_check_unset' ? 'No large-line threshold is set, so result lines are not checked for size.' : exception.message
}

export const REPLAY_LABELS: Readonly<Record<string, string>> = {
  match: 'Match', inputs_differ: 'Inputs differ', result_differs: 'Result differs',
}

export const ORIGIN_LABELS: Readonly<Record<string, string>> = {
  late_transaction: 'Late transaction', clawback: 'Clawback', manual: 'Manual adjustment', restatement: 'Restatement',
}

export const originLabel = (origin: string | null): string => (origin === null ? 'Regular' : ORIGIN_LABELS[origin] ?? origin)

/** "/periods/<id>/runs/<run>/review": the SC-02 route of a run. */
export const reviewPath = (periodId: string, runId: string): string => `/periods/${periodId}/runs/${runId}/review`
