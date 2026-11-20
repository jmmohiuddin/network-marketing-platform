import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'

// LED shared pieces (PLAN B4 D-B4-03/04/07): the account types, their normal side, the market's ledger lock and the
// market lookup every ledger read starts from.

export const ACCOUNT_TYPES = [
  'commission_expense', 'payee_payable', 'withholding_payable', 'payout_in_transit', 'clawback_receivable', 'rounding_residue',
  'write_off', 'credit_liability', 'breakage', 'settled_clearing', 'migration_clearing',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

// migration_clearing carries the legacy payables taken over at a cutover (Dr clearing / Cr payee_payable, D-B6-10).
const DEBIT_NORMAL: ReadonlySet<string> = new Set(['commission_expense', 'clawback_receivable', 'write_off', 'rounding_residue', 'migration_clearing'])

export const normalSide = (type: string): 'debit' | 'credit' => (DEBIT_NORMAL.has(type) ? 'debit' : 'credit')

/** Signed storage, normal side for display (MONEY C-3): the balance as a decimal minor-unit string. */
export function balanceOf(type: string, debitMinor: string, creditMinor: string): string {
  const net = BigInt(debitMinor) - BigInt(creditMinor)
  return (normalSide(type) === 'debit' ? net : -net).toString()
}

/** D-B4-07 market ledger lock, waiting: for a writer that has not audited yet in its transaction (ledger before audit). */
export async function lockLedger(tx: Tx, marketId: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || $1, 0))`, [marketId])
}

/**
 * D-B4-07 market ledger lock (ledger_post takes it, re-entrant) without waiting, for a writer that already holds the
 * tenant's audit lock (a CAS decision has written its audit events). Lock order for every writer: ledger before audit;
 * never wait on the ledger lock after auditing (commits and PAY post under it and audit after: a wait could deadlock).
 */
export async function tryLockLedger(tx: Tx, marketId: string): Promise<boolean> {
  const { rows } = await tx.query<{ held: boolean }>(
    `SELECT pg_try_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || $1, 0)) AS held`, [marketId])
  return rows[0]!.held
}

export interface MarketRow {
  readonly id: string
  readonly code: string
  readonly currency: string
  readonly minor_digits: number
}

/** The market when it exists and is in scope (null = all markets); 404 otherwise. */
export async function marketInScope(tx: Tx, id: string, scope: readonly string[] | null): Promise<MarketRow> {
  const { rows } = await tx.query<MarketRow>('SELECT id, code, currency, minor_unit::int AS minor_digits FROM market WHERE id = $1', [id])
  const market = rows[0]
  if (market === undefined || (scope !== null && !scope.includes(market.id))) throw notFound()
  return market
}

/** Minor units as a decimal string with the market's digits, by string arithmetic ("123456", 2 -> "1234.56"). */
export function decimalOf(minor: string, digits: number): string {
  if (digits === 0) return minor
  const negative = minor.startsWith('-')
  const padded = (negative ? minor.slice(1) : minor).padStart(digits + 1, '0')
  return `${negative ? '-' : ''}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
