import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { balanceFromPostings, balanceFromProjection, reconcile } from '../../src/ledger/balances.js'
import { inTransaction, ledgerPool, resetSchema } from '../../src/ledger/db.js'
import { accountId, LedgerInputError, postClawback, postEntry, reverseEntry, type AccountRef } from '../../src/ledger/poster.js'
import { commitRun, ControlTotalError, type PayeeResult } from '../../src/ledger/run-commit.js'
import { syntheticBatches, syntheticId, withholding } from '../../src/ledger/synthetic.js'

const SCHEMA = 'spike_ledger_test'
const TENANT = syntheticId(9, 1)
const MARKET = syntheticId(9, 2)
const APPROVAL = syntheticId(9, 3)
const CUR = 'INR'
const FIXTURE_WITHHOLDING_BP = 200n // labelled test fixture (TS-38: 2.00%), not a product value
const market = { tenantId: TENANT, marketId: MARKET, currency: CUR }
let pool: pg.Pool
let runSeq = 100

const nextRun = (): string => syntheticId(2, runSeq++)
const acct = (type: AccountRef['type'], payeeId?: string): Promise<string> => accountId(pool, { ...market, type, payeeId })
const net = async (id: string): Promise<bigint> => { const b = await balanceFromPostings(pool, id); return b.creditMinor - b.debitMinor }
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await pool.query(sql, args)).rows[0].n)

async function sqlError(fn: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await fn() } catch (e) { return e as { code?: string; message: string } }
  throw new Error('expected a database error')
}

beforeAll(async () => {
  pool = ledgerPool(SCHEMA, 6)
  await resetSchema(pool, SCHEMA)
})
afterAll(async () => { await pool.end() })

describe('run commit poster', () => {
  test('TS-38: one balanced entry per payee, gross = payable + withholding, outbox row in the same transaction', async () => {
    const payee = syntheticId(1, 999_001)
    const wh = withholding(123456n, FIXTURE_WITHHOLDING_BP)
    expect(wh).toBe(2469n)
    const runId = nextRun()
    const out = await commitRun(pool, { ...market, runId, approvalId: APPROVAL, batches: [[{ payeeId: payee, grossMinor: 123456n, withholdingMinor: wh }]] })
    expect(out).toMatchObject({ status: 'committed', totals: { entries: 1n, postings: 3n, expenseMinor: 123456n, payableMinor: 120987n, withholdingMinor: 2469n } })
    expect(await net(await acct('payee_payable', payee))).toBe(120987n)
    expect(await count('SELECT count(*) AS n FROM outbox_event WHERE topic = $1 AND key = $2', ['run.committed', runId])).toBe(1)
  })

  test('batched run: entries = payees, AC-14.2 expense = payable + withholding, projection equals postings', async () => {
    const runId = nextRun()
    const batches = [...syntheticBatches({ payees: 2_500, batchSize: 700, seed: 7, withholdingBasisPoints: FIXTURE_WITHHOLDING_BP, maxGrossMinor: 500_000 })]
    const out = await commitRun(pool, { ...market, runId, approvalId: APPROVAL, batches })
    if (out.status !== 'committed') throw new Error('not committed')
    expect(out.totals.entries).toBe(2_500n)
    expect(out.totals.expenseMinor).toBe(out.totals.payableMinor + out.totals.withholdingMinor)
    expect(await count(`SELECT count(*) AS n FROM journal_entry WHERE origin_type = 'run' AND origin_id = $1`, [runId])).toBe(2_500)
    const r = await reconcile(pool)
    expect([r.mismatchedAccounts, r.unbalancedEntries, r.emptyEntries]).toEqual([0n, 0n, 0n])
    expect(r.totalDebitMinor).toBe(r.totalCreditMinor)
  })

  test('concurrent double commit of the same run posts exactly once', async () => {
    const runId = nextRun()
    const batches = (): PayeeResult[][] => [...syntheticBatches({ payees: 3_000, batchSize: 500, seed: 11, withholdingBasisPoints: FIXTURE_WITHHOLDING_BP, maxGrossMinor: 90_000 })]
    const run = { ...market, runId, approvalId: APPROVAL }
    const outcomes = await Promise.all([commitRun(pool, { ...run, batches: batches() }), commitRun(pool, { ...run, batches: batches() })])
    expect(outcomes.map((o) => o.status).sort()).toEqual(['already_committed', 'committed'])
    expect(await count(`SELECT count(*) AS n FROM journal_entry WHERE origin_id = $1`, [runId])).toBe(3_000)
    expect(await count(`SELECT count(*) AS n FROM outbox_event WHERE key = $1`, [runId])).toBe(1)
    expect((await commitRun(pool, { ...run, batches: batches() })).status).toBe('already_committed')
  })

  test('control totals are blocking: a duplicate payee refuses the whole commit and leaves nothing behind', async () => {
    const runId = nextRun()
    const line = { payeeId: syntheticId(1, 999_002), grossMinor: 1000n, withholdingMinor: 20n }
    await expect(commitRun(pool, { ...market, runId, approvalId: APPROVAL, batches: [[line], [line]] })).rejects.toBeInstanceOf(ControlTotalError)
    expect(await count('SELECT count(*) AS n FROM run_commit WHERE run_id = $1', [runId])).toBe(0)
    expect(await count('SELECT count(*) AS n FROM journal_entry WHERE origin_id = $1', [runId])).toBe(0)
    // the run guard rolled back with it, so a corrected retry commits
    expect((await commitRun(pool, { ...market, runId, approvalId: APPROVAL, batches: [[line]] })).status).toBe('committed')
  })

  test('invalid result lines are rejected before posting', async () => {
    const bad = { payeeId: syntheticId(1, 999_003), grossMinor: 100n, withholdingMinor: 101n }
    await expect(commitRun(pool, { ...market, runId: nextRun(), approvalId: APPROVAL, batches: [[bad]] })).rejects.toBeInstanceOf(LedgerInputError)
  })
})

describe('database invariants', () => {
  test('I-2: an unbalanced entry is rejected at COMMIT, while a temporarily unbalanced one may be completed', async () => {
    const expense = await acct('commission_expense')
    const payable = await acct('payee_payable', syntheticId(1, 999_010))
    const write = (client: pg.PoolClient, key: string, credit: string | null) => (async () => {
      const e = await client.query(`INSERT INTO journal_entry (tenant_id, event_type, origin_type, origin_id, idempotency_key)
        VALUES ($1, 'test', 'test', $1, $2) RETURNING id`, [TENANT, key])
      const { id } = e.rows[0]
      const posted_at = (await client.query('SELECT now()::text AS t')).rows[0].t
      await client.query(`INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency, posted_at)
        VALUES ($1, $2, $3, 500, 0, $4, $5)`, [TENANT, id, expense, CUR, posted_at])
      if (credit) await client.query(`INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency, posted_at)
        VALUES ($1, $2, $3, 0, ${credit}, $4, $5)`, [TENANT, id, payable, CUR, posted_at])
    })()
    expect((await sqlError(() => inTransaction(pool, (c) => write(c, 'unbalanced-1', '499')))).code).toBe('23514')
    expect((await sqlError(() => inTransaction(pool, (c) => write(c, 'one-sided-1', null)))).code).toBe('23514')
    await inTransaction(pool, (c) => write(c, 'balanced-1', '500'))
    expect(await count(`SELECT count(*) AS n FROM journal_entry WHERE idempotency_key LIKE 'unbalanced%' OR idempotency_key LIKE 'one-sided%'`)).toBe(0)
  })

  test('I-2: an entry without postings is rejected', async () => {
    const err = await sqlError(() => inTransaction(pool, (c) => c.query(`INSERT INTO journal_entry (tenant_id, event_type, origin_type, origin_id, idempotency_key)
      VALUES ($1, 'test', 'test', $1, 'empty-1')`, [TENANT])))
    expect(err.code).toBe('23514')
  })

  test('I-2: a posting added to an already committed entry is rejected', async () => {
    const expense = await acct('commission_expense')
    const { entryId } = await inTransaction(pool, async (c) => postEntry(c, { ...market, eventType: 'test', originType: 'test', originId: TENANT,
      idempotencyKey: 'late-add-1', lines: [{ accountId: expense, debitMinor: 10n, creditMinor: 0n },
        { accountId: await acct('breakage'), debitMinor: 0n, creditMinor: 10n }] }))
    const err = await sqlError(() => inTransaction(pool, (c) => c.query(`INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency, posted_at)
      SELECT tenant_id, id, $2, 1, 0, 'INR', posted_at FROM journal_entry WHERE id = $1`, [entryId, expense])))
    expect(err.code).toBe('23514')
  })

  test('TS-39 / I-3: UPDATE, DELETE and TRUNCATE on journal_entry and posting are rejected', async () => {
    for (const sql of ['UPDATE posting SET debit_minor = debit_minor', 'DELETE FROM posting', 'TRUNCATE posting',
      'UPDATE journal_entry SET event_type = event_type', 'DELETE FROM journal_entry', 'TRUNCATE journal_entry CASCADE', 'DELETE FROM run_commit']) {
      expect((await sqlError(() => pool.query(sql))).code, sql).toBe('42501')
    }
  })

  test('I-5: a repeated idempotency key returns the existing entry and posts nothing', async () => {
    const lines = [{ accountId: await acct('commission_expense'), debitMinor: 700n, creditMinor: 0n },
      { accountId: await acct('payee_payable', syntheticId(1, 999_020)), debitMinor: 0n, creditMinor: 700n }]
    const input = { ...market, eventType: 'test', originType: 'case', originId: syntheticId(3, 1), idempotencyKey: 'adj:case-1', approvalId: APPROVAL, lines }
    const first = await inTransaction(pool, (c) => postEntry(c, input))
    const again = await inTransaction(pool, (c) => postEntry(c, input))
    expect(first.created).toBe(true)
    expect(again).toEqual({ entryId: first.entryId, created: false })
    expect(await count('SELECT count(*) AS n FROM posting WHERE entry_id = $1', [first.entryId])).toBe(2)
  })

  test('the poster rejects unbalanced or malformed lines before touching the database', async () => {
    const a = await acct('commission_expense')
    const b = await acct('breakage')
    const base = { ...market, eventType: 'test', originType: 'test', originId: TENANT, idempotencyKey: 'bad-1' }
    for (const lines of [[{ accountId: a, debitMinor: 5n, creditMinor: 0n }, { accountId: b, debitMinor: 0n, creditMinor: 4n }],
      [{ accountId: a, debitMinor: 5n, creditMinor: 5n }, { accountId: b, debitMinor: 0n, creditMinor: 0n }],
      [{ accountId: a, debitMinor: -5n, creditMinor: 0n }, { accountId: b, debitMinor: 0n, creditMinor: -5n }]]) {
      await expect(inTransaction(pool, (c) => postEntry(c, { ...base, lines }))).rejects.toBeInstanceOf(LedgerInputError)
    }
  })
})

describe('clawback and reversal as new entries', () => {
  test('TS-11: clawback 40.00 vs next earnings 25.00 → payable 0, receivable 15.00 carried, write-off 15.00', async () => {
    const payee = syntheticId(1, 999_030)
    const payable = await acct('payee_payable', payee)
    const receivable = await acct('clawback_receivable', payee)
    await postInTx(postClawbackFor(payee, 4000n))
    expect(-(await net(receivable))).toBe(4000n)
    await commitRun(pool, { ...market, runId: nextRun(), approvalId: APPROVAL, batches: [[{ payeeId: payee, grossMinor: 2500n, withholdingMinor: 0n }]] })
    // Netting (#6) up to the available payable
    await postInTx((c) => postEntry(c, { ...market, eventType: 'clawback.netted', originType: 'run', originId: syntheticId(3, 2),
      idempotencyKey: `net:${payee}:1`, lines: [{ accountId: payable, debitMinor: 2500n, creditMinor: 0n }, { accountId: receivable, debitMinor: 0n, creditMinor: 2500n }] }))
    expect(await net(payable)).toBe(0n)
    expect(-(await net(receivable))).toBe(1500n)
    // Approved write-off (#7)
    await postInTx(async (c) => postEntry(c, { ...market, eventType: 'receivable.written_off', originType: 'case', originId: syntheticId(3, 3),
      idempotencyKey: `writeoff:${syntheticId(3, 3)}`, approvalId: APPROVAL,
      lines: [{ accountId: await acct('write_off'), debitMinor: 1500n, creditMinor: 0n }, { accountId: receivable, debitMinor: 0n, creditMinor: 1500n }] }))
    expect(await net(receivable)).toBe(0n)
  })

  test('reversal posts a mirror entry, leaves the original untouched, and is idempotent', async () => {
    const payee = syntheticId(1, 999_040)
    const runId = nextRun()
    await commitRun(pool, { ...market, runId, approvalId: APPROVAL, batches: [[{ payeeId: payee, grossMinor: 9800n, withholdingMinor: 196n }]] })
    const orig = (await pool.query(`SELECT id FROM journal_entry WHERE origin_id = $1`, [runId])).rows[0].id as string
    const before = await pool.query('SELECT id, account_id, debit_minor, credit_minor FROM posting WHERE entry_id = $1 ORDER BY id', [orig])
    const rev = { tenantId: TENANT, entryId: orig, originType: 'case', originId: syntheticId(3, 4), approvalId: APPROVAL }
    const first = await postInTx((c) => reverseEntry(c, rev))
    const again = await postInTx((c) => reverseEntry(c, rev))
    expect(again).toEqual({ entryId: first.entryId, created: false })
    expect(await net(await acct('payee_payable', payee))).toBe(0n)
    expect((await pool.query('SELECT id, account_id, debit_minor, credit_minor FROM posting WHERE entry_id = $1 ORDER BY id', [orig])).rows).toEqual(before.rows)
  })

  test('balance as of a time excludes later postings; projection equals derived balance', async () => {
    const payee = syntheticId(1, 999_050)
    const payable = await acct('payee_payable', payee)
    await commitRun(pool, { ...market, runId: nextRun(), approvalId: APPROVAL, batches: [[{ payeeId: payee, grossMinor: 1000n, withholdingMinor: 0n }]] })
    const cut = (await pool.query('SELECT now()::text AS t')).rows[0].t as string // text keeps µs; a JS Date would drop them
    await commitRun(pool, { ...market, runId: nextRun(), approvalId: APPROVAL, batches: [[{ payeeId: payee, grossMinor: 300n, withholdingMinor: 0n }]] })
    expect((await balanceFromPostings(pool, payable, cut)).creditMinor).toBe(1000n)
    expect(await balanceFromProjection(pool, payable)).toEqual(await balanceFromPostings(pool, payable))
  })
})

describe('reconciliation', () => {
  test('0 unexplained difference after every scenario above, and a tampered projection is detected', async () => {
    const clean = await reconcile(pool)
    expect([clean.mismatchedAccounts, clean.unbalancedEntries, clean.emptyEntries]).toEqual([0n, 0n, 0n])
    expect(clean.totalDebitMinor).toBe(clean.totalCreditMinor)
    // the projection is a cache (I-4): tampering is allowed by the DB but must be caught
    await pool.query('UPDATE account_balance SET credit_minor = credit_minor + 1 WHERE account_id = (SELECT account_id FROM account_balance LIMIT 1)')
    expect((await reconcile(pool)).mismatchedAccounts).toBe(1n)
  })
})

function postInTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> { return inTransaction(pool, fn) }
function postClawbackFor(payeeId: string, amountMinor: bigint): (c: pg.PoolClient) => ReturnType<typeof postClawback> {
  return (c: pg.PoolClient) => postClawback(c, { ...market, payeeId, amountMinor, originId: syntheticId(4, Number(amountMinor)) })
}
