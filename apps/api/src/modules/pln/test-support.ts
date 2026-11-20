// Fixtures for PLN tests. Markets, calendars, periods, guardrail pack rules, custom roles and completed simulations are
// written through the owner pool (labelled FIXTURE: COMP owns simulations, TEN period generation, the platform the packs).
import { randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { call, createSignedInUser, createTenant, ownerRows, type TestUser } from '../../../test/helpers/index.js'

export interface World {
  readonly tenantId: string
  readonly pack: string
  readonly marketA: string
  readonly marketB: string
  readonly calendarA: string
  readonly calendarB: string
  readonly planadmin: TestUser
  readonly compliance: TestUser
  readonly finance: TestUser
  readonly executive: TestUser
}

/** FIXTURE: a live market of `pack` (EUR, Europe/Berlin). */
async function market(tenantId: string, code: string, pack: string): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, $2, 'EUR', 2, 'Europe/Berlin', '{de}', $3, 'live') RETURNING id`,
    [tenantId, code, pack],
  )
  return row!.id
}

/** FIXTURE: a monthly Europe/Berlin calendar with open periods from 2026-01 through 2027-12 (local midnights, DST-aware). */
export async function berlinCalendar(tenantId: string, marketId: string, name: string): Promise<string> {
  const [calendar] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
     VALUES ($1, $2, $3, 'monthly', 'Europe/Berlin', '2026-01-01') RETURNING id`,
    [tenantId, marketId, name],
  )
  await ownerRows(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
     SELECT $1, $2, (d::timestamp) AT TIME ZONE 'Europe/Berlin', ((d + interval '1 month')::timestamp) AT TIME ZONE 'Europe/Berlin'
     FROM generate_series(date '2026-01-01', date '2027-12-01', interval '1 month') AS d`,
    [tenantId, calendar!.id],
  )
  return calendar!.id
}

/** FIXTURE: pack guardrail rules shaped like the e2e fixture pack (not real market rules). */
export async function packRules(pack: string): Promise<void> {
  await ownerRows(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status, source_ref, effective_from)
     VALUES ($1 || '-enrolment@2026-01-01', $1, 'FIXTURE enrolment-only pay', 'blocked', '{"check":"enrolment_only_pay"}', false, true,
             'Test fixture basis, not a real market rule', 'screening', 'Test fixture', '2026-01-01'),
            ($1 || '-starter@2026-01-01', $1, 'FIXTURE starter kit volume', 'warned', '{"check":"starter_kit_volume"}', true, false,
             'Test fixture basis, not a real market rule', 'screening', 'Test fixture', '2026-01-01')`,
    [pack],
  )
}

/** FIXTURE: a settings version in force from now with `values` merged over the latest one (TEN writes these). */
export async function setSettings(tenantId: string, userId: string, values: Record<string, unknown>): Promise<void> {
  await ownerRows(
    `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, now(),
            coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}') || $2::jsonb,
            'FIXTURE settings', $3
     FROM tenant_setting_version WHERE tenant_id = $1`,
    [tenantId, JSON.stringify(values), userId],
  )
}

/**
 * FIXTURE: an approval-keyed setting (plan.filing_requirements, D-B6-17) in force from now, with its approved change
 * request, in one owner transaction (TEN writes these through settings change requests).
 */
export async function approvedSetting(tenantId: string, key: string, value: unknown, requester: TestUser, approver: TestUser): Promise<void> {
  const client = await getOwnerPool().connect()
  try {
    await client.query('BEGIN')
    const requestId = randomUUID()
    const { rows: [at] } = await client.query<{ now: Date; base: number }>(
      'SELECT now(), coalesce(max(version), 0) AS base FROM tenant_setting_version WHERE tenant_id = $1', [tenantId])
    const { rows: [approval] } = await client.query<{ id: string }>(
      `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
       VALUES ($1, 'setting_change_request', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [tenantId, requestId, requester.id, approver.id])
    const { rows: [version] } = await client.query<{ id: string }>(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by, approval_id)
       SELECT $1, $2 + 1, $3, coalesce((SELECT settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1), '{}')
              || jsonb_build_object($4::text, $5::jsonb), 'FIXTURE', $6, $7 RETURNING id`,
      [tenantId, at!.base, at!.now, key, JSON.stringify(value), requester.id, approval!.id])
    await client.query(
      `INSERT INTO setting_change_request (id, tenant_id, key, value, effective_from, reason, base_version, state, requested_by, requested_at,
         decided_by, decided_at, approval_id, version_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'FIXTURE', $6, 'approved', $7, now(), $8, now(), $9, $10)`,
      [requestId, tenantId, key, JSON.stringify(value), at!.now, at!.base, requester.id, approver.id, approval!.id, version!.id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** FIXTURE: an order of `marketId` ingested by ORD (owner pool), ordered and credited at `orderedAt`. */
export async function ingestedOrder(tenantId: string, marketId: string, userId: string, orderedAt: string, sourceSystem = 'fixture'): Promise<void> {
  const ref = randomUUID().slice(0, 8)
  await ownerRows(
    `WITH t AS (INSERT INTO participant_type (tenant_id, code, name, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions, state, reason, requested_by)
                VALUES ($1, 'FX' || upper($5), 'Fixture type', true, false, true, true, 'pending', 'FIXTURE', $3) RETURNING id),
          p AS (INSERT INTO participant (tenant_id, external_ref, account_type, market_id, enrolled_at, created_by, created_by_type)
                VALUES ($1, 'FX-' || $5, 'individual', $2, $4::timestamptz, $3, 'user') RETURNING id),
          e AS (INSERT INTO inbound_event (tenant_id, source, idempotency_key, payload_hash, processed_at, state, created_by, created_by_type)
                VALUES ($1, 'api:fixture', 'order:' || $5, digest($5, 'sha256'), now(), 'processed', $3, 'user') RETURNING id)
     INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
                              attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id, created_by, created_by_type)
     SELECT $1, $6, $5, $2, p.id, t.id, 'personal', false, false, $4::timestamptz, $4::timestamptz, 1000, 0, 'EUR', digest($5, 'sha256'), e.id, $3, 'user'
     FROM t, p, e`,
    [tenantId, marketId, userId, orderedAt, ref, sourceSystem],
  )
}

/** FIXTURE: a tenant role holding exactly `permissions`, assigned to a new signed-in user (step-up fresh). */
export async function customRoleUser(tenantId: string, permissions: readonly string[], marketIds: readonly string[] | null = null): Promise<TestUser> {
  const user = await createSignedInUser({ tenantId, stepUp: true })
  const [role] = await ownerRows<{ id: string }>(
    'INSERT INTO role (tenant_id, name, permissions, is_base, mfa_required) VALUES ($1, $2, $3, false, true) RETURNING id',
    [tenantId, `custom ${randomUUID().slice(0, 8)}`, permissions],
  )
  await ownerRows(
    'INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from) VALUES ($1, $2, $3, $4, now())',
    [tenantId, user.id, role!.id, marketIds],
  )
  return user
}

export async function world(): Promise<World> {
  const tenant = await createTenant()
  const pack = `pln-${randomUUID().slice(0, 8)}`
  await packRules(pack)
  const marketA = await market(tenant.id, 'DE', pack)
  const marketB = await market(tenant.id, 'AT', pack)
  return {
    tenantId: tenant.id, pack, marketA, marketB,
    calendarA: await berlinCalendar(tenant.id, marketA, 'DE monthly'),
    calendarB: await berlinCalendar(tenant.id, marketB, 'AT monthly'),
    planadmin: await createSignedInUser({ tenantId: tenant.id, roles: ['Plan administrator'] }),
    compliance: await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'], stepUp: true }),
    finance: await createSignedInUser({ tenantId: tenant.id, roles: ['Finance approver'], stepUp: true }),
    executive: await createSignedInUser({ tenantId: tenant.id, roles: ['Executive read-only'] }),
  }
}

export const personal = (name = 'pv', exclude: readonly string[] = ['starter_kit']) => ({
  unit: 'currency', source: { from: 'volume', name }, items: { excludeItemClasses: exclude, categories: null }, orders: 'all',
})
export const UNILEVEL = { kind: 'pay.percent_by_level', reversal_policy: 'order_line', params: { sourceKind: 'downline_volume', eligibleIf: null, tree: 'sponsor', measure: 'pv', levels: ['0.08'], compression: 'none' } }
export const CAPPED = { kind: 'measure.derived', params: { expr: { op: 'min', args: [{ measure: 'pv' }, { const: '50000' }] } } }

/** Engine input of a golden dataset (stored JSON form): A sponsors B; B buys 100.00 pv, so unilevel pays A 8.00. */
export const GOLDEN_INPUT = {
  snapshot: {
    snapshotId: 'golden', market: { marketId: 'M', currency: 'EUR', minorDigits: 2 },
    period: { periodId: 'p', calendar: 'c', startsAtUs: '1767222000000000', endsAtUs: '1769900400000000' }, knownAtUs: '1769900400000000',
    participantTypes: [{ code: 'd', canEarn: true, countsAsEndCustomer: false, canSponsor: true, canHoldPositions: true }],
    participants: [{ participantId: 'pA', typeCode: 'd', enrolledAtUs: '1700000000000000', facts: [] }, { participantId: 'pB', typeCode: 'd', enrolledAtUs: '1700000000000000', facts: [] }],
    positions: [{ positionId: 'A', ownerParticipantId: 'pA', status: 'active', statusFromUs: '1700000000000000' }, { positionId: 'B', ownerParticipantId: 'pB', status: 'active', statusFromUs: '1700000000000000' }],
    relationships: [{ kind: 'sponsor', parentPositionId: 'A', childPositionId: 'B', leg: null, validFromUs: '1700000000000000', validToUs: null, recordedAtUs: '1700000000000000', supersededAtUs: null }],
    orders: [{ orderId: 'o1', buyerParticipantId: 'pB', buyerTypeCode: 'd', purpose: 'personal', creditPositionId: 'B', creditedAtUs: '1767300000000000',
      lines: [{ lineId: '1', productId: 'FX-1', itemClass: 'product', category: '', quantity: 1, amountMinor: '10000', taxMinor: '0', volumes: [{ name: 'pv', perUnitMinor: '10000' }] }] }],
    orderEvents: [], history: [], priorState: null, adjustments: [], receivables: [], withholding: [],
  },
  settings: { settingsVersionId: 's', roundingMode: 'half_up', restockingFeeAffectsVolume: false },
}
export const GOLDEN_EXPECTED = { lines: [{ payee_position_id: 'A', rule_key: 'unilevel', amount_minor: '800' }], total_minor: '800' }

/**
 * FIXTURE: a completed simulation of the version on its calendar's January 2026 period with the golden snapshot and no
 * lines (COMP writes simulations; content_hash = the version's compiled digest now).
 */
export async function completedSimulation(versionId: string, calendarId: string): Promise<string> {
  const content = gzipSync(Buffer.from(JSON.stringify({ ...GOLDEN_INPUT.snapshot, orders: [] })))
  const [row] = await ownerRows<{ id: string }>(
    `WITH p AS (SELECT id, tenant_id FROM period WHERE calendar_id = $2 ORDER BY starts_at LIMIT 1),
     s AS (INSERT INTO run_snapshot (tenant_id, period_id, known_at, content, content_sha256, row_counts, order_ids, order_event_ids)
           SELECT tenant_id, id, now(), $3::bytea, digest($3::bytea, 'sha256'), '{}', '{}', '{}' FROM p RETURNING id, tenant_id, period_id)
     INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, state, snapshot_id, content_hash, totals, comparison, requested_by, finished_at)
     SELECT s.tenant_id, v.id, s.period_id, 'simulation', 'completed', s.id, digest(v.compiled::text, 'sha256'), '{"simulated_minor":"0"}', '{}', v.created_by, now()
     FROM s, plan_version v WHERE v.id = $1 RETURNING id`,
    [versionId, calendarId, content],
  )
  return row!.id
}

export interface NewPlan { readonly planId: string; readonly revision: number; readonly calendarA: string; readonly calendarB: string }

/** POST /v1/plans over both world markets with two fresh calendars (a calendar belongs to one plan); `body` overrides. */
export async function newPlan(app: FastifyInstance, w: World, body: Record<string, unknown> = {}): Promise<NewPlan> {
  const suffix = randomUUID().slice(0, 8)
  const calendarA = await berlinCalendar(w.tenantId, w.marketA, `DE ${suffix}`)
  const calendarB = await berlinCalendar(w.tenantId, w.marketB, `AT ${suffix}`)
  const response = await call(app, {
    method: 'POST', url: '/v1/plans', as: w.planadmin, idempotencyKey: true,
    body: { name: `Plan ${suffix}`, market_ids: [w.marketA, w.marketB], calendar_ids: [calendarA, calendarB], ...body },
  })
  if (response.statusCode !== 201) throw new Error(`newPlan: ${response.statusCode} ${response.body}`)
  return { planId: response.json().data.plan.id, revision: response.json().data.version.revision, calendarA, calendarB }
}

/** The current revision of a version (ETag of GET). */
export async function revisionOf(app: FastifyInstance, as: TestUser, planId: string, v = 1): Promise<number> {
  const response = await call(app, { method: 'GET', url: `/v1/plans/${planId}/versions/${v}`, as })
  return Number(String(response.headers.etag).replaceAll('"', ''))
}

/** PUT one rule with the current revision. */
export async function putRule(app: FastifyInstance, as: TestUser, planId: string, key: string, body: Record<string, unknown>, v = 1) {
  const revision = await revisionOf(app, as, planId, v)
  return call(app, { method: 'PUT', url: `/v1/plans/${planId}/versions/${v}/rules/${key}`, as, body, headers: { 'if-match': `"${revision}"` } })
}
