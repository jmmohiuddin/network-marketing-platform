// Words of tenant offboarding (FR-TEN-005, D-V1A-07), shared by SC-29 (tenant side) and SC-39 (vendor side).
import { countLabel } from '../../lib/format'

export type OffboardingState =
  | 'requested' | 'confirmed' | 'archived' | 'purge_requested' | 'purge_approved' | 'purged' | 'cancelled' | 'restored'

/** One item of SQL offboarding_blockers: the tenant sees up to 20 ids, the vendor counts only (ids absent). */
export interface OffboardingBlocker {
  readonly kind: string
  readonly blocking: boolean
  readonly count: number
  readonly ids?: readonly string[] | null
}

export const OFFBOARDING_STATE_BADGES: Readonly<Record<OffboardingState, { readonly state: string; readonly label: string }>> = {
  requested: { state: 'requested', label: 'Requested by the vendor' },
  confirmed: { state: 'held', label: 'Confirmed: read-only' },
  archived: { state: 'archived', label: 'Archived' },
  purge_requested: { state: 'awaiting_approval', label: 'Purge requested' },
  purge_approved: { state: 'approved', label: 'Purge approved' },
  purged: { state: 'retired', label: 'Purged' },
  cancelled: { state: 'ended', label: 'Cancelled' },
  restored: { state: 'active', label: 'Restored' },
}

/** Each blocker kind: the open item in words (singular, plural) and where the tenant settles it. */
const BLOCKERS: Readonly<Record<string, { readonly one: string; readonly many: string; readonly href: string }>> = {
  run_open: { one: 'calculation run not committed or discarded', many: 'calculation runs not committed or discarded', href: '/periods' },
  period_not_closed: { one: 'committed or paid period not closed', many: 'committed or paid periods not closed', href: '/periods' },
  payout_batch_open: { one: 'payout batch still open', many: 'payout batches still open', href: '/payouts' },
  payout_in_transit: { one: 'payout still in transit', many: 'payouts still in transit', href: '/payouts/reconciliation' },
  payables_outstanding: { one: 'payee with an amount still owed', many: 'payees with amounts still owed', href: '/ledger' },
  receivables_outstanding: { one: 'payee who still owes an amount', many: 'payees who still owe amounts', href: '/ledger' },
  case_open: { one: 'open case', many: 'open cases', href: '/cases' },
  privacy_request_open: { one: 'open privacy request', many: 'open privacy requests', href: '/privacy' },
  export_running: { one: 'data export still running', many: 'data exports still running', href: '/settings/integrations?tab=exports' },
  credits_outstanding: { one: 'member holding unexpired non-cash rewards', many: 'members holding unexpired non-cash rewards', href: '/ledger?tab=credits' },
}

/** "3 open cases"; an unknown kind as words. */
export function blockerText(blocker: Pick<OffboardingBlocker, 'kind' | 'count'>): string {
  const words = BLOCKERS[blocker.kind]
  return words === undefined ? `${blocker.count} × ${blocker.kind.replace(/_/g, ' ')}` : countLabel(blocker.count, words.one, words.many)
}

/** Where the tenant's staff settle the item (null for an unknown kind). */
export function blockerHref(kind: string): string | null {
  return BLOCKERS[kind]?.href ?? null
}
