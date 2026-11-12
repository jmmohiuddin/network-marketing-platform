import type pg from 'pg'

type Db = pg.Pool | pg.PoolClient

export type AccountType = 'commission_expense' | 'payee_payable' | 'withholding_payable' | 'payout_in_transit' | 'clawback_receivable'
  | 'rounding_residue' | 'breakage' | 'write_off' | 'credit_liability' | 'settled_clearing'

export interface AccountRef { tenantId: string; marketId: string; currency: string; type: AccountType; payeeId?: string | null }

/** Get-or-create (payee accounts are created on first use, MONEY.md §1). */
export async function accountId(db: Db, a: AccountRef): Promise<string> {
  const args = [a.tenantId, a.marketId, a.type, a.payeeId ?? null, a.currency]
  await db.query(`INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, args)
  const r = await db.query<{ id: string }>(`SELECT id FROM ledger_account WHERE tenant_id = $1 AND market_id = $2 AND type = $3
    AND payee_participant_id IS NOT DISTINCT FROM $4 AND credit_type_id IS NULL AND currency = $5`, args)
  const id = r.rows[0]?.id
  if (!id) throw new Error(`ledger account ${a.type} exists with another currency`)
  return id
}

export interface PostingLine { accountId: string; debitMinor: bigint; creditMinor: bigint }
export interface EntryInput {
  tenantId: string; eventType: string; originType: string; originId: string; idempotencyKey: string
  approvalId?: string | null; currency: string; lines: readonly PostingLine[]
}
export interface EntryResult { entryId: string; created: boolean }

export class LedgerInputError extends Error {}

function assertBalanced(lines: readonly PostingLine[]): void {
  if (lines.length < 2) throw new LedgerInputError('an entry needs at least two postings')
  let debit = 0n
  let credit = 0n
  for (const l of lines) {
    if (l.debitMinor < 0n || l.creditMinor < 0n || (l.debitMinor === 0n) === (l.creditMinor === 0n)) {
      throw new LedgerInputError('each posting has exactly one non-zero, non-negative side')
    }
    debit += l.debitMinor
    credit += l.creditMinor
  }
  if (debit !== credit) throw new LedgerInputError(`unbalanced entry: debit ${debit} credit ${credit}`)
}

/**
 * Posts one balanced entry inside the caller's transaction (I-2, I-5).
 * A repeated idempotency key returns the existing entry and posts nothing.
 */
export async function postEntry(client: pg.PoolClient, e: EntryInput): Promise<EntryResult> {
  assertBalanced(e.lines)
  const ins = await client.query<{ id: string }>(`INSERT INTO journal_entry
    (tenant_id, event_type, origin_type, origin_id, idempotency_key, approval_id) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
    [e.tenantId, e.eventType, e.originType, e.originId, e.idempotencyKey, e.approvalId ?? null])
  const created = ins.rows[0]
  if (!created) {
    const existing = await client.query<{ id: string }>('SELECT id FROM journal_entry WHERE tenant_id = $1 AND idempotency_key = $2',
      [e.tenantId, e.idempotencyKey])
    return { entryId: existing.rows[0]!.id, created: false }
  }
  await client.query(`INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency, posted_at)
    SELECT $1, e.id, a, d, c, $3, e.posted_at FROM journal_entry e, unnest($4::uuid[], $5::bigint[], $6::bigint[]) AS l(a, d, c)
    WHERE e.id = $2`, [e.tenantId, created.id, e.currency, e.lines.map((l) => l.accountId),
      e.lines.map((l) => l.debitMinor.toString()), e.lines.map((l) => l.creditMinor.toString())])
  return { entryId: created.id, created: true }
}

/** Reversal as a new entry with every posting's sides swapped; the original is never touched (I-3, I-15). */
export async function reverseEntry(client: pg.PoolClient, r: { tenantId: string; entryId: string; originType: string; originId: string;
  approvalId: string | null }): Promise<EntryResult> {
  const orig = await client.query<{ account_id: string; debit_minor: string; credit_minor: string; currency: string }>(
    'SELECT account_id, debit_minor, credit_minor, currency FROM posting WHERE tenant_id = $1 AND entry_id = $2', [r.tenantId, r.entryId])
  if (orig.rows.length === 0) throw new LedgerInputError(`entry ${r.entryId} not found`)
  return postEntry(client, {
    tenantId: r.tenantId, eventType: 'entry.reversed', originType: r.originType, originId: r.originId,
    idempotencyKey: `reversal:${r.entryId}`, approvalId: r.approvalId, currency: orig.rows[0]!.currency,
    lines: orig.rows.map((p) => ({ accountId: p.account_id, debitMinor: BigInt(p.credit_minor), creditMinor: BigInt(p.debit_minor) })),
  })
}

/** Posting rule #5: refund after payout → Dr clawback_receivable(payee) / Cr commission_expense. */
export async function postClawback(client: pg.PoolClient, c: { tenantId: string; marketId: string; currency: string; payeeId: string;
  amountMinor: bigint; originId: string }): Promise<EntryResult> {
  const base = { tenantId: c.tenantId, marketId: c.marketId, currency: c.currency }
  return postEntry(client, {
    tenantId: c.tenantId, eventType: 'clawback.raised', originType: 'order_event', originId: c.originId,
    idempotencyKey: `claw:${c.originId}`, currency: c.currency,
    lines: [
      { accountId: await accountId(client, { ...base, type: 'clawback_receivable', payeeId: c.payeeId }), debitMinor: c.amountMinor, creditMinor: 0n },
      { accountId: await accountId(client, { ...base, type: 'commission_expense' }), debitMinor: 0n, creditMinor: c.amountMinor },
    ],
  })
}
