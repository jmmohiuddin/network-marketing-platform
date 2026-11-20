// §S-2 (PLAN B3): one run end to end at 100k positions on the B3 schema — request, tx A (snapshot load + store), engine,
// tx B (lines + state + flip) — with the TS-10 plan (rank bonus on group volume, matching), one order per position,
// a binary sponsor tree. Test databases only; fixtures are bulk-written by the owner with triggers off (replica role).
// Run like write-path.ts with the position count as argument, then reset the database.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { closePool, type Tx } from '@nmp/db'
import { closeOwnerPool, createTenant, createUser, getOwnerPool, resetTestDb } from '@nmp/db/testing'
import { stringifyEngineJson } from '@nmp/engine'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../src/lib/db.js'
import { finishRun, prepareRun, requestRun, startedRun } from '../../src/modules/comp/runs.js'

const positions = Number(process.argv[2] ?? 100_000)
const owner = getOwnerPool()
const SYSTEM = SYSTEM_ACTOR_ID

const PLAN = {
  version: 1, contentHash: '', effectiveFromUs: '0',
  measures: [
    { kind: 'volume.personal', key: 'pv', unit: 'currency', source: { from: 'amount' }, items: { excludeItemClasses: [], categories: null }, orders: 'all' },
    { kind: 'volume.group', key: 'gv', of: 'pv', tree: 'sponsor', includeSelf: true },
  ],
  ladders: [{ key: 'main', ranks: [
    { key: 'R1', requires: [{ kind: 'measure', measure: 'pv', atLeastMinor: '1', window: { type: 'period' }, maxPerLegShare: null }], maintenance: null },
  ] }],
  bonuses: [
    { key: 'rank_bonus', kind: 'pay.percent_of_measure', sourceKind: 'downline_volume', reversalPolicy: 'order_line', eligibleIf: null, measure: 'gv',
      byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.05' }] } },
    { key: 'match', kind: 'pay.matching', sourceKind: 'match', reversalPolicy: 'restatement', eligibleIf: null, tree: 'sponsor', of: ['rank_bonus'], rates: ['0.20'] },
  ],
  constraints: [], caps: [], carries: [], counters: [], transitions: [], pointsToCurrency: [], customerRollUp: null,
}

async function setup() {
  const tenant = await createTenant()
  const user = await createUser({ tenantId: tenant.id })
  const approver = await createUser({ tenantId: tenant.id })
  const third = await createUser({ tenantId: tenant.id })
  const one = async (sql: string, params: unknown[]) => (await owner.query<{ id: string }>(sql, params)).rows[0]!.id
  const market = await one(`INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
    VALUES ($1, 'DE', 'EUR', 2, 'Europe/Berlin', '{de}', 'none', 'live') RETURNING id`, [tenant.id])
  const calendar = await one(`INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
    VALUES ($1, $2, 'bench', 'monthly', 'Europe/Berlin', '2026-01-01') RETURNING id`, [tenant.id, market])
  const period = await one(`INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
    VALUES ($1, $2, '2026-01-01T00:00:00+01', '2026-02-01T00:00:00+01') RETURNING id`, [tenant.id, calendar])
  await owner.query(`INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
    VALUES ($1, 1, '2020-01-01', '{}', 'bench', $2)`, [tenant.id, user.id])
  const typeId = randomUUID()
  const typeApproval = await one(`INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
    VALUES ($1, 'participant_type', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [tenant.id, typeId, user.id, approver.id])
  await owner.query(`INSERT INTO participant_type (id, tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions,
    state, reason, requested_by, decided_by, decided_at, approval_id) VALUES ($1, $2, 'BENCH', 'Bench', true, false, true, true, 'active', 'bench', $3, $4, now(), $5)`,
  [typeId, tenant.id, user.id, approver.id, typeApproval])
  const client = await owner.connect()
  try {
    await client.query('SET session_replication_role = replica')
    const bulk = (sql: string) => client.query(sql, [tenant.id, market, typeId, SYSTEM, positions])
    await bulk(`INSERT INTO participant (id, tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
      SELECT md5('pa' || g)::uuid, $1, 'E' || g, 'individual', $2, '2025-01-01', $4, 'system' FROM generate_series(1, $5) g
      WHERE $3::uuid IS NOT NULL`)
    await bulk(`INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by, created_by_type)
      SELECT $1, md5('pa' || g)::uuid, $3, '2025-01-01', $4, 'system' FROM generate_series(1, $5) g WHERE $2::uuid IS NOT NULL`)
    await bulk(`INSERT INTO position (id, tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
      SELECT md5('po' || g)::uuid, $1, 'E' || g, $2, 'active', '2025-01-01', $4, 'system' FROM generate_series(1, $5) g WHERE $3::uuid IS NOT NULL`)
    await bulk(`INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
      SELECT $1, md5('po' || g)::uuid, md5('pa' || g)::uuid, '2025-01-01', $4, 'system' FROM generate_series(1, $5) g
      WHERE $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`)
    await bulk(`INSERT INTO relationship (tenant_id, kind, parent_position_id, child_position_id, valid_from, event_type, created_by, created_by_type)
      SELECT $1, 'sponsor', md5('po' || (g / 2))::uuid, md5('po' || g)::uuid, '2025-01-01', 'enrolment', $4, 'system' FROM generate_series(2, $5) g
      WHERE $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`)
    await bulk(`INSERT INTO inbound_event (id, tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
      SELECT md5('ie' || g)::uuid, $1, 'api:bench', 'order:' || g, sha256(convert_to('o' || g, 'UTF8')), now(), 'processed', $4, 'system'
      FROM generate_series(1, $5) g WHERE $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`)
    await bulk(`INSERT INTO sales_order (id, tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
        attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash,
        inbound_event_id, created_by, created_by_type)
      SELECT md5('so' || g)::uuid, $1, 'bench', 'o' || g, $2, md5('pa' || g)::uuid, $3, 'personal', false, md5('po' || g)::uuid, 'buyer', false,
        '2026-01-10', '2026-01-10', 10000 + g % 1000, 0, 'EUR', sha256(convert_to('o' || g, 'UTF8')), md5('ie' || g)::uuid, $4, 'system'
      FROM generate_series(1, $5) g`)
    await bulk(`INSERT INTO order_line (tenant_id, order_id, line_no, sku, item_class, quantity, amount_minor, volumes, created_by, created_by_type)
      SELECT $1, md5('so' || g)::uuid, 1, 'FX-1', 'product', 1, 10000 + g % 1000, jsonb_build_object('pv', (10000 + g % 1000)::text), $4, 'system'
      FROM generate_series(1, $5) g WHERE $2::uuid IS NOT NULL AND $3::uuid IS NOT NULL`)
  } finally {
    await client.query('RESET session_replication_role')
    client.release()
  }
  await owner.query('ANALYZE')
  const planId = await one(`INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, 'bench', $2) RETURNING id`, [tenant.id, user.id])
  await owner.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [tenant.id, planId, market])
  await owner.query('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [tenant.id, planId, calendar])
  const versionId = randomUUID()
  const compiled = JSON.parse(stringifyEngineJson({ [calendar]: { ...PLAN, planVersionId: versionId, calendars: [calendar] } })) as unknown
  const approval = (by: string) => one(`INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
    VALUES ($1, 'plan_version', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [tenant.id, versionId, user.id, by])
  await owner.query(`INSERT INTO plan_version (id, tenant_id, plan_id, version, state, effective_from, justification, engine_version, crediting_event,
      compiled, content_hash, submitted_by, submitted_at, approval_id, activation_approval_id, activated_at, created_by)
    VALUES ($1, $2, $3, 1, 'active', '2026-01-01T00:00:00+01', 'bench', '0.2.0', 'paid', $4, digest($4::jsonb::text, 'sha256'), $5, now(), $6, $7, now(), $5)`,
  [versionId, tenant.id, planId, compiled, user.id, await approval(approver.id), await approval(third.id)])
  return { tenantId: tenant.id, userId: user.id, period }
}

await resetTestDb()
const world = await setup()
const asSystem = <T>(fn: (tx: Tx) => Promise<T>) =>
  runInTenant({ tenantId: world.tenantId, userId: SYSTEM }, { actorType: 'system', requestId: null, supportSessionId: null }, fn)
const marks: Record<string, number> = {}
let at = performance.now()
const lap = (name: string) => {
  const now = performance.now()
  marks[`${name}_ms`] = Math.round(now - at)
  at = now
}
const requested = await runInTenant({ tenantId: world.tenantId, userId: world.userId }, { actorType: 'user', requestId: null, supportSessionId: null },
  (tx) => requestRun(tx, world.period, 'bench', null))
lap('request')
const input = (await asSystem((tx) => prepareRun(tx, requested.run_id)))!
lap('snapshot_load_store')
const stream = startedRun(input) // the engine through the final lines (D-B6-12 streaming adoption)
lap('engine')
await asSystem((tx) => finishRun(tx, requested.run_id, stream))
lap('write_flip')
const { rows: written } = await owner.query<{ lines: number }>('SELECT count(*)::int AS lines FROM result_line WHERE run_id = $1', [requested.run_id])
const result = {
  measured_at: new Date().toISOString(), positions, orders: positions, lines: written[0]!.lines, ...marks,
  total_ms: Object.values(marks).reduce((a, b) => a + b, 0), rss_mb: Math.round(process.memoryUsage().rss / 1e6),
  peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
}
const file = new URL('./end-to-end.results.json', import.meta.url)
const recorded = JSON.parse(readFileSync(file, 'utf8')) as { runs: unknown[] }
writeFileSync(file, `${JSON.stringify({ ...recorded, runs: [...recorded.runs, result] }, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(result)}\n`)
await closePool()
await closeOwnerPool()
