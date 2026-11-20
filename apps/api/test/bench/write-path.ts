// §S-2 (PLAN B3): write path of a run on the B3 schema — result_line (~1 KB compact traces) + qualification_state, then
// the running -> calculated flip with its Σ check, in ONE transaction as nmp_app (triggers active). Test databases only.
// Run: NMP_TEST_DB=nmp_test_<n> scripts/heavy.sh sh -c 'DATABASE_URL=postgres://nmp_app:nmp_app_local@127.0.0.1:5432/$NMP_TEST_DB \
//   MIGRATE_DATABASE_URL=postgres://127.0.0.1:5432/$NMP_TEST_DB node --max-old-space-size=4096 --import tsx \
//   apps/api/test/bench/write-path.ts 100000 600000'
// then reset the database (result_line rows cannot be deleted).
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { closePool, withTenant, type Tx } from '@nmp/db'
import { closeOwnerPool, createTenant, createUser, getOwnerPool, resetTestDb } from '@nmp/db/testing'
import type { ResultLine, Trace } from '@nmp/engine'
import { insertLines, insertState, RUN_LINES } from '../../src/modules/comp/results.js'

const POSITIONS = 100_000
const CHUNK = 50_000

function trace(position: string, n: number): Trace {
  const source = (k: number) => ({
    positionId: randomUUID(), level: k, measure: 'pv', ruleKey: null, base: 1_234_567n, baseScale: 'minor' as const, rate: '0.05',
    share: null, capMinor: null, raw: 61_728_350_000_000n + BigInt(n), compressedOver: [],
    orders: [{ orderId: randomUUID(), raw: 61_728_350_000_000n }],
  })
  return {
    rule: 'unilevel', kind: 'pay.percent_by_level', pass: 4, planVersionId: randomUUID(), engineVersion: '0.1.0', payeePositionId: position,
    rankEvaluated: [{ ladder: 'main', rank: 'R1' }], tree: { kind: 'sponsor', knownAtUs: 1_794_938_417_365_020n },
    sources: [source(1), source(2), source(3)], omitted: { count: 0, raw: 0n }, raw: 185_185_050_000_000n,
    steps: [{ step: 'rounding', mode: 'half_up', raw: 185_185_050_000_000n, minor: 185n }],
  }
}

async function setup(lines: number) {
  const owner = getOwnerPool()
  const tenant = await createTenant()
  const user = await createUser({ tenantId: tenant.id })
  const one = async (sql: string, params: unknown[]) => (await owner.query<{ id: string }>(sql, params)).rows[0]!.id
  const market = await one(`INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
    VALUES ($1, 'DE', 'EUR', 2, 'Europe/Berlin', '{de}', 'none', 'live') RETURNING id`, [tenant.id])
  const calendar = await one(`INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
    VALUES ($1, $2, 'bench', 'monthly', 'Europe/Berlin', '2026-01-01') RETURNING id`, [tenant.id, market])
  const period = await one(`INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
    VALUES ($1, $2, '2026-01-01T00:00:00+01', '2026-02-01T00:00:00+01') RETURNING id`, [tenant.id, calendar])
  const plan = await one(`INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, 'bench', $2) RETURNING id`, [tenant.id, user.id])
  const version = await one(`INSERT INTO plan_version (tenant_id, plan_id, version, engine_version, created_by)
    VALUES ($1, $2, 1, '0.1.0', $3) RETURNING id`, [tenant.id, plan, user.id])
  const settings = await one(`INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
    VALUES ($1, 1, '2025-01-01', '{}', 'bench', $2) RETURNING id`, [tenant.id, user.id])
  await owner.query(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
     SELECT $1, 'B' || g, 'individual', $2, '2025-01-01', $3, 'system' FROM generate_series(1, $4) g`,
    [tenant.id, market, '00000000-0000-0000-0000-000000000000', POSITIONS])
  await owner.query(
    `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
     SELECT $1, 'B' || g, $2, 'active', '2025-01-01', $3, 'system' FROM generate_series(1, $4) g`,
    [tenant.id, market, '00000000-0000-0000-0000-000000000000', POSITIONS])
  await owner.query('ANALYZE participant, position')
  const { rows: pairs } = await owner.query<{ position_id: string; participant_id: string }>(
    `SELECT p.id AS position_id, pa.id AS participant_id FROM position p JOIN participant pa ON pa.tenant_id = p.tenant_id AND pa.external_ref = p.position_ref
     WHERE p.tenant_id = $1 ORDER BY p.id`, [tenant.id])
  const ctx = { tenantId: tenant.id, userId: user.id }
  const run = await withTenant(ctx, async (tx) => {
    const id = (await tx.query<{ id: string }>(`INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id,
      settings_version_id, engine_version, prepared_by) VALUES (app_tenant_id(), $1, $2, $3, $4, '0.1.0', app_user_id()) RETURNING id`,
    [period, `bench-${lines}`, version, settings])).rows[0]!.id
    const snapshot = (await tx.query<{ id: string }>(`INSERT INTO run_snapshot (tenant_id, period_id, known_at, content, content_sha256,
      row_counts, order_ids, order_event_ids) VALUES (app_tenant_id(), $1, now(), '\\x00', digest('\\x00'::bytea, 'sha256'), '{}', '{}', '{}')
      RETURNING id`, [period])).rows[0]!.id
    await tx.query(`UPDATE run SET state = 'running', snapshot_id = $2, started_at = now() WHERE id = $1`, [id, snapshot])
    return id
  })
  return { ctx, run, pairs, market }
}

async function measure(lines: number) {
  const { ctx, run, pairs, market } = await setup(lines)
  const started = performance.now()
  let gross = 0n
  const marks: Record<string, number> = {}
  await withTenant(ctx, async (tx: Tx) => {
    for (let from = 0; from < lines; from += CHUNK) {
      const chunk: ResultLine[] = []
      for (let n = from; n < Math.min(lines, from + CHUNK); n++) {
        const pair = pairs[n % POSITIONS]!
        const amount = 185n + BigInt(n % 7)
        gross += amount
        chunk.push({
          payeePositionId: pair.position_id, payeeParticipantId: pair.participant_id, ruleKey: `rule_${Math.floor(n / POSITIONS)}`,
          kind: 'pay.percent_by_level', sourceKind: 'downline_volume', pass: 4, amountMinor: amount, currency: 'EUR',
          reversalPolicy: 'order_line', origin: null, trace: trace(pair.position_id, n),
        })
      }
      await insertLines(tx, RUN_LINES, run, chunk)
    }
    marks.lines_ms = performance.now() - started
    const qualification = pairs.map((p) => ({
      positionId: p.position_id, paidAs: [{ ladder: 'main', rank: 'R1' }], titles: [{ ladder: 'main', rank: 'R1' }], graceUsed: [],
      counters: [], carry: [], oneTimeFlags: [], banked: [],
    }))
    const volumeSummaries = pairs.map((p) => ({ positionId: p.position_id, measures: [{ measure: 'pv', valueMinor: 10_000n }], paidAs: [] }))
    await insertState(tx, run, qualification, new Map(volumeSummaries.map((v) => [v.positionId, v.measures])), market)
    marks.state_ms = performance.now() - started - marks.lines_ms
    const flip = performance.now()
    await tx.query(`UPDATE run SET state = 'calculated', totals = $2, inputs_hash = 'bench', lines_hash = 'bench', outputs = '{}',
      finished_at = now() WHERE id = $1`, [run, { gross_minor: gross.toString() }])
    marks.flip_ms = performance.now() - flip
  })
  const { rows } = await getOwnerPool().query<{ bytes: string }>(`SELECT pg_total_relation_size('result_line')::text AS bytes`)
  return { lines, positions: POSITIONS, ...marks, total_ms: performance.now() - started, result_line_bytes_after: Number(rows[0]!.bytes),
    rss_mb: Math.round(process.memoryUsage().rss / 1e6) }
}

const sizes = process.argv.slice(2).map(Number)
await resetTestDb()
const results = []
for (const size of sizes) results.push(await measure(size))
writeFileSync(new URL('./write-path.results.json', import.meta.url), `${JSON.stringify({ measured_at: new Date().toISOString(), results }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(results)}\n`)
await closePool()
await closeOwnerPool()
