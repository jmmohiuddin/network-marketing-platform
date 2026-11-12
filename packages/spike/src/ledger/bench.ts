// Ledger spike benchmark. Run through scripts/heavy.sh, e.g.
//   scripts/heavy.sh node --max-old-space-size=1024 --import tsx packages/spike/src/ledger/bench.ts --lines 100000
// Prints one JSON object; every number in it is measured on this machine.
import { execFile } from 'node:child_process'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'
import { balanceFromPostings, balanceFromProjection, reconcile } from './balances.js'
import { ledgerPool, resetSchema } from './db.js'
import { accountId } from './poster.js'
import { commitRun } from './run-commit.js'
import { prng, syntheticBatches, syntheticId } from './synthetic.js'

const { values: arg } = parseArgs({ options: {
  lines: { type: 'string', default: '10000' }, batch: { type: 'string', default: '5000' }, seed: { type: 'string', default: '42' },
  samples: { type: 'string', default: '2000' }, keep: { type: 'boolean', default: false },
} })
const LINES = Number(arg.lines)
const BATCH = Number(arg.batch)
const SEED = Number(arg.seed)
const SAMPLES = Math.min(Number(arg.samples), LINES)
const SCHEMA = 'spike_ledger_bench'
const FIXTURE_WITHHOLDING_BP = 200n // labelled benchmark fixture, not a product value
const MAX_GROSS_MINOR = 500_000
const SAMPLE_EVERY_MS = 200
const MB = 1024 * 1024
const market = { tenantId: syntheticId(9, 1), marketId: syntheticId(9, 2), currency: 'INR' }
const sh = promisify(execFile)

const pool = ledgerPool(SCHEMA, 4)
const monitor = ledgerPool(SCHEMA, 1)

/** Peak RSS of this process and of the spike's Postgres backends, sampled while fn runs. */
async function withPeaks<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number; nodePeakMb: number; pgPeakMb: number }> {
  let nodePeak = process.memoryUsage().rss
  let pgPeak = 0
  let busy = false
  const timer = setInterval(() => {
    nodePeak = Math.max(nodePeak, process.memoryUsage().rss)
    if (busy) return
    busy = true
    monitor.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity WHERE application_name = 'spike-ledger' AND pid <> pg_backend_pid()`)
      .then(async (r) => {
        if (r.rows.length === 0) return
        const out = await sh('ps', ['-o', 'rss=', '-p', r.rows.map((x) => x.pid).join(',')])
        for (const kb of out.stdout.trim().split(/\s+/)) pgPeak = Math.max(pgPeak, Number(kb) * 1024)
      })
      .catch(() => undefined) // a backend can exit between the two calls; one missed sample is acceptable
      .finally(() => { busy = false })
  }, SAMPLE_EVERY_MS)
  const t0 = performance.now()
  try {
    const result = await fn()
    return { result, ms: performance.now() - t0, nodePeakMb: nodePeak / MB, pgPeakMb: pgPeak / MB }
  } finally {
    clearInterval(timer)
  }
}

async function latencies(n: number, fn: (i: number) => Promise<unknown>): Promise<{ n: number; p50: number; p95: number; p99: number; max: number }> {
  const ms: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await fn(i)
    ms.push(performance.now() - t0)
  }
  ms.sort((a, b) => a - b)
  const at = (q: number): number => Number(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]!.toFixed(3))
  return { n, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) }
}

const round = (x: number): number => Number(x.toFixed(1))

async function main(): Promise<void> {
  await resetSchema(pool, SCHEMA)
  const synthetic = { payees: LINES, batchSize: BATCH, seed: SEED, withholdingBasisPoints: FIXTURE_WITHHOLDING_BP, maxGrossMinor: MAX_GROSS_MINOR }

  // 1. Throughput: one run of LINES payee results, one entry per payee, one transaction.
  const run = await withPeaks(() => commitRun(pool, { ...market, runId: syntheticId(2, 1), approvalId: syntheticId(9, 3), batches: syntheticBatches(synthetic) }))
  if (run.result.status !== 'committed') throw new Error('bench run was not committed')
  const { totals, postMs, commitMs } = run.result

  // 2. Concurrent double commit of a second run (10k lines or LINES if smaller): must post once.
  const dupLines = Math.min(LINES, 10_000)
  const dupRun = { ...market, runId: syntheticId(2, 2), approvalId: syntheticId(9, 3) }
  const dupSynthetic = { ...synthetic, payees: dupLines, seed: SEED + 1 }
  const dup = await withPeaks(() => Promise.all([commitRun(pool, { ...dupRun, batches: syntheticBatches(dupSynthetic) }),
    commitRun(pool, { ...dupRun, batches: syntheticBatches(dupSynthetic) })]))
  const dupEntries = Number((await pool.query(`SELECT count(*) AS n FROM journal_entry WHERE origin_id = $1`, [dupRun.runId])).rows[0].n)

  // 3. Balance query latency: seeded sample of payee payable accounts, plus the hot market expense account.
  const rnd = prng(SEED + 2)
  const sample: string[] = []
  for (let i = 0; i < SAMPLES; i++) sample.push(await accountId(pool, { ...market, type: 'payee_payable', payeeId: syntheticId(1, Math.floor(rnd() * LINES)) }))
  const expense = await accountId(pool, { ...market, type: 'commission_expense' })
  const payeeDerivedFresh = await latencies(SAMPLES, (i) => balanceFromPostings(pool, sample[i]!))
  const payeeProjection = await latencies(SAMPLES, (i) => balanceFromProjection(pool, sample[i]!))
  const hotDerivedFresh = await latencies(5, () => balanceFromPostings(pool, expense))
  const vacuum = await withPeaks(() => pool.query('VACUUM (ANALYZE) posting'))
  const payeeDerivedVacuumed = await latencies(SAMPLES, (i) => balanceFromPostings(pool, sample[i]!))
  const hotDerivedVacuumed = await latencies(5, () => balanceFromPostings(pool, expense))
  const hotProjection = await latencies(100, () => balanceFromProjection(pool, expense))

  // 4. Reconciliation: Σ postings per account vs projection, every entry balanced.
  const rec = await withPeaks(() => reconcile(pool))

  const size = await pool.query<{ rel: string; mb: string }>(`SELECT rel, round(sum(pg_total_relation_size(relid)) / 1048576.0, 1) AS mb FROM (
      SELECT 'posting' AS rel, relid FROM pg_partition_tree('posting')
      UNION ALL SELECT r, r::regclass FROM unnest(ARRAY['journal_entry', 'account_balance', 'ledger_account']) AS r) t GROUP BY rel`)

  const report = {
    lines: LINES, batchSize: BATCH, seed: SEED,
    commit: {
      entries: Number(totals.entries), postings: Number(totals.postings), totalMs: round(run.ms), postMs: round(postMs), commitMs: round(commitMs),
      linesPerSec: Math.round(LINES / (run.ms / 1000)), postingsPerSec: Math.round(Number(totals.postings) / (run.ms / 1000)),
      nodePeakRssMb: round(run.nodePeakMb), pgBackendPeakRssMb: round(run.pgPeakMb),
      expenseEqualsPayablePlusWithholding: totals.expenseMinor === totals.payableMinor + totals.withholdingMinor,
    },
    doubleCommit: { lines: dupLines, outcomes: dup.result.map((o) => o.status).sort(), entriesPosted: dupEntries, ms: round(dup.ms) },
    balanceLatencyMs: { payeeDerivedFresh, payeeDerivedVacuumed, payeeProjection, hotExpenseDerivedFresh: hotDerivedFresh,
      hotExpenseDerivedVacuumed: hotDerivedVacuumed, hotExpenseProjection: hotProjection, vacuumAnalyzeMs: round(vacuum.ms) },
    reconciliation: { ms: round(rec.ms), accounts: Number(rec.result.accounts), mismatchedAccounts: Number(rec.result.mismatchedAccounts),
      unbalancedEntries: Number(rec.result.unbalancedEntries), emptyEntries: Number(rec.result.emptyEntries),
      debitEqualsCredit: rec.result.totalDebitMinor === rec.result.totalCreditMinor, pgBackendPeakRssMb: round(rec.pgPeakMb) },
    sizeMb: Object.fromEntries(size.rows.map((r) => [r.rel, Number(r.mb)])),
    nodeFinalRssMb: round(process.memoryUsage().rss / MB),
  }
  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`)
  if (!arg.keep) await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`) // free disk: the laptop has little to spare
}

main()
  .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1 })
  .finally(() => Promise.all([pool.end(), monitor.end()]))
