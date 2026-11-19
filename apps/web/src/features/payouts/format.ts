import { isApiError } from '../../lib/api'
import type { Market } from '../../lib/markets'
import { keyLabel } from '../admin/settings/labels'
import { moneyText } from '../orders/format'
import { periodText } from '../periods/format'
import type { Adapter, Batch, BatchState, InstructionState, PayeeRef, PayoutException } from './types'

export const BATCH_STATE_LABELS: Readonly<Record<BatchState, string>> = {
  draft: 'Draft', reviewed: 'Awaiting approval', approved: 'Approved', instructing: 'Instructing', partially_settled: 'Partially settled',
  settled: 'Settled', failed: 'Failed', cancelled: 'Cancelled',
}

/** StatusBadge state per batch state (its tone family, UI_UX 1.5). */
export const BATCH_BADGES: Readonly<Record<BatchState, string>> = {
  draft: 'draft', reviewed: 'reviewed', approved: 'approved', instructing: 'instructing', partially_settled: 'held', settled: 'settled',
  failed: 'failed', cancelled: 'retired',
}

export const INSTRUCTION_STATES: readonly InstructionState[] = ['pending', 'instructed', 'accepted', 'settled', 'returned', 'failed', 'cancelled']

export const INSTRUCTION_STATE_LABELS: Readonly<Record<InstructionState, string>> = {
  pending: 'Pending', instructed: 'Instructed', accepted: 'Accepted by provider', settled: 'Settled', returned: 'Returned', failed: 'Failed',
  cancelled: 'Cancelled',
}

export const INSTRUCTION_BADGES: Readonly<Record<InstructionState, string>> = {
  pending: 'pending', instructed: 'instructed', accepted: 'accepted', settled: 'settled', returned: 'returned', failed: 'failed', cancelled: 'retired',
}

export const ADAPTER_LABELS: Readonly<Record<Adapter, string>> = { sandbox: 'Sandbox', bank_file_csv: 'Bank file (CSV)' }

export const adapterText = (adapter: Adapter | null): string => (adapter === null ? 'No adapter' : ADAPTER_LABELS[adapter])

const LAST_ERRORS: Readonly<Record<string, string>> = {
  SIGNATURE_INVALID: 'The signature check failed, so it was not sent.',
  PROVIDER_OUTCOME_UNKNOWN: 'The provider did not answer; its status is asked again.',
}

/** The dispatcher's codes in words; a provider's return or failure reason as it gave it. */
export function lastErrorText(error: string | null): string {
  return error === null ? '—' : LAST_ERRORS[error] ?? error
}

export const EXCEPTION_KIND_LABELS: Readonly<Record<PayoutException['kind'], string>> = {
  unknown_reference: 'Unknown reference', amount_mismatch: 'Amount does not match', duplicate_settlement: 'Event for a finished instruction',
}

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  created: 'Instruction created', instructed: 'Sent to the provider', accepted: 'Accepted by the provider', settled: 'Settled', returned: 'Returned by the bank',
  failed: 'Failed',
}

const ACCOUNT_LABELS: Readonly<Record<string, string>> = {
  payee_payable: 'Payee payable', payout_in_transit: 'Payout in transit', settled_clearing: 'Settled clearing', commission_expense: 'Commission expense',
  clawback_receivable: 'Clawback receivable',
}

export const accountText = (type: string): string => ACCOUNT_LABELS[type] ?? type.replaceAll('_', ' ')

/** "Avery Test (DE-A)"; the reference alone when there is no name. */
export function payeeText(payee: PayeeRef): string {
  if (payee.display_name === null) return payee.external_ref ?? payee.id
  return payee.external_ref === null ? payee.display_name : `${payee.display_name} (${payee.external_ref})`
}

/** Sums per currency, formatted with each currency's minor unit ("23.00 EUR · 10.00 USD"); "0" without items. */
export function totalsText(items: readonly { readonly minor: string; readonly marketId: string }[], markets: ReadonlyMap<string, Market>): string | null {
  const sums = new Map<string, { minor: bigint; minorUnit: number }>()
  for (const item of items) {
    const market = markets.get(item.marketId)
    if (market === undefined) return null
    const sum = sums.get(market.currency)
    sums.set(market.currency, { minor: (sum?.minor ?? 0n) + BigInt(item.minor), minorUnit: market.minor_unit })
  }
  if (sums.size === 0) return '0'
  return [...sums].map(([currency, sum]) => moneyText(sum.minor.toString(), currency, sum.minorUnit)).join(' · ')
}

/** Markets by id (GET /v1/markets). */
export const marketsById = (markets: readonly Market[] | null): ReadonlyMap<string, Market> => new Map((markets ?? []).map((market) => [market.id, market]))

export const batchPath = (id: string): string => `/payouts/${id}`

/** "Aug 1, 2026 – Aug 31, 2026" in the market's zone (the market zone stands in for the cut-off zone, as on plan screens). */
export const batchPeriod = (batch: Pick<Batch, 'period'>, market: Market | undefined): string => periodText(batch.period, market?.time_zone)

/** A 422 SETTING_NOT_CONFIGURED refusal in words naming the setting and who sets it; null for any other error. */
export function unconfiguredSetting(error: unknown): string | null {
  const key = isApiError(error, 'SETTING_NOT_CONFIGURED') ? (error.details as { key?: string } | null)?.key : undefined
  return key === undefined ? null : `The setting "${keyLabel(key)}" is not configured. A tenant admin sets it in Settings.`
}
