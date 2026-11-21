// Words and exact amounts of SC-33. Money and rates stay strings: no Number arithmetic on them.
import { ApiError } from '../../lib/api'
import type { AccountType, AgeBucket, FxRateRow } from './types'

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
  migration_opening: 'Migration opening balances',
  credit_redeemed: 'Credits redeemed',
  credit_expired: 'Credits expired',
}

export const eventLabel = (event: string): string => EVENT_LABELS[event] ?? event

export const ORIGIN_LABELS: Readonly<Record<string, string>> = {
  run: 'Run', payout_instruction: 'Payout instruction', case: 'Case', migration: 'Migration', credit_redemption: 'Credit redemption', credit_award: 'Credit award',
}

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

/** FX_RATE_SCALE (D-V1A-10): a rate has exactly 10 fractional digits on the wire. */
const RATE_SCALE = 10
const RATE_INPUT = /^(\d{1,10})(?:\.(\d{1,10}))?$/
const CURRENCY = /^[A-Z]{3}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Seconds are required: the API's z.iso.datetime({offset: true}) refuses "T00:00Z". */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
/** D-V1A-10 FX_BATCH_ROWS_MAX. */
export const FX_BATCH_ROWS_MAX = 500
const CSV_HEADER = 'base,quote,rate,valid_from'

/** "0.93" -> "0.9300000000" (string padding, exact); null unless a positive decimal of at most 10+10 digits. */
export function normalRate(text: string): string | null {
  const match = RATE_INPUT.exec(text.trim())
  if (match === null) return null
  const rate = `${match[1]}.${(match[2] ?? '').padEnd(RATE_SCALE, '0')}`
  return /[1-9]/.test(rate) ? rate : null
}

/** A rate's start: a day is 00:00 UTC that day; an instant must name its offset. Null when neither. */
export function validFromOf(text: string): string | null {
  const value = text.trim()
  if (DAY.test(value)) return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : `${value}T00:00:00Z`
  return INSTANT.test(value) && !Number.isNaN(Date.parse(value)) ? value : null
}

/** The first problem of an entered rate row in words, or null; the row as the API takes it otherwise. */
export function rateRowOf(row: FxRateRow): { readonly issue: string } | { readonly row: FxRateRow } {
  const base = row.base.trim().toUpperCase()
  const quote = row.quote.trim().toUpperCase()
  if (!CURRENCY.test(base) || !CURRENCY.test(quote)) return { issue: 'Base and quote are three-letter ISO 4217 currency codes.' }
  if (base === quote) return { issue: 'Base and quote must differ.' }
  const rate = normalRate(row.rate)
  if (rate === null) return { issue: 'The rate is a positive decimal with at most 10 decimals, for example 0.93.' }
  const validFrom = validFromOf(row.valid_from)
  if (validFrom === null) return { issue: 'Valid from is a date (YYYY-MM-DD, from 00:00 UTC) or an instant with its offset.' }
  return { row: { base, quote, rate, valid_from: validFrom } }
}

/**
 * A CSV file of rates (header base,quote,rate,valid_from, one rate per line) as rows to edit, or the reason it is not
 * one. Values are kept as written: the row checks apply after.
 * shortcut: no quoted fields (codes, rates and instants never contain commas); use a CSV parser if sources send quoting.
 */
export function parseRatesCsv(text: string): { readonly rows: readonly FxRateRow[] } | { readonly error: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  if (lines[0]?.toLowerCase().replace(/\s/g, '') !== CSV_HEADER) return { error: `The first line must be the header ${CSV_HEADER}.` }
  const body = lines.slice(1)
  if (body.length === 0) return { error: 'The file has no rate rows.' }
  if (body.length > FX_BATCH_ROWS_MAX) return { error: `The file has ${body.length} rows; a batch takes at most ${FX_BATCH_ROWS_MAX}.` }
  const rows: FxRateRow[] = []
  for (const [index, line] of body.entries()) {
    const values = line.split(',').map((value) => value.trim())
    if (values.length !== 4) return { error: `Line ${index + 2} has ${values.length} values; each line needs base, quote, rate and valid_from.` }
    rows.push({ base: values[0]!, quote: values[1]!, rate: values[2]!, valid_from: values[3]! })
  }
  return { rows }
}

/** A refusal naming its field in details ({field}) as a VALIDATION_FAILED issue, so a form links it to the field. */
export function asFieldIssue(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return error
  const details = error.details as { field?: unknown; issues?: unknown } | null
  if (details?.issues !== undefined || typeof details?.field !== 'string') return error
  return new ApiError(error.status, error.code, error.message, { issues: [{ path: details.field, message: error.message }] }, error.requestId)
}

/** A batch refusal naming a row ({row}, 0-based) says which row, counted from 1 as the editor shows them. */
export function rowRefusal(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error
  const row = (error.details as { row?: unknown } | null)?.row
  return typeof row === 'number' ? new ApiError(error.status, error.code, `Row ${row + 1}: ${error.message}`, error.details, error.requestId) : error
}
