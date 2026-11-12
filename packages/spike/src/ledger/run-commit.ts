import type pg from 'pg'
import { accountId, LedgerInputError } from './poster.js'

/** One payout line per payee after the rounding and withholding passes (FR-COMP-003 pass order). */
export interface PayeeResult { payeeId: string; grossMinor: bigint; withholdingMinor: bigint }

export interface RunToCommit {
  tenantId: string; marketId: string; currency: string; runId: string; approvalId: string
  batches: Iterable<readonly PayeeResult[]>
}

export interface Totals { entries: bigint; postings: bigint; expenseMinor: bigint; payableMinor: bigint; withholdingMinor: bigint }
/** postMs = batches + control totals; commitMs = COMMIT, where the deferred balance triggers run. */
export type CommitOutcome = { status: 'committed'; totals: Totals; postMs: number; commitMs: number } | { status: 'already_committed' }

export class ControlTotalError extends Error {}

const ZERO: Totals = { entries: 0n, postings: 0n, expenseMinor: 0n, payableMinor: 0n, withholdingMinor: 0n }
const add = (a: Totals, b: Totals): Totals => ({
  entries: a.entries + b.entries, postings: a.postings + b.postings, expenseMinor: a.expenseMinor + b.expenseMinor,
  payableMinor: a.payableMinor + b.payableMinor, withholdingMinor: a.withholdingMinor + b.withholdingMinor,
})

// now() is the transaction start, so every entry and posting of the run shares posted_at (never round-trip it via JS Date: µs are lost).
// One round trip per batch: entries (idempotent), then their postings; the projection trigger fires once per statement.
const BATCH_SQL = `
WITH line AS (
  SELECT l.payee_id, l.gross, l.wh, a.id AS payable_id,
    'run:' || $3::text || ':payee:' || l.payee_id::text AS idem
  FROM unnest($4::uuid[], $5::bigint[], $6::bigint[]) AS l(payee_id, gross, wh)
  JOIN ledger_account a ON a.tenant_id = $1 AND a.market_id = $2 AND a.type = 'payee_payable'
    AND a.payee_participant_id = l.payee_id AND a.credit_type_id IS NULL
), entry AS (
  INSERT INTO journal_entry (tenant_id, event_type, origin_type, origin_id, idempotency_key, approval_id, posted_at)
  SELECT $1, 'run.committed', 'run', $3::uuid, idem, $7, now() FROM line
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING id, idempotency_key
), post AS (
  INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency, posted_at)
  SELECT $1, e.id, p.account_id, p.debit, p.credit, $10, now()
  FROM entry e JOIN line l ON l.idem = e.idempotency_key
  CROSS JOIN LATERAL (VALUES ($8::uuid, l.gross, 0::bigint), (l.payable_id, 0::bigint, l.gross - l.wh), ($9::uuid, 0::bigint, l.wh))
    AS p(account_id, debit, credit)
  WHERE p.debit + p.credit > 0
  RETURNING account_id, debit_minor, credit_minor
)
SELECT (SELECT count(*) FROM entry) AS entries, count(*) AS postings,
  coalesce(sum(debit_minor) FILTER (WHERE account_id = $8), 0) AS expense,
  coalesce(sum(credit_minor) FILTER (WHERE account_id NOT IN ($8, $9)), 0) AS payable,
  coalesce(sum(credit_minor) FILTER (WHERE account_id = $9), 0) AS withholding
FROM post`

function validate(line: PayeeResult): void {
  if (line.grossMinor <= 0n || line.withholdingMinor < 0n || line.withholdingMinor > line.grossMinor) {
    throw new LedgerInputError(`invalid result for payee ${line.payeeId}: gross ${line.grossMinor} withholding ${line.withholdingMinor}`)
  }
}

/**
 * Commits a run's results in ONE transaction: run guard row, one balanced entry per payee (posted in batches),
 * blocking control totals, and the run.committed outbox row (FR-COMP-006, TR-FIN-01).
 * A second commit of the same run (concurrent or later) waits on the guard row and posts nothing.
 */
export async function commitRun(pool: pg.Pool, run: RunToCommit): Promise<CommitOutcome> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const guard = await client.query('INSERT INTO run_commit (tenant_id, run_id, approval_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [run.tenantId, run.runId, run.approvalId])
    if (guard.rowCount === 0) {
      await client.query('ROLLBACK')
      return { status: 'already_committed' }
    }
    const t0 = performance.now()
    const totals = await postBatches(client, run)
    await client.query(`INSERT INTO outbox_event (tenant_id, topic, key, payload) VALUES ($1, 'run.committed', $2, $3)`,
      [run.tenantId, run.runId, JSON.stringify(Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toString()])))])
    const t1 = performance.now()
    await client.query('COMMIT') // deferred balance triggers run here
    return { status: 'committed', totals, postMs: t1 - t0, commitMs: performance.now() - t1 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined) // the original error is what the caller needs
    throw error
  } finally {
    client.release()
  }
}

async function postBatches(client: pg.PoolClient, run: RunToCommit): Promise<Totals> {
  const market = { tenantId: run.tenantId, marketId: run.marketId, currency: run.currency }
  const expenseId = await accountId(client, { ...market, type: 'commission_expense' })
  const withholdingId = await accountId(client, { ...market, type: 'withholding_payable' })
  let expected = ZERO
  let posted = ZERO
  for (const batch of run.batches) {
    for (const line of batch) {
      validate(line)
      expected = add(expected, { entries: 1n, postings: line.withholdingMinor > 0n && line.withholdingMinor < line.grossMinor ? 3n : 2n,
        expenseMinor: line.grossMinor, payableMinor: line.grossMinor - line.withholdingMinor, withholdingMinor: line.withholdingMinor })
    }
    const payees = batch.map((l) => l.payeeId)
    await client.query(`INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency)
      SELECT $1, $2, 'payee_payable', p, $3 FROM unnest($4::uuid[]) AS p ON CONFLICT DO NOTHING`,
      [run.tenantId, run.marketId, run.currency, payees])
    const r = await client.query<Record<'entries' | 'postings' | 'expense' | 'payable' | 'withholding', string>>(BATCH_SQL, [
      run.tenantId, run.marketId, run.runId, payees, batch.map((l) => l.grossMinor.toString()),
      batch.map((l) => l.withholdingMinor.toString()), run.approvalId, expenseId, withholdingId, run.currency])
    const row = r.rows[0]!
    posted = add(posted, { entries: BigInt(row.entries), postings: BigInt(row.postings), expenseMinor: BigInt(row.expense),
      payableMinor: BigInt(row.payable), withholdingMinor: BigInt(row.withholding) })
  }
  // Blocking control totals (SDD-09 §7): Σ lines = Σ postings by category; a duplicate payee shows as a missing entry.
  for (const k of Object.keys(ZERO) as (keyof Totals)[]) {
    if (expected[k] !== posted[k]) throw new ControlTotalError(`control total ${k}: expected ${expected[k]} posted ${posted[k]}`)
  }
  return posted
}
