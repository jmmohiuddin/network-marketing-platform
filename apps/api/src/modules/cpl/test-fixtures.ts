// Test-only: compliance facts written straight into cpl_fact_* (no dependency on the import module).
import { withTenant, type Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { call, createMarket, createSignedInUser, createTenant, type TestUser } from '../../../test/helpers/index.js'

/** The prototype's DEFAULT_CONFIG as tenant settings. Test values only: the product ships none (DEC-14). */
export const PROTOTYPE_SETTINGS = {
  'compliance.active_pv_minor': '5000',
  'compliance.rank_thresholds_pv_minor': { active: '5000', leader: '10000' },
  'compliance.late_order_day': 27,
  'compliance.personal_share_flag': { numerator: '1', denominator: '3' },
}

const END_CUSTOMER_TYPES = new Set(['customer', 'preferred_customer'])

/** [ref, type, enrolled 'YYYY-MM', servicing ref] */
export type ParticipantInput = readonly [string, string, string, string | null]
/** [ref, order date, buyer, amount, volume, purpose, starter kit, refunded, refund month 'YYYY-MM'] */
export type OrderInput = readonly [string, string, string, string, string, string, boolean, string, string | null]
/** [ref, pay month 'YYYY-MM', payee, bonus type, source kind, source order, amount] */
export type LineInput = readonly [string, string, string, string, string, string | null, string]

export interface FactsInput {
  readonly participants: readonly ParticipantInput[]
  readonly orders: readonly OrderInput[]
  readonly lines: readonly LineInput[]
}

/** TS-31 (MVP_A_SPEC 6.1): D1, D2 distributors, C1 customer; three January orders; four payout lines. */
export const TS31: FactsInput = {
  participants: [['D1', 'distributor', '2024-12', null], ['D2', 'distributor', '2025-01', 'D1'], ['C1', 'customer', '2025-01', 'D1']],
  orders: [
    ['O1', '2025-01-03', 'C1', '10000', '10000', 'customer', false, '0', null],
    ['O2', '2025-01-05', 'D2', '6000', '6000', 'personal', false, '0', null],
    ['O3', '2025-01-28', 'D2', '4000', '4000', 'resale', false, '4000', '2025-02'],
  ],
  lines: [
    ['L1', '2025-01', 'D1', 'retail_commission', 'retail_sale', 'O1', '2500'],
    ['L2', '2025-01', 'D1', 'unilevel', 'downline_volume', 'O2', '360'],
    ['L3', '2025-01', 'D1', 'unilevel', 'downline_volume', 'O3', '240'],
    ['L4', '2025-02', 'D1', 'clawback', 'clawback', 'O3', '-240'],
  ],
}

const column = <T extends readonly unknown[], K extends number>(rows: readonly T[], index: K): T[K][] => rows.map((row) => row[index])
const month = (value: string | null): string | null => (value === null ? null : `${value}-01`)

/** A settings version in force from now, as an admin would save it through PUT /v1/settings. */
export async function saveSettings(user: TestUser, settings: Record<string, unknown>): Promise<void> {
  await withTenant({ tenantId: user.tenantId!, userId: user.id }, (tx) =>
    tx.query(
      `INSERT INTO tenant_setting_version (tenant_id, version, effective_from, settings, reason, created_by)
       SELECT app_tenant_id(), coalesce(max(version), 0) + 1, now(), $1, 'test', $2 FROM tenant_setting_version`,
      [settings, user.id],
    ),
  )
}

/** The FR-IMP-003 report the import module stores at load (IMP DataQuality shape). */
function dataQuality({ orders, lines }: FactsInput) {
  const refunded = orders.filter((o) => o[7] !== '0')
  return {
    orders: orders.length, orders_unknown_purpose: orders.filter((o) => o[5] === 'unknown').length,
    refunded_orders: refunded.length, refunds_without_month: refunded.filter((o) => o[8] === null).length,
    payout_lines: lines.length, payout_lines_without_source_order: lines.filter((l) => l[5] === null).length,
    payout_lines_unknown_source_kind: lines.filter((l) => l[4] === 'unknown').length, unmapped: { purposes: [], source_kinds: [] },
  }
}

/** The tenant's newest mapping version, created as approved version 1 on first use. */
async function currentMapping(tx: Tx, userId: string): Promise<string> {
  await tx.query(
    `INSERT INTO import_mapping (tenant_id, version, mappings, state, approved_by, created_by)
     VALUES (app_tenant_id(), 1, '{}', 'approved', $1, $1) ON CONFLICT (tenant_id, version) DO NOTHING`,
    [userId],
  )
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM import_mapping ORDER BY version DESC LIMIT 1')
  return rows[0]!.id
}

/** Saving a mapping as the import module does (FR-IMP-002): a new version. Returns its id. */
export async function newMappingVersion(user: TestUser): Promise<string> {
  return withTenant({ tenantId: user.tenantId!, userId: user.id }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO import_mapping (tenant_id, version, mappings, state, created_by)
       SELECT app_tenant_id(), coalesce(max(version), 0) + 1, '{}', 'draft', $1 FROM import_mapping RETURNING id`,
      [user.id],
    )
    return rows[0]!.id
  })
}

/**
 * One import batch loaded with its facts, written in the tenant realm as the import module's load does: the
 * batch is mapped while its facts are written, then loaded.
 */
export async function loadBatch(user: TestUser, marketId: string, period: readonly [string, string], facts: FactsInput): Promise<string> {
  return withTenant({ tenantId: user.tenantId!, userId: user.id }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO import_batch (tenant_id, market_id, kind, period_from, period_to, state, mapping_id, uploaded_by)
       VALUES (app_tenant_id(), $1, 'overlay', $2, $3, 'mapped', $4, $5) RETURNING id`,
      [marketId, period[0], period[1], await currentMapping(tx, user.id), user.id],
    )
    const batchId = rows[0]!.id
    const { participants: p, orders: o, lines: l } = facts
    await tx.query(
      `INSERT INTO cpl_fact_participant (tenant_id, source, batch_id, market_id, participant_ref, type_code,
         counts_as_end_customer, can_earn, enrolled_month, servicing_ref)
       SELECT app_tenant_id(), 'import', $1, $2, * FROM unnest($3::text[], $4::text[], $5::bool[], $6::bool[], $7::date[], $8::text[])`,
      [batchId, marketId, column(p, 0), column(p, 1), p.map((r) => END_CUSTOMER_TYPES.has(r[1])),
        p.map((r) => !END_CUSTOMER_TYPES.has(r[1])), column(p, 2).map(month), column(p, 3)],
    )
    await tx.query(
      `INSERT INTO cpl_fact_order (tenant_id, source, batch_id, order_ref, order_date, buyer_ref, amount_minor, volume_minor,
         purpose, is_starter_kit, refunded_minor, refund_month)
       SELECT app_tenant_id(), 'import', $1, * FROM unnest($2::text[], $3::date[], $4::text[], $5::bigint[], $6::bigint[],
         $7::text[], $8::bool[], $9::bigint[], $10::date[])`,
      [batchId, column(o, 0), column(o, 1), column(o, 2), column(o, 3), column(o, 4), column(o, 5), column(o, 6),
        column(o, 7), column(o, 8).map(month)],
    )
    await tx.query(
      `INSERT INTO cpl_fact_payout_line (tenant_id, source, batch_id, line_ref, pay_month, payee_ref, bonus_type, source_kind,
         source_order_ref, amount_minor)
       SELECT app_tenant_id(), 'import', $1, * FROM unnest($2::text[], $3::date[], $4::text[], $5::text[], $6::text[],
         $7::text[], $8::bigint[])`,
      [batchId, column(l, 0), column(l, 1).map(month), column(l, 2), column(l, 3), column(l, 4), column(l, 5), column(l, 6)],
    )
    await tx.query(`UPDATE import_batch SET state = 'loaded', data_quality = $2 WHERE id = $1`, [batchId, dataQuality(facts)])
    return batchId
  })
}

/** The import module's supersede step: loaded -> superseded. */
export async function supersede(user: TestUser, batchId: string, byBatchId: string): Promise<void> {
  await withTenant({ tenantId: user.tenantId!, userId: user.id }, (tx) =>
    tx.query(`UPDATE import_batch SET state = 'superseded', superseded_by = $2 WHERE id = $1`, [batchId, byBatchId]),
  )
}

export const JAN_FEB = { market: 'GB', period_from: '2025-01', period_to: '2025-02' }
export const JAN_FEB_DATES = ['2025-01-01', '2025-02-28'] as const

/** A tenant of its own with a GB market, an officer, the settings given (none for null) and one Jan-Feb 2025 batch. */
export async function freshTenant(facts: FactsInput, settings: Record<string, unknown> | null = PROTOTYPE_SETTINGS) {
  const tenant = await createTenant()
  const market = await createMarket(tenant.id, 'GB')
  const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'] })
  if (settings !== null) await saveSettings(user, settings)
  const batch = await loadBatch(user, market, JAN_FEB_DATES, facts)
  return { tenant, market, user, batch }
}

/** POST /v1/compliance/snapshots with a fresh Idempotency-Key. */
export function requestSnapshot(app: FastifyInstance, as: TestUser, body: Record<string, unknown>) {
  return call(app, { method: 'POST', url: '/v1/compliance/snapshots', as, body, idempotencyKey: true })
}

export function getSnapshot(app: FastifyInstance, as: TestUser, id: string) {
  return call(app, { method: 'GET', url: `/v1/compliance/snapshots/${id}`, as })
}

export function getRows(app: FastifyInstance, as: TestUser, snapshotId: string, figureId: string, query = '') {
  return call(app, { method: 'GET', url: `/v1/compliance/snapshots/${snapshotId}/figures/${encodeURIComponent(figureId)}/rows${query}`, as })
}

interface FigureView {
  id: string
  value: string | null
  numerator: string | null
  denominator: string | null
  [field: string]: unknown
}

interface PeriodView {
  report: string
  period: string
  partial: boolean
  notes: string[]
  figures: FigureView[]
  omitted: { key: string; reason: string }[]
}

/** The figure `{report}.{period}.{key}` of a GET /v1/compliance/snapshots/:id body. */
export function figureIn(body: { data: { results: PeriodView[] } }, figureId: string): FigureView {
  const found = body.data.results.flatMap((period) => period.figures).find((figure) => figure.id === figureId)
  if (found === undefined) throw new Error(`no figure ${figureId}`)
  return found
}

export function periodIn(body: { data: { results: PeriodView[] } }, report: string, period: string): PeriodView {
  const found = body.data.results.find((result) => result.report === report && result.period === period)
  if (found === undefined) throw new Error(`no period ${report} ${period}`)
  return found
}
