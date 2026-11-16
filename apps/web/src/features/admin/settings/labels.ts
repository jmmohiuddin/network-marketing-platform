// Words for settings keys and values on SC-29, and the separation-of-duties refusal text shared with SC-17.
import { ApiError } from '../../../lib/api'
import { personLabel } from '../format'
import type { EligibleApprover } from './types'

export const MONEY_KEYS = ['money.rounding_mode', 'money.clawback_policy'] as const
export const POLICY_KEYS = [...MONEY_KEYS, 'plan.activation_notice_days'] as const
export type PolicyKey = (typeof POLICY_KEYS)[number]

export function isMoneyKey(key: string): boolean {
  return (MONEY_KEYS as readonly string[]).includes(key)
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

const OPTION_LABELS: Readonly<Record<string, string>> = Object.fromEntries([...ROUNDING_OPTIONS, ...CLAWBACK_OPTIONS].map((option) => [option.value, option.label]))

/** A policy value in words: "Half even", "Order line", "30 days"; other values as compact JSON. */
export function valueText(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'Not set'
  if (key === 'money.rounding_mode' && typeof value === 'string') return OPTION_LABELS[value] ?? value
  if (key === 'money.clawback_policy' && typeof value === 'object' && 'default' in value) {
    const choice = String((value as { default: unknown }).default)
    return OPTION_LABELS[choice] ?? choice
  }
  if (key === 'plan.activation_notice_days' && typeof value === 'number') return value === 1 ? '1 day' : `${value} days`
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** "Fay Finance (fay@acme.example), Gil Gold (gil@acme.example)". */
export function approverNames(approvers: readonly EligibleApprover[]): string {
  return approvers.map(personLabel).join(', ')
}

/** FR-IAM-004 AC-IAM4-4 sentence when nobody may decide; role = the base role that holds the permission. */
export function noApproverText(role: string): string {
  return `No one can approve this yet: a Tenant admin must assign ${role} to another user.`
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
