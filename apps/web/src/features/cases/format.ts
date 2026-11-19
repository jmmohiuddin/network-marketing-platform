// Words and rules of the case screens (SC-06, SC-08). Reason codes are the engineering lists of PLAN B2 2.4.
import type { EligibleApprover } from '../admin/settings/types'
import type { CaseDetail, CaseEventKind, CaseRecord, CaseState, DuplicateOutcome, TreeKind } from './types'

export interface CaseTypeInfo {
  readonly type: string
  /** One case: "Genealogy change". */
  readonly label: string
  /** The queue tab: "Genealogy changes". */
  readonly plural: string
  readonly read: string
  readonly create: string
  readonly decide: string
  /** The base role that decides it, for "no one can approve this yet". */
  readonly deciderRole: string
  /** Reason codes a user may choose in CaseForm; absent for a type no screen files (duplicate: opened by the system). */
  readonly reasonCodes?: readonly string[]
}

const GENEALOGY = { read: 'case.genealogy.read', create: 'case.genealogy.create', decide: 'case.genealogy.approve', deciderRole: 'Compliance officer' }

const FINANCE = { deciderRole: 'Finance approver' }

/** The registered case types (B2, B3 restatement, B4 money cases, B5 disputes and privacy requests), in tab order. */
export const CASE_TYPES: readonly CaseTypeInfo[] = [
  { type: 'genealogy_change', label: 'Genealogy change', plural: 'Genealogy changes', ...GENEALOGY, reasonCodes: ['PARTICIPANT_REQUEST', 'ENROLMENT_ERROR', 'COMPANY_DECISION'] },
  { type: 'genealogy_correction', label: 'Genealogy correction', plural: 'Corrections', ...GENEALOGY, reasonCodes: ['DATA_ENTRY_ERROR', 'MIGRATION_ERROR', 'DISPUTE_RESOLUTION'] },
  { type: 'transfer', label: 'Ownership transfer', plural: 'Transfers', ...GENEALOGY, reasonCodes: ['SUCCESSION', 'SALE', 'DIVORCE', 'CORPORATE_RESTRUCTURE'] },
  {
    type: 'restatement', label: 'Restatement', plural: 'Restatements', read: 'case.restatement.read', create: 'restatement.request',
    decide: 'restatement.approve', deciderRole: 'Finance approver',
    reasonCodes: ['ENGINE_DEFECT', 'INPUT_CORRECTION', 'GENEALOGY_CORRECTION', 'LATE_TRANSACTION', 'DISPUTE_UPHELD'],
  },
  {
    type: 'duplicate', label: 'Duplicate review', plural: 'Duplicates', read: 'case.duplicate.read', create: 'case.duplicate.create',
    decide: 'case.duplicate.approve', deciderRole: 'Compliance officer',
  },
  {
    type: 'adjustment', label: 'Manual adjustment', plural: 'Adjustments', read: 'case.adjustment.read', create: 'case.adjustment.create',
    decide: 'case.adjustment.approve', ...FINANCE, reasonCodes: ['COMMISSION_ERROR', 'DATA_CORRECTION', 'DISPUTE_UPHELD', 'GOODWILL', 'OTHER'],
  },
  {
    type: 'write_off', label: 'Write-off', plural: 'Write-offs', read: 'case.write_off.read', create: 'case.write_off.create',
    decide: 'case.write_off.approve', ...FINANCE, reasonCodes: ['UNRECOVERABLE', 'NO_FUTURE_EARNINGS', 'BELOW_THRESHOLD', 'OTHER'],
  },
  {
    type: 'bank_detail', label: 'Bank-detail change', plural: 'Bank details', read: 'case.bank_detail.read', create: 'case.bank_detail.create',
    decide: 'case.bank_detail.approve', deciderRole: 'Compliance officer', reasonCodes: ['PAYEE_REQUEST', 'CORRECTION'],
  },
  {
    // Opened by the system for a returned payout (RETURNED_BY_BANK); the payout officer adds a note and submits it.
    type: 'returned_payment', label: 'Returned payment', plural: 'Returned payments', read: 'case.returned_payment.read',
    create: 'case.returned_payment.create', decide: 'payout.approve', ...FINANCE,
  },
  {
    // D-B5-15: only the line's payee opens a dispute (in the portal); no staff create permission exists, so `create` is the decider's.
    type: 'dispute', label: 'Commission dispute', plural: 'Disputes', read: 'case.dispute.read', create: 'case.dispute.approve',
    decide: 'case.dispute.approve', deciderRole: 'Commission analyst',
  },
  {
    // D-B5-16: opened by the system for a data-subject request; the DPO verifies, states the retention basis and submits; another DPO decides.
    type: 'privacy', label: 'Privacy request', plural: 'Privacy requests', read: 'privacy.manage', create: 'privacy.manage',
    decide: 'privacy.manage', deciderRole: 'DPO',
  },
]

export function caseTypeInfo(type: string): CaseTypeInfo | undefined {
  return CASE_TYPES.find((info) => info.type === type)
}

export function caseTypeLabel(type: string): string {
  return caseTypeInfo(type)?.label ?? type
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  PARTICIPANT_REQUEST: 'Participant request', ENROLMENT_ERROR: 'Enrolment error', COMPANY_DECISION: 'Company decision',
  DATA_ENTRY_ERROR: 'Data entry error', MIGRATION_ERROR: 'Migration error', DISPUTE_RESOLUTION: 'Dispute resolution',
  SUCCESSION: 'Succession', SALE: 'Sale', DIVORCE: 'Divorce', CORPORATE_RESTRUCTURE: 'Corporate restructure',
  SIGNAL_MATCH: 'Matching signals at enrolment', STAFF_SUSPICION: 'Staff suspicion',
  ENGINE_DEFECT: 'Engine defect', INPUT_CORRECTION: 'Input correction', GENEALOGY_CORRECTION: 'Genealogy correction',
  LATE_TRANSACTION: 'Late transaction', DISPUTE_UPHELD: 'Dispute upheld',
  COMMISSION_ERROR: 'Commission error', DATA_CORRECTION: 'Data correction', GOODWILL: 'Goodwill', OTHER: 'Other',
  UNRECOVERABLE: 'Unrecoverable', NO_FUTURE_EARNINGS: 'No future earnings expected', BELOW_THRESHOLD: 'Below the write-off threshold',
  PAYEE_REQUEST: 'Payee request', CORRECTION: 'Correction', RETURNED_BY_BANK: 'Returned by the bank',
  DISTRIBUTOR_DISPUTE: 'Disputed by the distributor', PORTAL_REQUEST: 'Requested in the portal', PUBLIC_FORM: 'Public request form',
  RECEIVED_BY_STAFF: 'Received by staff',
}

export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code
}

export const STATE_LABELS: Readonly<Record<CaseState, string>> = {
  open: 'Open', submitted: 'Waiting for decision', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn',
}

/** Open or waiting for a decision; a decided or withdrawn case is history. */
export const isLive = (c: Pick<CaseRecord, 'state'>): boolean => c.state === 'open' || c.state === 'submitted'

/** StatusBadge state words (their tone) for a case state. */
export const STATE_BADGES: Readonly<Record<CaseState, string>> = {
  open: 'open', submitted: 'awaiting_approval', approved: 'approved', rejected: 'rejected', withdrawn: 'retired',
}

export const EVENT_LABELS: Readonly<Record<CaseEventKind, string>> = {
  opened: 'Opened', evidence_added: 'Evidence added', assigned: 'Assignment changed', submitted: 'Submitted for decision',
  first_approved: 'First approval', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', updated: 'Updated',
}

export const KIND_LABELS: Readonly<Record<TreeKind, string>> = { sponsor: 'Sponsor tree', placement: 'Placement tree' }

/** Duplicate-detection signal kinds (D-B2-10): only the kinds are ever shown, never values. */
export const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  identity_ref: 'Identity reference', payment_fingerprint: 'Payment fingerprint', address: 'Address', device_id: 'Device',
}

export const OUTCOME_LABELS: Readonly<Record<DuplicateOutcome, string>> = {
  merge: 'Merge into the matched participant',
  allow: 'Allow both participants',
  terminate: "Terminate the subject's positions",
}

/** Why a case needs a second approver (D-B4-08/09 escalations), in words. */
const ESCALATION_TEXT: Readonly<Record<string, string>> = {
  related_party: 'The payee is declared related to a person preparing this case.',
  new_account: 'The payee enrolled within the new-account days of the adjustment policy.',
  above_threshold: 'The amount is above the second-approver threshold of the policy.',
  not_eligible: 'The receivable is not eligible for write-off under the policy.',
}

export const escalationText = (code: string): string => ESCALATION_TEXT[code] ?? code

/** Structural refusals of a genealogy change (PLAN B2 4.3), in plain words. */
const STRUCTURAL_TEXT: Readonly<Record<string, string>> = {
  GEN_CYCLE: 'Refused: this change would create a cycle (the proposed parent is in the position\'s own downline).',
  GEN_OVERLAP: 'The position already has a parent of this kind for that period.',
  GEN_SLOT_TAKEN: 'That leg of the proposed parent is taken.',
  PARENT_NOT_ELIGIBLE: 'The proposed parent cannot take positions (unknown or terminated).',
  RELATIONSHIP_STATE_CONFLICT: 'The position has no relationship this change can apply to at that date.',
}

export function structuralText(code: string | undefined): string {
  return (code === undefined ? undefined : STRUCTURAL_TEXT[code]) ?? 'The structural check refused this change.'
}

/** True for a structural refusal code the form explains in its own words. */
export function isStructuralCode(code: string): boolean {
  return code in STRUCTURAL_TEXT
}

/** Everyone the separation-of-duties rule excludes from deciding: opener, submitter, evidence adders, editors. */
export function contributorsOf(c: CaseDetail): ReadonlySet<string> {
  const ids = [
    c.opened_by, c.submitted_by, ...c.evidence.map((item) => item.added_by),
    ...c.events.filter((event) => event.kind === 'updated').map((event) => event.actor_id),
  ]
  return new Set(ids.filter((id): id is string => id !== null))
}

/**
 * Who a user id is, as far as this user can tell: "You", an eligible approver by name, else "Another user".
 * shortcut: case APIs return user ids only and non-admins cannot list users; name everyone once CAS returns names.
 */
export function personName(id: string | null, myId: string, approvers: readonly EligibleApprover[] | null = null): string {
  if (id === null) return 'The system'
  if (id === myId) return 'You'
  const approver = approvers?.find((candidate) => candidate.user_id === id)
  return approver?.display_name ?? approver?.email ?? 'Another user'
}

/** A personName inside a sentence: "you", "another user", "the system", or the name as it is. */
export function inSentence(name: string): string {
  return ['You', 'Another user', 'The system', 'The distributor'].includes(name) ? name.toLowerCase() : name
}

/** personName within a case: a dispute's opener is the distributor's portal account (D-B5-15, BUG-117). */
export function actorName(c: CaseRecord, id: string | null, myId: string, approvers: readonly EligibleApprover[] | null = null): string {
  return c.type === 'dispute' && id !== null && id === c.opened_by ? 'The distributor' : personName(id, myId, approvers)
}

/** "the system", "the distributor", "you" or "another user": who opened the case. */
export function openerText(c: CaseRecord, myId: string): string {
  return c.opened_by_kind === 'system' ? 'the system' : inSentence(actorName(c, c.opened_by, myId))
}

const DATE_ONLY = 10

/** A payload date as entered: "2026-11-17 (UTC)" for a date, the local date and time for an instant. */
export function instantText(value: string, format: (iso: string) => string): string {
  return value.length === DATE_ONLY ? `${value} (UTC)` : format(value)
}

/** Today in UTC as YYYY-MM-DD: genealogy changes and transfers start today (UTC) or later. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, DATE_ONLY)
}

/** The cases a user may read (tabs of SC-06), by permission. */
export function readableTypes(can: (permission: string) => boolean): readonly CaseTypeInfo[] {
  return CASE_TYPES.filter((info) => can(info.read))
}
