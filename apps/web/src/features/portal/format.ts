// Distributor-facing words (second person, factual: no projections, targets or rankings; BR-HON-01) and formatting.
import { formatDateIn } from '../../lib/format'
import { moneyText } from '../orders/format'
import { periodName } from '../periods/format'
import type { Blocker, DisputeState, LadderRank, Notice, OriginKind, PayoutState, PrivacyRequest, PrivacyType } from './types'

/** "Nov 21, 2026" in the participant's market zone. */
export const dayText = (value: string, timeZone: string): string => formatDateIn(value, timeZone)

/** "Nov 21, 2026, 8:31 AM" in the participant's market zone. */
export function timeText(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value))
}

/** "2026-08-01": the day of an instant in the participant's market zone (file names). */
export function isoDay(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(value))
}

/** "Jul 31, 2026" for a calendar date (YYYY-MM-DD) as given, never shifted by a zone. */
export function dateText(date: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

const PAYOUT_STATE: Readonly<Record<PayoutState, { readonly label: string; readonly state: string }>> = {
  none: { label: 'Not paid out yet', state: 'open' },
  in_transit: { label: 'Payout on its way', state: 'pending' },
  settled: { label: 'Paid', state: 'settled' },
  returned: { label: 'Payout returned', state: 'returned' },
  failed: { label: 'Payout failed', state: 'failed' },
  mixed: { label: 'Several payout states', state: 'open' },
}

/** A statement's payout badge; a net amount of zero or less is never "not paid out yet": nothing is due (BUG-114). */
export function payoutState(state: PayoutState, netMinor: string | null): { readonly label: string; readonly state: string } {
  return state === 'none' && BigInt(netMinor ?? '0') <= 0n ? { label: 'No payout due', state: 'closed' } : PAYOUT_STATE[state]
}

/** Instruction states (pending/instructed/accepted are on their way). */
export function instructionLabel(state: string): string {
  if (state === 'settled') return 'Paid'
  if (state === 'returned') return 'Returned by the bank'
  if (state === 'failed' || state === 'cancelled') return 'Not paid'
  return 'On its way'
}

/** Why a payout skips you (pay_payee_blockers codes; never a hold's staff-written text, D-B5-07). */
export function blockerText(blocker: Blocker, timeZone: string): string {
  switch (blocker.reason) {
    case 'bank_detail_cooling_off':
      return blocker.until === undefined ? 'Your new bank details are in their waiting period.' : `Your new bank details can be used after ${timeText(blocker.until, timeZone)}.`
    case 'hold':
      return 'A payout hold is in place.'
    case 'no_bank_details':
      return 'We have no usable bank details for you.'
    case 'tax_profile_missing':
      return 'Your tax profile is missing.'
    case 'returned_payment_open':
      return 'A returned payment is being reviewed.'
    default:
      return 'Your payout needs a review by the company.'
  }
}

export function originText(kind: OriginKind): string | null {
  switch (kind) {
    case 'late_order': return 'Late order'
    case 'refund': return 'Refund'
    case 'manual': return 'Adjustment'
    case 'restatement': return 'Restatement'
    default: return null
  }
}

export const DISPUTE_STATE: Readonly<Record<DisputeState, { readonly label: string; readonly state: string }>> = {
  opened: { label: 'Dispute opened', state: 'requested' },
  under_review: { label: 'Dispute under review', state: 'under_review' },
  upheld: { label: 'Dispute upheld', state: 'accepted' },
  not_upheld: { label: 'Dispute not upheld', state: 'ended' },
}

// shortcut: plan rules carry no distributor-facing name, so rule, ladder and measure keys are shown as words (common
// volume abbreviations spelled out); use the plan's display names once rules have them (BUG-119).
const KEY_WORDS: Readonly<Record<string, string>> = {
  pv: 'personal volume', gv: 'group volume', bv: 'business volume', cv: 'commissionable volume', qv: 'qualifying volume', ov: 'organisation volume',
}

/** "unilevel" → "Unilevel", "capped_pv" → "Capped personal volume". */
export function keyLabel(key: string): string {
  const words = key.split('_').filter((word) => word !== '').map((word) => KEY_WORDS[word] ?? word).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "gold" or "Main: gold · Leadership: silver" per ladder; "No rank" when none. */
export function rankText(ranks: readonly LadderRank[]): string {
  const held = ranks.filter((r) => r.rank !== null)
  return held.length === 0 ? 'No rank' : held.map((r) => (ranks.length > 1 ? `${keyLabel(r.ladder)}: ${r.rank}` : r.rank)).join(' · ')
}

/** "Paid as gold", or "No paid-as rank" (never "Paid as No rank", BUG-119). */
export function paidAsText(ranks: readonly LadderRank[]): string {
  return ranks.some((r) => r.rank !== null) ? `Paid as ${rankText(ranks)}` : 'No paid-as rank'
}

/** An explanation rate as a percentage ("0.08" → "rate 8 %", exact decimal shift); other words ("rates vary") as given. */
export function rateText(rate: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(rate)
  if (match === null) return rate
  const [, sign, whole, fraction = ''] = match
  const digits = fraction.padEnd(2, '0')
  const integer = `${whole}${digits.slice(0, 2)}`.replace(/^0+(?=\d)/, '')
  const rest = digits.slice(2).replace(/0+$/, '')
  return `rate ${sign}${integer}${rest === '' ? '' : `.${rest}`} %`
}

/** A rank requirement (comp/rank.ts) with its measure key in words: "pv at least 100.00" → "Personal volume at least 100.00". */
export function requirementText(item: { readonly kind: string; readonly text: string; readonly measure?: string }): string {
  return item.kind === 'measure' && item.measure !== undefined && item.text.startsWith(`${item.measure} `)
    ? `${keyLabel(item.measure)}${item.text.slice(item.measure.length)}`
    : item.text
}

export const PRIVACY_TYPE: Readonly<Record<PrivacyType, string>> = {
  access: 'Copy of my data', portability: 'My data in a portable file', correction: 'Correct my data', erasure: 'Erase my data',
}

export const PRIVACY_STATE: Readonly<Record<PrivacyRequest['state'], { readonly label: string; readonly state: string }>> = {
  received: { label: 'Received', state: 'open' },
  in_progress: { label: 'In progress', state: 'in_review' },
  fulfilled: { label: 'Done', state: 'closed' },
  refused: { label: 'Refused', state: 'rejected' },
}

/** Why an erasure waits (prv_erasure_blockers codes). */
export function deferralText(reason: string): string {
  switch (reason) {
    case 'open_payable': return 'Money is still owed to you.'
    case 'payout_in_flight': return 'A payout to you is on its way.'
    case 'payout_hold': return 'A payout hold is in place.'
    case 'open_case': return 'A case about your earnings is still open.'
    default: return 'A record still needs your data.'
  }
}

export interface NoticeView {
  readonly title: string
  readonly text: string
  readonly href: string | null
  readonly linkLabel: string | null
  /** StatusBadge state (its tone). */
  readonly badge: string
  readonly kind: string
}

const str = (params: Notice['params'], key: string): string | null => (typeof params[key] === 'string' ? params[key] as string : null)

function noticeMoney(params: Notice['params'], key: string): string | null {
  const minor = str(params, key)
  const currency = str(params, 'currency')
  const unit = typeof params.minor_unit === 'number' ? params.minor_unit : undefined
  return minor === null || currency === null ? null : moneyText(minor, currency, unit)
}

/** An inbox card from the notification's template and params (ids, decimal strings, instants, masked values). */
export function noticeView(notice: Notice, timeZone: string): NoticeView {
  const p = notice.params
  switch (notice.template) {
    case 'statement.ready': {
      const starts = str(p, 'starts_at')
      const ends = str(p, 'ends_at')
      const run = str(p, 'run_id')
      const period = starts === null || ends === null ? 'a period' : periodName(starts, ends, timeZone)
      const net = noticeMoney(p, 'net_minor')
      return {
        title: 'Statement ready', kind: 'Statement', badge: 'ready', text: `Your statement for ${period} is ready.${net === null ? '' : ` Net ${net}.`}`,
        href: run === null ? '/portal/earnings' : `/portal/earnings/${run}`, linkLabel: 'Open statement',
      }
    }
    case 'payout.sent':
      return { title: 'Payout sent', kind: 'Payout', badge: 'ready', text: `${noticeMoney(p, 'amount_minor') ?? 'A payout'} was sent to account ${str(p, 'masked') ?? ''}.`, href: '/portal/earnings', linkLabel: 'See your statements' }
    case 'payout.held': {
      const reasons = Array.isArray(p.reasons) ? (p.reasons as Blocker[]).map((r) => blockerText(r, timeZone)) : []
      return {
        title: 'Payout on hold', kind: 'Payout', badge: 'held', text: [`${noticeMoney(p, 'amount_minor') ?? 'Your payable'} was not paid in this payout run.`, ...reasons].join(' '),
        href: '/portal/more/payment-details', linkLabel: 'Open payment details',
      }
    }
    case 'payout.returned':
      return {
        title: 'Payout returned', kind: 'Payout', badge: 'held',
        text: `Your bank returned ${noticeMoney(p, 'amount_minor') ?? 'a payout'} to account ${str(p, 'masked') ?? ''}. The amount stays owed to you.`,
        href: '/portal/more/payment-details', linkLabel: 'Open payment details',
      }
    case 'bank_detail.changed': {
      const until = str(p, 'cooling_off_until')
      const previous = str(p, 'previous_masked')
      return {
        title: 'Bank details changed', kind: 'Security', badge: 'blocked',
        text: `${previous === null ? `Your payout account is now ${str(p, 'masked') ?? ''}.` : `Your payout account changed from ${previous} to ${str(p, 'masked') ?? ''}.`}${until === null ? '' : ` Payouts to it start after ${timeText(until, timeZone)}.`} If you did not ask for this, contact the company at once.`,
        href: '/portal/more/payment-details', linkLabel: 'Open payment details',
      }
    }
    case 'tax_profile.changed': {
      const from = str(p, 'valid_from')
      return {
        title: 'Tax profile changed', kind: 'Security', badge: 'blocked',
        text: `Your tax profile was changed${from === null ? '' : ` on ${timeText(from, timeZone)}`}. If you did not make this change, contact the company at once.`,
        href: '/portal/more/payment-details', linkLabel: 'Open payment details',
      }
    }
    case 'dispute.updated': {
      const outcome = str(p, 'outcome')
      return {
        title: 'Dispute updated', kind: 'Dispute', badge: 'pending',
        text: outcome === 'upheld' ? 'Your dispute was upheld.' : outcome === 'not_upheld' ? 'Your dispute was not upheld.' : 'There is an update on your dispute.',
        href: '/portal/earnings#disputes', linkLabel: 'See your disputes',
      }
    }
    case 'privacy_request.updated': {
      const type = str(p, 'type') as PrivacyType | null
      const outcome = str(p, 'outcome')
      return {
        title: 'Privacy request updated', kind: 'Privacy', badge: 'pending',
        text: `${type === null ? 'Your request' : PRIVACY_TYPE[type] ?? 'Your request'}: ${outcome === 'fulfilled' ? 'done' : outcome === 'refused' ? 'refused' : 'updated'}.`,
        href: '/portal/more/my-data', linkLabel: 'Open my data',
      }
    }
    case 'plan.change_scheduled': {
      const from = str(p, 'effective_from')
      return {
        title: 'Plan change scheduled', kind: 'Plan', badge: 'pending',
        text: `A new version of the compensation plan takes effect${from === null ? ' soon' : ` on ${timeText(from, str(p, 'time_zone') ?? timeZone)}`}.`,
        href: '/portal/rank', linkLabel: 'Open rank',
      }
    }
    default:
      return { title: 'Notice', kind: 'Notice', badge: 'open', text: 'There is an update on your account.', href: null, linkLabel: null }
  }
}
