// Words and exact amounts of SC-33. Money stays a minor-unit string: no Number arithmetic on it.
import type { AccountType, AgeBucket } from './types'

/** The eleven account types in the API's order (D-B4-04; migration_clearing D-B6-10), in words. */
export const ACCOUNT_LABELS: Readonly<Record<AccountType, string>> = {
  commission_expense: 'Commission expense',
  payee_payable: 'Payee payable',
  withholding_payable: 'Withholding payable',
  payout_in_transit: 'Payouts in transit',
  clawback_receivable: 'Clawback receivable',
  rounding_residue: 'Rounding residue',
  write_off: 'Write-off',
  credit_liability: 'Credit liability',
  breakage: 'Breakage',
  settled_clearing: 'Settled clearing',
  migration_clearing: 'Migration clearing',
}

export const accountLabel = (type: string): string => ACCOUNT_LABELS[type as AccountType] ?? type

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  run_committed: 'Run committed',
  payout_instructed: 'Payout instructed',
  payout_settled: 'Payout settled',
  payout_returned: 'Payout returned',
  payout_failed: 'Payout failed',
  write_off: 'Write-off',
}

export const eventLabel = (event: string): string => EVENT_LABELS[event] ?? event

export const ORIGIN_LABELS: Readonly<Record<string, string>> = { run: 'Run', payout_instruction: 'Payout instruction', case: 'Case', migration: 'Migration' }

export const BUCKET_LABELS: Readonly<Record<AgeBucket, string>> = { '0_30': '0–30 days', '31_60': '31–60 days', '61_90': '61–90 days', over_90: 'Over 90 days' }

const SIGNED_DECIMAL = /^(-)?(\d{1,15})(?:\.(\d+))?$/

/**
 * "12.50" with 2 decimals -> "1250", "-5" -> "-500": a decimal amount in minor units by string arithmetic; null when it
 * is not a number or has more decimals than the currency.
 */
export function decimalToMinor(text: string, minorUnit: number): string | null {
  const match = SIGNED_DECIMAL.exec(text.trim().replace('−', '-'))
  if (match === null) return null
  const fraction = match[3] ?? ''
  if (fraction.length > minorUnit) return null
  const digits = `${match[2]}${fraction.padEnd(minorUnit, '0')}`.replace(/^0+(?=\d)/, '')
  return digits === '0' ? '0' : `${match[1] ?? ''}${digits}`
}

/** The sum of minor-unit strings. */
export const sumMinor = (values: readonly string[]): string => values.reduce((sum, value) => sum + BigInt(value), 0n).toString()

/** "ledger?market=…&tab=…": SC-33 links (SC-02 commit, SC-09 balances). */
export function ledgerPath(marketId: string, tab?: string, extra: Readonly<Record<string, string>> = {}): string {
  const query = new URLSearchParams({ market: marketId, ...(tab === undefined ? {} : { tab }), ...extra })
  return `/ledger?${query.toString()}`
}
