// TEST FIXTURES ONLY: a German market with a monthly Berlin calendar, participants, orders and an active plan version,
// written through the owner pool the way PAR, GEN, ORD and PLN would write them. Runs and commits go through the API.
import { randomUUID } from 'node:crypto'
import { getOwnerPool } from '@nmp/db/testing'
import { stringifyEngineJson, type PlanVersion } from '@nmp/engine'
import type { FastifyInstance } from 'fastify'
import { expect } from 'vitest'
import {
  call, createSignedInUser, createTenant, ownerRows, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import type { BaseRoleName } from '../../lib/permissions.js'
import { calculateRunJob } from './runs.js'

export const SYSTEM = '00000000-0000-0000-0000-000000000000'

export type Period = {
  readonly id: string
  readonly starts_at: Date
  readonly ends_at: Date
}

export interface World {
  readonly tenantId: string
  readonly marketId: string
  readonly calendarId: string
  /** Oldest first; the last periods are in the future (open, before cut-off). */
  readonly periods: readonly Period[]
  readonly distributorType: string
  readonly retailType: string
  readonly settingsVersionId: string
  readonly analyst: TestUser
  readonly finance: TestUser
  readonly finance2: TestUser
  readonly compliance: TestUser
}

const one = async (sql: string, params: unknown[]): Promise<string> => (await ownerRows<{ id: string }>(sql, params))[0]!.id

export function user(tenantId: string, roles: BaseRoleName[], marketIds: string[] | null = null): Promise<TestUser> {
  return createSignedInUser({ tenantId, roles, stepUp: true, marketIds })
}

export async function approval(tenantId: string, objectType: string, objectId: string, preparer: string, approver: string): Promise<string> {
  return one(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
     VALUES ($1, $2, $3, $4, $5, 'approved', now(), $5) RETURNING id`,
    [tenantId, objectType, objectId, preparer, approver],
  )
}

async function participantType(tenantId: string, code: string, customer: boolean, a: TestUser, b: TestUser): Promise<string> {
  const id = randomUUID()
  const approvalId = await approval(tenantId, 'participant_type', id, a.id, b.id)
  return one(
    `INSERT INTO participant_type (id, tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason,
       requested_by, decided_by, decided_at, approval_id)
     VALUES ($1, $2, $3, $3, $4, $5, $4, true, 'active', 'fixture', $6, $7, now(), $8) RETURNING id`,
    [id, tenantId, code, !customer, customer, a.id, b.id, approvalId],
  )
}

// Money keys need an approved change request per version (the money guard checks at commit), one key per version.
const MONEY_KEYS: ReadonlySet<string> = new Set([
  'money.rounding_mode', 'adjustments.policy', 'write_offs.policy', 'payouts.market_policy', 'payouts.bank_detail_cooling_off_hours',
])

/**
 * Settings versions from 2020-01-01: the plain settings plus each money key in its own following version (2020-01-02,
 * ...) with its approved change request, all in one owner transaction. Returns the last version's id.
 */
async function settingsVersion(tenantId: string, settings: Record<string, unknown>, requester: TestUser, approver: TestUser): Promise<string> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    const money = Object.keys(settings).filter((key) => MONEY_KEYS.has(key))
    let values = Object.fromEntries(Object.entries(settings).filter(([key]) => !MONEY_KEYS.has(key)))
    let versionId = ''
    for (const [index, key] of [null, ...money].entries()) {
      const effectiveFrom = `2020-01-0${index + 1}`
      const requestId = randomUUID()
      if (key !== null) values = { ...values, [key]: settings[key] }
      const approvalId = key === null ? null : (await client.query<{ id: string }>(
        `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
         VALUES ($1, 'setting_change_request', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [tenantId, requestId, requester.id, approver.id])).rows[0]!.id
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
         VALUES ($1, $2, $3, $4, 'fixture', $5, $6) RETURNING id`, [tenantId, index + 1, effectiveFrom, values, requester.id, approvalId])
      versionId = rows[0]!.id
      if (key !== null) {
        await client.query(
          `INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, requested_at,
             decided_by, decided_at, approval_id, version_id)
           VALUES ($1, $2, $3, $4::jsonb, $5, 'fixture', $6, 'approved', $7, now(), $8, now(), $9, $10)`,
          [requestId, tenantId, key, JSON.stringify(settings[key]), effectiveFrom, index, requester.id, approver.id, approvalId, versionId])
      }
    }
    await client.query('COMMIT')
    return versionId
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * A tenant (new, or `tenantId` without settings versions yet) with market DE (or `market`), calendar "<code> monthly"
 * (Europe/Berlin) with `past` ended periods and two future ones, settings versions from 2020 with `settings`,
 * participant types and the run personas (all markets, step-up fresh).
 */
export async function createWorld(
  options: { past?: number; settings?: Record<string, unknown>; tenantId?: string; market?: { code: string; pack: string } } = {},
): Promise<World> {
  const past = options.past ?? 4
  const tenantId = options.tenantId ?? (await createTenant()).id
  const market = options.market ?? { code: 'DE', pack: 'none' }
  const [analyst, finance, finance2, compliance] = await Promise.all([
    user(tenantId, ['Commission analyst']), user(tenantId, ['Finance approver']), user(tenantId, ['Finance approver']),
    user(tenantId, ['Compliance officer']),
  ])
  const marketId = await one(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, $2, 'EUR', 2, 'Europe/Berlin', '{de}', $3, 'live') RETURNING id`, [tenantId, market.code, market.pack])
  const calendarId = await one(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, $4 || ' monthly', 'monthly', 'Europe/Berlin', (date_trunc('month', now() AT TIME ZONE 'Europe/Berlin') - make_interval(months => $3))::date)
     RETURNING id`, [tenantId, marketId, past, market.code])
  const periods = await ownerRows<Period>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
     SELECT $1, $2, d AT TIME ZONE 'Europe/Berlin', (d + interval '1 month') AT TIME ZONE 'Europe/Berlin'
     FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Berlin') - make_interval(months => $3),
                          date_trunc('month', now() AT TIME ZONE 'Europe/Berlin') + interval '1 month', interval '1 month') d
     RETURNING id, starts_at, ends_at`, [tenantId, calendarId, past])
  const settingsVersionId = await settingsVersion(tenantId, options.settings ?? {}, analyst, finance)
  return {
    tenantId, marketId, calendarId, periods: periods.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime()),
    distributorType: await participantType(tenantId, 'FXDIST', false, analyst, finance),
    retailType: await participantType(tenantId, 'FXRETAIL', true, analyst, finance),
    settingsVersionId, analyst, finance, finance2, compliance,
  }
}

export interface Member {
  readonly participantId: string
  readonly positionId: string
}

/**
 * A distributor (or customer) with a position in `marketId` (default the world's market), sponsored by `sponsor` from
 * `since` (default: long before the periods).
 */
export async function member(
  w: World, ref: string, sponsor: Member | null = null, options: { retail?: boolean; since?: string; marketId?: string } = {},
): Promise<Member> {
  const since = options.since ?? '2020-01-01T00:00:00Z'
  const marketId = options.marketId ?? w.marketId
  const participantId = await one(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type)
     VALUES ($1, $2, 'individual', $3, $2, $4, $5, 'system') RETURNING id`, [w.tenantId, ref, marketId, since, SYSTEM])
  await ownerRows(
    `INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by, created_by_type)
     VALUES ($1, $2, $3, $4, $5, 'system')`, [w.tenantId, participantId, options.retail === true ? w.retailType : w.distributorType, since, SYSTEM])
  const positionId = await one(
    `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
     VALUES ($1, $2, $3, 'active', $4, $5, 'system') RETURNING id`, [w.tenantId, ref, marketId, since, SYSTEM])
  await ownerRows(
    `INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
     VALUES ($1, $2, $3, $4, $5, 'system')`, [w.tenantId, positionId, participantId, since, SYSTEM])
  if (sponsor !== null) await relate(w, sponsor, { participantId, positionId }, since, 'enrolment')
  return { participantId, positionId }
}

export async function relate(w: World, parent: Member, child: Member, validFrom: string, eventType = 'enrolment', caseId: string | null = null): Promise<void> {
  await ownerRows(
    `INSERT INTO relationship (tenant_id, kind, parent_position_id, child_position_id, valid_from, event_type, case_id, created_by, created_by_type)
     VALUES ($1, 'sponsor', $2, $3, $4, $5, $6, $7, 'system')`,
    [w.tenantId, parent.positionId, child.positionId, validFrom, eventType, caseId, SYSTEM],
  )
}

/**
 * An order of `buyer` credited to `credit` at `at`: one line of `quantity` units (default 1) totalling `amountMinor`, with
 * pv = amount as ORD stores it, the line total (source api:fixture).
 */
export async function order(
  w: World, buyer: Member, at: Date | string, amountMinor: number, options: { credit?: Member; retail?: boolean; quantity?: number } = {},
): Promise<string> {
  const key = randomUUID()
  const inbound = await one(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
     VALUES ($1, 'api:fixture', $2, sha256(convert_to($2, 'UTF8')), now(), 'processed', $3, 'system') RETURNING id`, [w.tenantId, `order:${key}`, SYSTEM])
  const orderId = await one(
    `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
       attributed_position_id, attribution_source, attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency,
       payload_hash, inbound_event_id, created_by, created_by_type)
     VALUES ($1, 'fixture', $2, $3, $4, $5, $6, false, $7, 'buyer', false, $8, $8, $9, 0, 'EUR', sha256(convert_to($2, 'UTF8')), $10, $11, 'system')
     RETURNING id`,
    [w.tenantId, key, w.marketId, buyer.participantId, options.retail === true ? w.retailType : w.distributorType,
      options.retail === true ? 'customer' : 'personal', (options.credit ?? buyer).positionId, at, amountMinor, inbound, SYSTEM],
  )
  await ownerRows(
    `INSERT INTO order_line (tenant_id, order_id, line_no, sku, item_class, quantity, amount_minor, volumes, created_by, created_by_type)
     VALUES ($1, $2, 1, 'FX-1', 'product', $6, $3, jsonb_build_object('pv', $4::text), $5, 'system')`,
    [w.tenantId, orderId, amountMinor, String(amountMinor), SYSTEM, options.quantity ?? 1])
  return orderId
}

/**
 * A refund (or other event) of `quantity` units (default every unit) of the order's line 1, shaped like ORD's: volume
 * effect total and refund amount for those units (a chargeback_reversed, naming its chargeback in `reverses`, credits back).
 */
export async function orderEvent(
  w: World, orderId: string, at: Date | string, type = 'refund',
  options: { refundMinor?: number; equalValue?: boolean; quantity?: number; reverses?: string } = {},
): Promise<string> {
  const [o] = await ownerRows<{ amount_minor: string; quantity: number }>(
    'SELECT o.amount_minor::text, l.quantity FROM sales_order o JOIN order_line l ON l.order_id = o.id AND l.line_no = 1 WHERE o.id = $1', [orderId])
  const quantity = options.quantity ?? o!.quantity
  const share = (Number(o!.amount_minor) * quantity) / o!.quantity
  const key = randomUUID()
  const inbound = await one(
    `INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
     VALUES ($1, 'api:fixture', $2, sha256(convert_to($2, 'UTF8')), now(), 'processed', $3, 'system') RETURNING id`, [w.tenantId, `event:${key}`, SYSTEM])
  const reversed = options.equalValue === true ? 0 : type === 'chargeback_reversed' ? share : -share
  return one(
    `INSERT INTO order_event (tenant_id, order_id, source_system, source_event_id, type, occurred_at, lines, refund_minor, fee_minor,
       equal_value, volume_effect, reverses_event_id, inbound_event_id, created_by, created_by_type)
     VALUES ($1, $2, 'fixture', $3, $4, $5, jsonb_build_array(jsonb_build_object('line_no', 1, 'quantity', $6::int)),
             $7, 0, $8, jsonb_build_object('total', jsonb_build_object('pv', $9::text)), $10, $11, $12, 'system') RETURNING id`,
    [w.tenantId, orderId, key, type, at, quantity, options.refundMinor ?? share, options.equalValue === true, String(reversed),
      options.reverses ?? null, inbound, SYSTEM],
  )
}

/** A late item as ORD records it for a committed period. */
export async function lateItem(w: World, ref: { orderId?: string; eventId?: string }, periodId: string, handling: 'adjust' | 'restatement' = 'adjust'): Promise<string> {
  return one(
    `INSERT INTO late_transaction (tenant_id, order_id, order_event_id, original_period_id, handling, state, created_by, created_by_type)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'system') RETURNING id`,
    [w.tenantId, ref.orderId ?? null, ref.eventId ?? null, periodId, handling, SYSTEM],
  )
}

export type Policy = 'order_line' | 'restatement'

/**
 * The TS-10 plan (ENGINE fixture ts10-refund): pv = order amount, gv = sponsor group; rank_bonus 5 % / 10 % of gv for
 * R1 (pv >= 0.01) / R2 (also gv >= 700.00); match 20 % of the sponsored positions' rank_bonus. `rolling` adds a rank R3
 * needing pv >= 0.01 over a rolling window of that many periods (history, TS-63).
 */
export function ts10Plan(options: { rank?: Policy; match?: Policy; rolling?: number; capRate?: string } = {}): Omit<PlanVersion, 'planVersionId' | 'calendars'> {
  const measure = (key: string, atLeastMinor: bigint, window: { type: 'period' } | { type: 'rolling'; periods: number } = { type: 'period' }) =>
    ({ kind: 'measure' as const, measure: key, atLeastMinor, window, maxPerLegShare: null })
  return {
    version: 1, contentHash: '', effectiveFromUs: 0n,
    measures: [
      { kind: 'volume.personal', key: 'pv', unit: 'currency', source: { from: 'amount' }, items: { excludeItemClasses: [], categories: null }, orders: 'all' },
      { kind: 'volume.group', key: 'gv', of: 'pv', tree: 'sponsor', includeSelf: true },
    ],
    ladders: [{ key: 'main', ranks: [
      { key: 'R1', requires: [measure('pv', 1n)], maintenance: null },
      { key: 'R2', requires: [measure('pv', 1n), measure('gv', 70_000n)], maintenance: null },
      ...(options.rolling === undefined ? [] : [{ key: 'R3', requires: [measure('pv', 1n, { type: 'rolling', periods: options.rolling })], maintenance: null }]),
    ] }],
    bonuses: [
      { key: 'rank_bonus', kind: 'pay.percent_of_measure', sourceKind: 'downline_volume', reversalPolicy: options.rank ?? 'order_line', eligibleIf: null,
        measure: 'gv', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.05' }, { rank: 'R2', rate: '0.10' }] } },
      { key: 'match', kind: 'pay.matching', sourceKind: 'match', reversalPolicy: options.match ?? 'restatement', eligibleIf: null, tree: 'sponsor',
        of: ['rank_bonus'], rates: ['0.20'] },
    ],
    constraints: [],
    caps: options.capRate === undefined ? [] : [{ key: 'company_cap', scope: ['rank_bonus'], base: { kind: 'measure', measure: 'pv' }, rate: options.capRate,
      method: { type: 'proportional' }, residue: 'breakage' }],
    carries: [], counters: [], transitions: [], pointsToCurrency: [], customerRollUp: null,
  }
}

export interface ActivePlan {
  readonly planId: string
  readonly versionId: string
}

/** A plan on the market and calendar with version 1 active from `effectiveFrom` (submitted, approved and activated by three people). */
export async function activePlan(
  w: World, plan: ReturnType<typeof ts10Plan>, effectiveFrom: Date | string, existing?: { planId: string; version: number; state?: 'active' | 'scheduled' },
): Promise<ActivePlan> {
  const planId = existing?.planId ?? await one(`INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [w.tenantId, `plan-${randomUUID().slice(0, 8)}`, w.analyst.id])
  if (existing === undefined) {
    await ownerRows('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [w.tenantId, planId, w.marketId])
    await ownerRows('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [w.tenantId, planId, w.calendarId])
  }
  const versionId = randomUUID()
  const compiled = JSON.parse(stringifyEngineJson({ [w.calendarId]: { ...plan, planVersionId: versionId, calendars: [w.calendarId] } })) as unknown
  const approvalId = await approval(w.tenantId, 'plan_version', versionId, w.analyst.id, w.compliance.id)
  const activationId = await approval(w.tenantId, 'plan_version', versionId, w.analyst.id, w.finance.id)
  await ownerRows(
    `INSERT INTO plan_version (id, tenant_id, plan_id, version, state, effective_from, justification, engine_version, crediting_event,
       compiled, content_hash, submitted_by, submitted_at, approval_id, activation_approval_id, activated_at, created_by)
     VALUES ($1, $2, $3, $4, $10, $5, 'fixture', '0.1.0', 'paid', $6, digest($6::jsonb::text, 'sha256'), $7, now(), $8, $9,
             CASE WHEN $10 = 'active' THEN now() END, $7)`,
    [versionId, w.tenantId, planId, existing?.version ?? 1, effectiveFrom, compiled, w.analyst.id, approvalId, activationId, existing?.state ?? 'active'],
  )
  return { planId, versionId }
}

/** POST runs, then the worker: the run id. */
export async function calculate(app: FastifyInstance, w: World, periodId: string, as: TestUser = w.analyst): Promise<string> {
  const response = await call(app, { method: 'POST', url: `/v1/periods/${periodId}/runs`, as, headers: { 'run-request-id': randomUUID() } })
  expect(response.statusCode, response.body).toBe(202)
  await runQueuedJobs(calculateRunJob)
  return response.json().data.run_id
}

/** Review (opens it), request commit (analyst) and commit (finance, acknowledging every blocking exception): the commit's data. */
export async function commit(app: FastifyInstance, w: World, runId: string, by: TestUser = w.finance): Promise<{ journal_entry_id: string | null }> {
  const review = await call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as: w.analyst })
  expect(review.statusCode, review.body).toBe(200)
  const blocking = (review.json().data.exceptions as { id: string; blocking: boolean }[]).filter((e) => e.blocking).map((e) => e.id)
  await call(app, { method: 'POST', url: `/v1/runs/${runId}/request-commit`, as: w.analyst, idempotencyKey: true })
  const committed = await call(app, { method: 'POST', url: `/v1/runs/${runId}/commit`, as: by, idempotencyKey: true, body: { acknowledged_exceptions: blocking } })
  expect(committed.statusCode, committed.body).toBe(200)
  return committed.json().data
}

export async function linesOf(runId: string): Promise<{ position: string; rule: string; amount: string; origin: string | null }[]> {
  return ownerRows(
    `SELECT payee_position_id AS position, rule_key AS rule, amount_minor::text AS amount, origin_type AS origin
     FROM result_line WHERE run_id = $1 ORDER BY payee_position_id, rule_key, origin_type NULLS FIRST`,
    [runId],
  )
}

/** An evidence document of the user (no file: case tests only reference it). */
export async function evidenceDocument(u: TestUser): Promise<string> {
  return one(
    `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, file_name)
     VALUES ($1, 'evidence', 'documents/fixture', sha256(gen_random_uuid()::text::bytea), 'application/pdf', 1, $2, 1, 'fixture.pdf') RETURNING id`,
    [u.tenantId, u.id],
  )
}

/** One microsecond-free instant inside a period (an hour after it starts). */
export const inside = (p: Period, hours = 1): Date => new Date(p.starts_at.getTime() + hours * 3_600_000)

/** Owner writes with triggers off (session_replication_role replica, this transaction only): tampering fixtures. */
export async function ownerUnchecked(sql: string, params: unknown[]): Promise<void> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    await client.query(sql, params)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** The postings of the run's journal entry: [type, payee | null, debit, credit], sorted. */
export async function postingsOf(runId: string): Promise<[string, string | null, string, string][]> {
  const rows = await ownerRows<{ type: string; payee: string | null; debit: string; credit: string }>(
    `SELECT a.type, a.payee_participant_id AS payee, x.debit_minor::text AS debit, x.credit_minor::text AS credit
     FROM journal_entry e JOIN posting x ON x.entry_id = e.id JOIN ledger_account a ON a.id = x.account_id
     WHERE e.origin_type = 'run' AND e.origin_id = $1 ORDER BY a.type, a.payee_participant_id NULLS FIRST, x.debit_minor`,
    [runId],
  )
  return rows.map((r) => [r.type, r.payee, r.debit, r.credit])
}

/** Normal-side balance of a payee's account in the world's market (led_balance). */
export async function balance(w: World, participantId: string | null, type: string): Promise<string> {
  const [row] = await ownerRows<{ amount: string }>(
    `SELECT coalesce(sum(CASE WHEN $3 IN ('commission_expense', 'clawback_receivable', 'write_off', 'rounding_residue')
                             THEN x.debit_minor - x.credit_minor ELSE x.credit_minor - x.debit_minor END), 0)::text AS amount
     FROM ledger_account a JOIN posting x ON x.account_id = a.id
     WHERE a.market_id = $1 AND a.payee_participant_id IS NOT DISTINCT FROM $2 AND a.type = $3`,
    [w.marketId, participantId, type],
  )
  return row!.amount
}

/**
 * A migration of the world's market cut over at `periodId`, already `opening_posted` or `signed_off` (D-B6-10/11), written
 * by the owner with triggers off: its import batch is not modelled. The opening approval is the analyst's, decided by finance.
 */
export async function migrationAt(w: World, periodId: string, state: 'opening_posted' | 'signed_off'): Promise<{ id: string; openingApprovalId: string }> {
  const id = randomUUID()
  const openingApprovalId = await approval(w.tenantId, 'migration', id, w.analyst.id, w.finance.id)
  const signoff = state === 'signed_off' ? await approval(w.tenantId, 'migration', id, w.analyst.id, w.finance2.id) : null
  await ownerUnchecked(
    `INSERT INTO migration (id, tenant_id, market_id, import_batch_id, cutover_period_id, volume_key, state, applied_counts, applied_at,
       opening_submitted_by, opening_submitted_at, opening_approval_id, signoff_approval_id, signed_off_at, created_by)
     VALUES ($1, $2, $3, gen_random_uuid(), $4, 'pv', $5, '{}', now(), $6, now(), $7, $8::uuid, CASE WHEN $8::uuid IS NOT NULL THEN now() END, $6)`,
    [id, w.tenantId, w.marketId, periodId, state, w.analyst.id, openingApprovalId, signoff],
  )
  return { id, openingApprovalId }
}
