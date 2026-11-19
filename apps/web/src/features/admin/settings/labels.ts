// Words for settings keys and values on SC-29, and the separation-of-duties refusal text shared with SC-17.
import { ApiError } from '../../../lib/api'
import type { Market } from '../../../lib/markets'
import { marketMoney } from '../../periods/format'
import { personLabel } from '../format'
import type { EligibleApprover } from './types'

export const MONEY_KEYS = ['money.rounding_mode', 'money.clawback_policy'] as const
/** PLAN B2 2.1: none has a default (DEC-14). */
export const B2_KEYS = [
  'participants.duplicate_matching', 'customers.reassignment_rule', 'orders.crediting_event', 'orders.purpose_required',
  'orders.attribution_precedence', 'orders.new_buyer_type', 'orders.restocking_fee_volume_effect', 'integrations.sync_health',
  'genealogy.placement_width', 'genealogy.visibility_policy',
] as const
/** PLAN B4 D-B4-18: payouts, adjustments and write-offs; none has a default (DEC-14). */
export const B4_KEYS = [
  'payouts.market_policy', 'payouts.bank_detail_cooling_off_hours', 'payouts.shared_account_threshold', 'payouts.dormant_after_days',
  'payouts.provider_review_reminder_days', 'adjustments.policy', 'write_offs.policy',
] as const
/** PLAN B5 D-B5-20: dispute window and response times, privacy-request deadlines, customers' contact in the portal; none has a default (DEC-14). */
export const B5_KEYS = ['disputes.policy', 'privacy.policy', 'portal.customer_contact_visible'] as const
/** Keys the DPO approves (settings.ts approverPermission privacy.manage). */
const DPO_APPROVED: readonly string[] = ['genealogy.visibility_policy', 'privacy.policy', 'portal.customer_contact_visible']
/** B4 keys a Finance approver approves (settings.ts approverPermission settings.approve). */
const B4_APPROVED: readonly string[] = ['payouts.market_policy', 'payouts.bank_detail_cooling_off_hours', 'adjustments.policy', 'write_offs.policy']
/** Keys changed through "Save new version with effective date". */
export const POLICY_KEYS = [...MONEY_KEYS, 'plan.activation_notice_days', ...B2_KEYS, ...B4_KEYS, ...B5_KEYS] as const
export type PolicyKey = (typeof POLICY_KEYS)[number]

export interface Approval {
  /** The permission that decides a change of the key (settings.ts approverPermission). */
  readonly permission: string
  /** The base role that holds it, for "who can approve" sentences. */
  readonly role: string
  /** "Waiting for <short> approval". */
  readonly short: string
}

export const FINANCE_APPROVAL: Approval = { permission: 'settings.approve', role: 'Finance approver', short: 'Finance' }
const DPO: Approval = { permission: 'privacy.manage', role: 'DPO', short: 'DPO' }

/** Who must approve a change of the key (D-B2-08, D-B5-20): money keys a Finance approver, privacy keys the DPO; else null. */
export function approvalOf(key: string): Approval | null {
  if ((MONEY_KEYS as readonly string[]).includes(key) || B4_APPROVED.includes(key)) return FINANCE_APPROVAL
  return DPO_APPROVED.includes(key) ? DPO : null
}

export const KEY_LABELS: Readonly<Record<string, string>> = {
  'compliance.active_pv_minor': 'Active earner threshold',
  'compliance.rank_thresholds_pv_minor': 'Rank thresholds',
  'compliance.late_order_day': 'Late-order day',
  'compliance.personal_share_flag': 'Personal-use flag',
  'privacy.breach_contacts': 'Breach-notification contacts',
  'money.rounding_mode': 'Rounding mode',
  'money.clawback_policy': 'Clawback default',
  'plan.activation_notice_days': 'Plan notice period',
  'participants.duplicate_matching': 'Duplicate matching',
  'customers.reassignment_rule': 'Customer reassignment rule',
  'orders.crediting_event': 'Crediting event',
  'orders.purpose_required': 'Order purpose required',
  'orders.attribution_precedence': 'Attribution precedence',
  'orders.new_buyer_type': 'Type of new buyers',
  'orders.restocking_fee_volume_effect': 'Restocking-fee volume effect',
  'integrations.sync_health': 'Sync health thresholds',
  'genealogy.placement_width': 'Placement width',
  'genealogy.visibility_policy': 'Downline depth masking',
  'payouts.market_policy': 'Minimum payout and tax profile per market',
  'payouts.bank_detail_cooling_off_hours': 'Bank-detail cooling-off',
  'payouts.shared_account_threshold': 'Shared-account threshold',
  'payouts.dormant_after_days': 'Dormant balance age',
  'payouts.provider_review_reminder_days': 'Provider review reminder',
  'adjustments.policy': 'Adjustment policy',
  'write_offs.policy': 'Write-off policy',
  'disputes.policy': 'Dispute policy',
  'privacy.policy': 'Privacy request deadlines',
  'portal.customer_contact_visible': 'Customer contact in the portal',
  structure: 'Markets, brands and calendars',
}

export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key
}

export const ROUNDING_OPTIONS = [
  { value: 'half_up', label: 'Half up' },
  { value: 'half_even', label: 'Half even' },
] as const

export const CLAWBACK_OPTIONS = [
  { value: 'order_line', label: 'Order line' },
  { value: 'restatement', label: 'Restatement' },
] as const

export const SIGNAL_OPTIONS = [
  { value: 'identity_ref', label: 'Identity reference' },
  { value: 'payment_fingerprint', label: 'Payment fingerprint' },
  { value: 'address', label: 'Address' },
  { value: 'device_id', label: 'Device id' },
] as const

export const RELATED_ACTION_OPTIONS = [
  { value: 'block', label: 'Block the adjustment' },
  { value: 'escalate', label: 'Require a second approver' },
] as const

export const REASSIGNMENT_OPTIONS = [
  { value: 'sponsor', label: 'To the sponsor' },
  { value: 'company', label: 'To the company' },
  { value: 'customer_choice', label: 'Customer’s choice' },
] as const

export const CREDITING_OPTIONS = [
  { value: 'paid', label: 'When paid' },
  { value: 'fulfilled', label: 'When fulfilled' },
] as const

export const PURPOSE_OPTIONS = [
  { value: 'true', label: 'Required' },
  { value: 'false', label: 'Not required' },
] as const

export const ATTRIBUTION_OPTIONS = [
  { value: 'link', label: 'Link' },
  { value: 'code', label: 'Code' },
  { value: 'servicing', label: 'Servicing' },
] as const

export const CONTACT_VISIBLE_OPTIONS = [
  { value: 'true', label: 'Shown, masked' },
  { value: 'false', label: 'Hidden' },
] as const

export const RESTOCKING_OPTIONS = [
  { value: 'none', label: 'No volume effect' },
  { value: 'proportional', label: 'Proportional' },
] as const

const OPTION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  [...ROUNDING_OPTIONS, ...CLAWBACK_OPTIONS, ...RELATED_ACTION_OPTIONS, ...SIGNAL_OPTIONS, ...REASSIGNMENT_OPTIONS, ...CREDITING_OPTIONS, ...ATTRIBUTION_OPTIONS, ...RESTOCKING_OPTIONS]
    .map((option) => [option.value, option.label]),
)

const word = (value: unknown): string => OPTION_LABELS[String(value)] ?? String(value)
const days = (count: number): string => (count === 1 ? '1 day' : `${count} days`)
/** Tenant-wide amounts are minor units of each market's currency (D-B4-18). */
const minor = (value: unknown): string => `${BigInt(String(value)).toLocaleString()} minor units`
const minutes = (count: number): string => (count === 1 ? '1 minute' : `${count} minutes`)

/** Per market id a number of days (disputes.policy and privacy.policy response_days): "DE: 10 days, AT: 30 days". */
function marketDaysText(record: unknown, markets: readonly Market[] | undefined): string {
  const entries = Object.entries((record ?? {}) as Readonly<Record<string, number>>)
  if (entries.length === 0) return 'no market'
  return entries.map(([marketId, count]) => `${markets?.find((market) => market.id === marketId)?.code ?? 'Market'}: ${days(count)}`).join(', ')
}

type MarketPolicy = Readonly<Record<string, { readonly minimum_payout_minor: string; readonly tax_profile_required: boolean }>>

/** payouts.market_policy per market: "DE: 10.00 EUR minimum, tax profile required" (minor units while markets load). */
function marketPolicyText(policy: MarketPolicy, markets: readonly Market[] | undefined): string {
  return Object.entries(policy).map(([marketId, entry]) => {
    const market = markets?.find((candidate) => candidate.id === marketId)
    return `${market?.code ?? 'Market'}: ${marketMoney(entry.minimum_payout_minor, market)} minimum, tax profile ${entry.tax_profile_required ? 'required' : 'not required'}`
  }).join('; ')
}

/** The PLAN B2 2.1 values in words; null for another key or a value of another shape. */
function b2ValueText(key: string, value: unknown, markets: readonly Market[] | undefined): string | null {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Readonly<Record<string, unknown>>
  switch (key) {
    case 'participants.duplicate_matching': {
      const signals = Array.isArray(record.signals) ? record.signals.map(word).join(', ') : ''
      return `${signals}; at least ${String(record.min_matches)} matching; ${record.hold_activation === true ? 'holds activation' : 'does not hold activation'}`
    }
    case 'customers.reassignment_rule':
      return `${word(record.rule)}, after ${days(Number(record.notice_days))}`
    case 'orders.crediting_event':
    case 'orders.restocking_fee_volume_effect':
      return word(value)
    case 'orders.purpose_required':
      return value === true ? 'Required' : 'Not required'
    case 'orders.attribution_precedence':
      return Array.isArray(value) ? value.map(word).join(', then ') : null
    case 'integrations.sync_health':
      return `Behind after ${minutes(Number(record.behind_after_minutes))}, failing after ${minutes(Number(record.failing_after_minutes))}`
    case 'genealogy.placement_width':
      return `${String(value)} legs per position`
    case 'payouts.market_policy':
      return marketPolicyText(record as MarketPolicy, markets)
    case 'payouts.bank_detail_cooling_off_hours':
      return `${String(value)} ${value === 1 ? 'hour' : 'hours'} without payouts after a change`
    case 'payouts.shared_account_threshold':
      return `Warn when ${String(value)} or more payees share one account`
    case 'payouts.dormant_after_days':
    case 'payouts.provider_review_reminder_days':
      return days(Number(value))
    case 'adjustments.policy':
      return `Second approver above ${minor(record.second_approver_above_minor)}; new accounts: ${days(Number(record.new_account_days))}; related accounts: ${word(record.related_account_action).toLowerCase()}`
    case 'write_offs.policy':
      return [
        record.eligible_below_minor === undefined ? null : `eligible below ${minor(record.eligible_below_minor)}`,
        record.eligible_after_days === undefined ? null : `eligible after ${days(Number(record.eligible_after_days))}`,
        `second approver above ${minor(record.second_approver_above_minor)}`,
      ].filter((part) => part !== null).join('; ').replace(/^./, (first) => first.toUpperCase())
    case 'disputes.policy':
      return `${record.window_days === undefined ? 'No dispute window' : `Disputes open for ${days(Number(record.window_days))} after a commit`}; response time ${marketDaysText(record.response_days, markets)}`
    case 'privacy.policy':
      return `Answer within ${marketDaysText(record.response_days, markets)}; escalate ${days(Number(record.escalate_before_days))} before the deadline`
    case 'portal.customer_contact_visible':
      return value === true ? 'Shown, masked' : 'Hidden'
    case 'genealogy.visibility_policy':
      return `Names ${String(record.named_depth)} ${record.named_depth === 1 ? 'level' : 'levels'} down; contact of personally sponsored ${record.contact_for_personally_sponsored === true ? 'shown' : 'hidden'}`
    default:
      return null
  }
}

/**
 * A policy value in words: "Half even", "Order line", "30 days"; other values as compact JSON. markets (GET /v1/markets)
 * names the markets and currencies of payouts.market_policy (BUG-106); PolicyValue passes them.
 */
export function valueText(key: string, value: unknown, markets?: readonly Market[]): string {
  if (value === null || value === undefined) return 'Not set'
  if (key === 'money.rounding_mode' && typeof value === 'string') return OPTION_LABELS[value] ?? value
  if (key === 'money.clawback_policy' && typeof value === 'object' && 'default' in value) {
    const choice = String((value as { default: unknown }).default)
    return OPTION_LABELS[choice] ?? choice
  }
  if (key === 'plan.activation_notice_days' && typeof value === 'number') return days(value)
  return b2ValueText(key, value, markets) ?? (typeof value === 'string' ? value : JSON.stringify(value))
}

/** "Fay Finance (fay@acme.example), Gil Gold (gil@acme.example)". */
export function approverNames(approvers: readonly EligibleApprover[]): string {
  return approvers.map(personLabel).join(', ')
}

/**
 * FR-IAM-004 AC-IAM4-4 sentence when nobody may decide; role = the base role that holds the permission. The API lists
 * only users who could decide now: a holder of a role that requires a second factor counts once it is set up (BUG-115).
 */
export function noApproverText(role: string): string {
  return `No one can approve this yet: another user must hold ${role} and, if the role requires it, have set up their authenticator app at sign-in. A Tenant admin assigns roles.`
}

/**
 * 422 SOD_SELF_APPROVAL with its eligible approvers named in the message, so a dialog's error summary shows who can
 * decide instead; any other error is returned unchanged.
 */
export function withApprovers(error: unknown, role: string): unknown {
  if (!(error instanceof ApiError) || error.code !== 'SOD_SELF_APPROVAL') return error
  const approvers = (error.details as { eligible_approvers?: EligibleApprover[] } | null)?.eligible_approvers ?? []
  const who = approvers.length === 0 ? noApproverText(role) : `Who can decide it: ${approverNames(approvers)}.`
  return new ApiError(error.status, error.code, `${error.message} ${who}`, error.details, error.requestId)
}
