import type { Tx } from '@nmp/db'
import { ApiError } from '../../lib/errors.js'

// The PAY postings of PLAN B4 section 4.3 through the LED SQL contract ledger_post (D-B4-01: no LED TypeScript import).

/** D-B4-07: every writer of a market's payables takes this lock first (ledger_post takes it again, re-entrant). */
export async function lockLedger(tx: Tx, marketId: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('ledger:' || app_tenant_id() || ':' || $1::text, 0))`, [marketId])
}

/** The payee's payable in the market (normal side, minor units as a decimal string). */
export async function payableOf(tx: Tx, marketId: string, participantId: string): Promise<bigint> {
  const { rows } = await tx.query<{ amount: string }>(`SELECT led_balance($1, $2, 'payee_payable')::text AS amount`, [marketId, participantId])
  return BigInt(rows[0]!.amount)
}

export type InstructionEvent = 'instructed' | 'settled' | 'returned' | 'failed'

export interface PostedInstruction {
  readonly id: string
  readonly marketId: string
  readonly periodId: string
  readonly payeeId: string
  readonly amountMinor: string
}

const line = (type: string, payee: string | null, debit: string, credit: string) => ({
  type, payee_participant_id: payee, debit_minor: debit, credit_minor: credit,
})

// Posting rules #2..#4: returned and failed share one key (MONEY C-15).
const RULES: Record<InstructionEvent, { event: string; key: string; lines: (payee: string, amount: string) => object[] }> = {
  instructed: { event: 'payout_instructed', key: 'instructed', lines: (p, a) => [line('payee_payable', p, a, '0'), line('payout_in_transit', null, '0', a)] },
  settled: { event: 'payout_settled', key: 'settled', lines: (_p, a) => [line('payout_in_transit', null, a, '0'), line('settled_clearing', null, '0', a)] },
  returned: { event: 'payout_returned', key: 'returned', lines: (p, a) => [line('payout_in_transit', null, a, '0'), line('payee_payable', p, '0', a)] },
  failed: { event: 'payout_failed', key: 'returned', lines: (p, a) => [line('payout_in_transit', null, a, '0'), line('payee_payable', p, '0', a)] },
}

/** ledger_post refuses a closed period (23514 DETAIL period_closed, D-B6-04): nothing more posts into it. */
function periodClosed(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514' && 'detail' in error && error.detail === 'period_closed') {
    throw new ApiError(409, 'PERIOD_CLOSED', "The payout's period is closed: nothing more posts into it.")
  }
  throw error
}

/** One balanced entry for the instruction's event; approval only for instructed (provider-driven events take none). */
export async function postInstruction(tx: Tx, event: InstructionEvent, i: PostedInstruction, approvalId: string | null): Promise<void> {
  const rule = RULES[event]
  await tx.query(
    `SELECT ledger_post($1, $2, $3, 'payout_instruction', $4, $5, $6, $7::jsonb)`,
    [i.marketId, i.periodId, rule.event, i.id, `instr:${i.id}:${rule.key}`, approvalId, JSON.stringify(rule.lines(i.payeeId, i.amountMinor))],
  ).catch(periodClosed)
}
