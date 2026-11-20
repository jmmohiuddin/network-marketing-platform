// TEST FIXTURES ONLY: draft markets with a monthly Vienna calendar, a loaded migration batch with the PLAN B6 section 6 AT
// facts, and a plan version, written through the owner pool the way TEN, IMP, PAR and PLN would write them. Migrations,
// openings and parallel runs go through the API.
import { randomUUID } from 'node:crypto'
import { compilePlan, stringifyEngineJson } from '@nmp/engine'
import type { FastifyInstance } from 'fastify'
import { call, createSignedInUser, createTenant, ownerRows, type TestUser } from '../../../test/helpers/index.js'
import type { BaseRoleName } from '../../lib/permissions.js'

export interface MigWorld {
  readonly tenantId: string
  readonly consultant: TestUser
  /** Holds migration.manage and migration.signoff (SoD cases). */
  readonly dual: TestUser
  readonly finance: TestUser
  readonly admin: TestUser
  readonly executive: TestUser
}

export interface MarketFixture {
  readonly marketId: string
  readonly calendarId: string
  /** Periods M-3, M-2, M-1 (= the cutover C), M, M+1 of the market's zone. */
  readonly periods: { readonly m3: string; readonly m2: string; readonly c: string; readonly m: string; readonly next: string }
  readonly batchId: string
  readonly planVersionId: string | null
}

const one = async (sql: string, params: unknown[]): Promise<string> => (await ownerRows<{ id: string }>(sql, params))[0]!.id
const user = (tenantId: string, roles: BaseRoleName[]) => createSignedInUser({ tenantId, roles, stepUp: true })

/** A tenant with the migration personas, settings from 2020 (runs and simulations read them) and the active type FXDIST. */
export async function migWorld(): Promise<MigWorld> {
  const tenantId = (await createTenant()).id
  const [consultant, finance, admin, executive] = await Promise.all([
    user(tenantId, ['Implementation consultant']), user(tenantId, ['Finance approver']), user(tenantId, ['Tenant admin']), user(tenantId, ['Executive read-only']),
  ])
  const dual = await createSignedInUser({ tenantId, roles: ['Implementation consultant', 'Finance approver'], stepUp: true })
  await ownerRows(
    `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by) VALUES ($1, 1, '2020-01-01', '{}', 'FIXTURE', $2)`,
    [tenantId, admin.id])
  const typeId = randomUUID()
  const approval = await one(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
     VALUES ($1, 'participant_type', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [tenantId, typeId, consultant.id, finance.id])
  await ownerRows(
    `INSERT INTO participant_type (id, tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason,
       requested_by, decided_by, decided_at, approval_id)
     VALUES ($1, $2, 'FXDIST', 'Distributor', true, false, true, true, 'active', 'FIXTURE', $3, $4, now(), $5)`,
    [typeId, tenantId, consultant.id, finance.id, approval])
  return { tenantId, consultant, dual, finance, admin, executive }
}

/** 8 % first level, 5 % second level of the sponsor tree on pv; ladder main with R1 (PLAN B6 section 6: AT core). */
function compiledPlan(versionId: string, calendarId: string): unknown {
  const rule = (ruleKey: string, kind: string, params: unknown) =>
    ({ ruleKey, kind, params, reversalPolicy: kind.startsWith('pay.') ? 'order_line' as const : null, calendarId: null, ordinal: 0 })
  return JSON.parse(stringifyEngineJson(compilePlan([
    rule('pv', 'volume.personal', { unit: 'currency', source: { from: 'volume', name: 'pv' }, items: { excludeItemClasses: ['starter_kit'], categories: null }, orders: 'all' }),
    rule('main', 'ladder', { ranks: [{ key: 'R1', requires: [], maintenance: null }] }),
    rule('unilevel', 'pay.percent_by_level', { sourceKind: 'downline_volume', eligibleIf: null, tree: 'sponsor', measure: 'pv', levels: ['0.08', '0.05'], compression: 'none' }),
  ], [], { planVersionId: versionId, version: 1 }, [calendarId])))
}

/** FIXTURE (PLN): a plan covering the market with version 1 active from `effectiveFrom`. */
async function activePlan(w: MigWorld, marketId: string, calendarId: string, effectiveFrom: Date): Promise<string> {
  const planId = await one('INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id', [w.tenantId, `plan-${randomUUID().slice(0, 8)}`, w.consultant.id])
  await ownerRows('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [w.tenantId, planId, marketId])
  await ownerRows('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [w.tenantId, planId, calendarId])
  const versionId = randomUUID()
  const approval = await one(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
     VALUES ($1, 'plan_version', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [w.tenantId, versionId, w.consultant.id, w.finance.id])
  await ownerRows(
    `INSERT INTO plan_version (id, tenant_id, plan_id, version, state, effective_from, justification, engine_version, crediting_event,
       compiled, content_hash, submitted_by, submitted_at, approval_id, activation_approval_id, activated_at, created_by)
     VALUES ($1, $2, $3, 1, 'active', $4, 'FIXTURE', '0.1.0', 'paid', $5, digest($5::jsonb::text, 'sha256'), $6, now(), $7, $7, now(), $6)`,
    [versionId, w.tenantId, planId, effectiveFrom, compiledPlan(versionId, calendarId), w.consultant.id, approval])
  return versionId
}

export interface FixtureOptions {
  /** Plan version start: at the cutover C (default), at M-3, or no plan. */
  readonly plan?: 'cutover' | 'earlier' | null
  /** Participant type code of the batch facts (an unknown one makes apply refuse). */
  readonly typeCode?: string
  readonly batchState?: 'loaded' | 'mapped'
}

/**
 * FIXTURE (TEN, IMP): draft market `code` (EUR, Europe/Vienna), periods M-3..M+1, a loaded migration batch of months
 * M-3..M-1 with an approved migration mapping and the AT facts of PLAN B6 section 6, and a plan version.
 */
export async function migrationMarket(w: MigWorld, code: string, options: FixtureOptions = {}): Promise<MarketFixture> {
  const marketId = await one(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, $2, 'EUR', 2, 'Europe/Vienna', '{de}', 'none', 'draft') RETURNING id`, [w.tenantId, code])
  const calendarId = await one(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, $3 || ' monthly', 'monthly', 'Europe/Vienna', (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '3 months')::date)
     RETURNING id`, [w.tenantId, marketId, code])
  const periods = await ownerRows<{ id: string; starts_at: Date }>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
     SELECT $1, $2, d AT TIME ZONE 'Europe/Vienna', (d + interval '1 month') AT TIME ZONE 'Europe/Vienna'
     FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '3 months',
                          date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') + interval '1 month', interval '1 month') d
     RETURNING id, starts_at`, [w.tenantId, calendarId])
  const [m3, m2, c, m, next] = periods.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())
  const [months] = await ownerRows<{ m3: string; m2: string; m1: string }>(
    `SELECT to_char(x - interval '3 months', 'YYYY-MM-DD') AS m3, to_char(x - interval '2 months', 'YYYY-MM-DD') AS m2,
            to_char(x - interval '1 month', 'YYYY-MM-DD') AS m1 FROM date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') x`)
  const { m3: f3, m2: f2, m1: f1 } = months!
  const [mapping] = await ownerRows<{ id: string }>(
    `INSERT INTO import_mapping (tenant_id, version, kind, mappings, state, approved_by, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, 'migration', '{}', 'approved', $2, $3 FROM import_mapping WHERE tenant_id = $1 RETURNING id`,
    [w.tenantId, w.finance.id, w.consultant.id])
  const batchId = await one(
    `INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, mapping_id, row_counts, uploaded_by, created_by)
     VALUES ($1, $2, 'migration', $3, ($4::date + interval '1 month' - interval '1 day')::date, $5, $6,
             '{"participants": 3, "orders": 4, "payout_lines": 4}', $7, $7) RETURNING id`,
    [w.tenantId, marketId, f3, f1, 'mapped', mapping!.id, w.consultant.id])
  const type = options.typeCode ?? 'FXDIST'
  await ownerRows(
    `INSERT INTO cpl_fact_participant (tenant_id, source, batch_id, participant_ref, type_code, counts_as_end_customer, can_earn, enrolled_month, servicing_ref, market_id)
     VALUES ($1, 'import', $2, $3 || 'A', $4, false, true, $5, NULL, $6), ($1, 'import', $2, $3 || 'B', $4, false, true, $5, $3 || 'A', $6),
            ($1, 'import', $2, $3 || 'C', $4, false, true, $5, $3 || 'B', $6)`,
    [w.tenantId, batchId, `${code}-`, type, f3, marketId])
  await ownerRows(
    `INSERT INTO cpl_fact_order (tenant_id, source, batch_id, order_ref, order_date, buyer_ref, amount_minor, volume_minor, purpose, is_starter_kit, refunded_minor)
     VALUES ($1, 'import', $2, $3 || 'O0', $4::date + 9, $3 || 'A', 10000, 10000, 'personal', false, 0),
            ($1, 'import', $2, $3 || 'O1', $5::date + 4, $3 || 'A', 10000, 10000, 'personal', false, 0),
            ($1, 'import', $2, $3 || 'O2', $5::date + 5, $3 || 'B', 10000, 10000, 'personal', false, 0),
            ($1, 'import', $2, $3 || 'O3', $5::date + 6, $3 || 'C', 30000, 30000, 'personal', false, 0)`,
    [w.tenantId, batchId, `${code}-`, f2, f1])
  await ownerRows(
    `INSERT INTO cpl_fact_payout_line (tenant_id, source, batch_id, line_ref, pay_month, payee_ref, bonus_type, source_kind, source_order_ref, amount_minor)
     VALUES ($1, 'import', $2, 'L1', $4, $3 || 'A', 'unilevel', 'downline_volume', $3 || 'O2', 800),
            ($1, 'import', $2, 'L2', $4, $3 || 'A', 'unilevel', 'downline_volume', $3 || 'O3', 1500),
            ($1, 'import', $2, 'L3', $4, $3 || 'B', 'unilevel', 'downline_volume', $3 || 'O3', 2401),
            ($1, 'import', $2, 'L4', $4, $3 || 'C', 'retail', 'other', NULL, 500)`,
    [w.tenantId, batchId, `${code}-`, f1])
  if ((options.batchState ?? 'loaded') === 'loaded') await ownerRows("UPDATE import_batch SET state = 'loaded' WHERE id = $1", [batchId])
  const plan = options.plan === undefined ? 'cutover' : options.plan
  const planVersionId = plan === null ? null : await activePlan(w, marketId, calendarId, plan === 'cutover' ? c!.starts_at : m3!.starts_at)
  return { marketId, calendarId, periods: { m3: m3!.id, m2: m2!.id, c: c!.id, m: m!.id, next: next!.id }, batchId, planVersionId }
}

export const OPENING_BALANCES = (code: string) => `payee_id,amount_minor\n${code}-A,1250\n${code}-C,-300\n`
export const OPENING_STATE = (code: string) => `participant_id,item,value\n${code}-A,title.main,R1\n`

/** PUT of a CSV body to a migration route. */
export const putCsv = (app: FastifyInstance, as: TestUser, url: string, csv: string) =>
  call(app, { method: 'PUT', url, as, body: csv, headers: { 'content-type': 'text/csv' } })

/** Through the API: create (by `creator`), apply, stage the section 6 opening, submit (by `creator`), approve (finance). */
export async function postedMigration(app: FastifyInstance, w: MigWorld, code: string, market: MarketFixture, creator: TestUser = w.consultant): Promise<string> {
  const created = await call(app, { method: 'POST', url: '/v1/migrations', as: creator, idempotencyKey: true,
    body: { import_batch_id: market.batchId, cutover_period_id: market.periods.c, volume_key: 'pv' } })
  if (created.statusCode !== 201) throw new Error(`create: ${created.body}`)
  const id = created.json().data.id as string
  const steps = [
    await call(app, { method: 'POST', url: `/v1/migrations/${id}/apply`, as: creator, idempotencyKey: true }),
    await putCsv(app, creator, `/v1/migrations/${id}/opening-balances?control_total_minor=950`, OPENING_BALANCES(code)),
    await putCsv(app, creator, `/v1/migrations/${id}/opening-state`, OPENING_STATE(code)),
    await call(app, { method: 'POST', url: `/v1/migrations/${id}/opening/submit`, as: creator, idempotencyKey: true }),
    await call(app, { method: 'POST', url: `/v1/migrations/${id}/opening/decision`, as: w.finance, idempotencyKey: true, body: { decision: 'approve', reason: 'Matches the legacy balances' } }),
  ]
  const failed = steps.find((step) => step.statusCode !== 200)
  if (failed !== undefined) throw new Error(`opening: ${failed.body}`)
  return id
}
