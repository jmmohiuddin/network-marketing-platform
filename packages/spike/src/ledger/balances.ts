import type pg from 'pg'

type Db = pg.Pool | pg.PoolClient

export interface Balance { debitMinor: bigint; creditMinor: bigint; postings: bigint }

/** System of record: Σ postings of one account, optionally as of a time (FR-FIN-002). */
export async function balanceFromPostings(db: Db, accountId: string, asOf?: Date | string): Promise<Balance> {
  const r = await db.query<{ d: string; c: string; n: string }>(`SELECT coalesce(sum(debit_minor), 0) AS d,
    coalesce(sum(credit_minor), 0) AS c, count(*) AS n FROM posting WHERE account_id = $1 AND ($2::timestamptz IS NULL OR posted_at <= $2)`,
    [accountId, asOf ?? null])
  const row = r.rows[0]!
  return { debitMinor: BigInt(row.d), creditMinor: BigInt(row.c), postings: BigInt(row.n) }
}

/** Cache: the incremental projection row (zero when the account has never been posted to). */
export async function balanceFromProjection(db: Db, accountId: string): Promise<Balance> {
  const r = await db.query<{ debit_minor: string; credit_minor: string; postings: string }>(
    'SELECT debit_minor, credit_minor, postings FROM account_balance WHERE account_id = $1', [accountId])
  const row = r.rows[0]
  return row ? { debitMinor: BigInt(row.debit_minor), creditMinor: BigInt(row.credit_minor), postings: BigInt(row.postings) }
    : { debitMinor: 0n, creditMinor: 0n, postings: 0n }
}

export interface Reconciliation {
  accounts: bigint; mismatchedAccounts: bigint; unbalancedEntries: bigint; emptyEntries: bigint
  totalDebitMinor: bigint; totalCreditMinor: bigint
}

/** Nightly integrity check (SDD-09 §7): every entry balanced, projection = Σ postings per account. All counts must be 0. */
export async function reconcile(db: Db): Promise<Reconciliation> {
  const r = await db.query<Record<string, string>>(`
    WITH p AS (SELECT account_id, sum(debit_minor) AS d, sum(credit_minor) AS c, count(*) AS n FROM posting GROUP BY account_id),
    acc AS (
      SELECT count(*) AS accounts,
        count(*) FILTER (WHERE p.account_id IS NULL OR b.account_id IS NULL OR p.d <> b.debit_minor OR p.c <> b.credit_minor OR p.n <> b.postings) AS mismatched,
        coalesce(sum(p.d), 0) AS total_d, coalesce(sum(p.c), 0) AS total_c
      FROM p FULL JOIN account_balance b ON b.account_id = p.account_id)
    SELECT acc.*,
      (SELECT count(*) FROM (SELECT 1 FROM posting GROUP BY entry_id HAVING sum(debit_minor) <> sum(credit_minor)) x) AS unbalanced,
      (SELECT count(*) FROM journal_entry e WHERE NOT EXISTS (SELECT 1 FROM posting q WHERE q.entry_id = e.id AND q.posted_at = e.posted_at)) AS empty
    FROM acc`)
  const row = r.rows[0]!
  return {
    accounts: BigInt(row.accounts!), mismatchedAccounts: BigInt(row.mismatched!), unbalancedEntries: BigInt(row.unbalanced!),
    emptyEntries: BigInt(row.empty!), totalDebitMinor: BigInt(row.total_d!), totalCreditMinor: BigInt(row.total_c!),
  }
}
