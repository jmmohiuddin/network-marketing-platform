// Words of the privacy screens (SC-15, SC-41) and of the privacy case on SC-06 (PLAN B5 D-B5-16..19).
import { ApiError, isApiError } from '../../lib/api'
import { countLabel } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { caseTypeLabel } from '../cases/format'
import { marketMoney } from '../periods/format'
import type { Channel, ErasureBlocker, PrivacyRequestRow, RequestState, RequestType, VerificationMethod } from './types'

/** The request's reference: the first 8 characters of its id, upper case (as the public requester was told). */
export const referenceOf = (id: string): string => id.slice(0, 8).toUpperCase()

export const REQUEST_TYPES: readonly RequestType[] = ['access', 'correction', 'erasure', 'portability']

export const TYPE_LABELS: Readonly<Record<RequestType, string>> = {
  access: 'Access', correction: 'Correction', erasure: 'Erasure', portability: 'Portability',
}

/** What each request type asks for, in the requester's words (SC-41 type cards). */
export const TYPE_HELP: Readonly<Record<RequestType, string>> = {
  access: 'A copy of the personal data the company holds about you.',
  correction: 'Correct personal data that is wrong or incomplete. Say what should change in the details.',
  erasure: 'Erase your personal data. Records the company must keep by law are kept without your name.',
  portability: 'Your personal data in a machine-readable file you can take elsewhere.',
}

export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = {
  portal: 'Portal', public_form: 'Public form', staff: 'Received by staff',
}

export const STATE_LABELS: Readonly<Record<RequestState, string>> = {
  received: 'Received', in_progress: 'In progress', fulfilled: 'Fulfilled', refused: 'Refused',
}

/** StatusBadge state words (their tone) per request state. */
export const STATE_BADGES: Readonly<Record<RequestState, string>> = {
  received: 'open', in_progress: 'in_review', fulfilled: 'closed', refused: 'rejected',
}

export const METHOD_LABELS: Readonly<Record<VerificationMethod | 'portal_session', string>> = {
  contact_match: 'Email matches the member’s contact email',
  document: 'Identity document attached to the case',
  other: 'Other check (described in the note)',
  portal_session: 'Signed in to the portal',
}

/** Corrected field names (D-B5-19). */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  display_name: 'Name', 'contact.email': 'Email address', 'contact.phone': 'Phone',
}

/**
 * The privacy preview's export sections (prv_personal_data_map) and erased / kept items (privacy-case.ts
 * ERASURE_CLEARED / ERASURE_RETAINED) in words for the DPO (BUG-116); an unknown identifier is shown as words.
 */
const PRIVACY_ITEM_LABELS: Readonly<Record<string, string>> = {
  participant: 'Member record', types: 'Member types', agreement_acceptances: 'Accepted agreements', positions: 'Positions held',
  servicing: 'Customer servicing', orders: 'Orders as buyer', result_lines: 'Commission lines', statements: 'Statements',
  ledger: 'Ledger balances', related_staff_declarations: 'Staff relationship declarations', bank_detail_requests: 'Bank detail change requests',
  bank_detail_versions: 'Bank details', payout_batch_lines: 'Payout batch lines', payout_instructions: 'Payouts', payout_holds: 'Payout holds',
  tax_profiles: 'Tax profiles', notifications: 'Notifications', notification_preferences: 'Notification settings',
  privacy_requests: 'Privacy requests', portal_accounts: 'Portal account and sign-ins', cases: 'Cases',
  'participant.display_name': 'Member name', 'participant.contact': 'Member contact details', 'participant.identity_doc_id': 'Identity document',
  'user_account.email': 'Portal sign-in email', 'user_account.idp_subject': 'Single sign-on identity', 'user_account.display_name': 'Portal account name',
  'user_account.firebase_subject': 'Google or email sign-in identity', password_credential: 'Portal password', mfa_credential: 'Authenticator app',
  portal_sign_in_code: 'Emailed sign-in codes', 'user_invitation (open: revoked)': 'Open portal invitations (revoked)', login_attempt: 'Sign-in attempts',
  'session.ip': 'Session IP addresses', 'session.user_agent': 'Session browser details', participant_signal: 'Duplicate-check fingerprints',
  'bank_detail_request.details_sealed': 'Bank details in change requests', 'bank_detail_request.contact_email_sealed': 'Contact email in bank detail requests',
  'bank_detail_version.details_sealed': 'Stored bank details', 'tax_profile.tax_id_sealed': 'Tax id', 'tax_profile.tax_id_masked': 'Masked tax id',
  'notification.params.masked': 'Masked account numbers in notifications',
  'notification.params.previous_masked': 'Masked replaced account numbers in notifications', 'notification (queued email: suppressed)': 'Unsent notification emails (suppressed)',
  privacy_export: 'Data exports', 'privacy_request.corrections_sealed': 'Requested corrections',
  'privacy_request.requester_sealed (other requests)': 'Requester details on the member’s other privacy requests',
  'data_export_file.content': 'Files of earlier full data exports (expired)',
  position: 'Positions', relationship: 'Sponsor and placement links', result_line: 'Commission lines', qualification_state: 'Rank results',
  run_snapshot: 'Calculation inputs', journal_entry: 'Journal entries', posting: 'Ledger postings', payout_instruction: 'Payouts',
  'bank_detail fingerprints': 'Bank detail fingerprints', 'tax_profile.residency': 'Tax residency', 'tax_profile.entity_type': 'Tax entity type',
  notification: 'Notifications', case_file: 'Cases', audit: 'Audit log',
}

export function privacyItemLabel(id: string): string {
  const words = PRIVACY_ITEM_LABELS[id] ?? id.replace(/[._]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const DAY_MS = 86_400_000

export interface Deadline {
  readonly text: string
  readonly tone: 'neutral' | 'warning' | 'danger'
}

/**
 * The deadline indicator of an open request (C-B5-4: no deadline until verified with a market whose deadline is
 * configured). escalateDays (privacy.policy) marks requests close to their deadline; null when unknown.
 */
export function deadlineOf(row: Pick<PrivacyRequestRow, 'state' | 'verified' | 'due_at'>, now: number, escalateDays: number | null): Deadline {
  if (row.state === 'fulfilled' || row.state === 'refused') return { text: 'Closed', tone: 'neutral' }
  if (!row.verified) return { text: 'Set when the identity is verified', tone: 'neutral' }
  if (row.due_at === null) return { text: 'No deadline configured', tone: 'neutral' }
  const days = Math.ceil((Date.parse(row.due_at) - now) / DAY_MS)
  if (days < 0) return { text: `Overdue by ${countLabel(-days, 'day')}`, tone: 'danger' }
  const tone = escalateDays !== null && days <= escalateDays ? 'warning' : 'neutral'
  return { text: days === 0 ? 'Due today' : `${countLabel(days, 'day')} left`, tone }
}

/** One erasure blocker in words (D-B5-18). */
export function blockerText(blocker: ErasureBlocker, markets: readonly Market[] | undefined): string {
  switch (blocker.reason) {
    case 'open_payable': {
      const market = markets?.find((candidate) => candidate.id === blocker.market_id)
      return `${marketMoney(blocker.amount_minor, market)} is still owed to the member${market === undefined ? '' : ` in ${market.code}`}.`
    }
    case 'payout_in_flight': return `${countLabel(blocker.count, 'payout')} to the member ${blocker.count === 1 ? 'is' : 'are'} on the way.`
    case 'payout_hold': return 'A payout hold (legal hold) is in place on the member.'
    case 'open_case': return `A ${caseTypeLabel(blocker.type).toLowerCase()} case about the member is still open.`
    case 'open_run': return 'A calculation with results for the member is waiting to be committed.'
  }
}

/** 409 ERASURE_DEFERRED in words: what defers it; nothing was erased and the case stays submitted. Other errors unchanged. */
export function erasureRefusal(error: unknown, markets: readonly Market[] | undefined): unknown {
  if (!isApiError(error, 'ERASURE_DEFERRED')) return error
  const reasons = ((error as ApiError).details as { reasons?: readonly ErasureBlocker[] } | null)?.reasons ?? []
  const words = reasons.map((reason) => blockerText(reason, markets)).join(' ')
  return new ApiError(error.status, error.code, `Erasure deferred: ${words === '' ? error.message : words} Nothing was erased; the request waits for a decision until this is settled.`, error.details, error.requestId)
}
