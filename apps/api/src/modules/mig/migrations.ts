// Migrations (PLAN B6 D-B6-09, API-38): created from a loaded migration batch of a market in implementation, applied once
// by SQL mig_apply_batch (participants, positions, sponsors, servicing, orders, refunds), cancelled only as a draft.
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { requireAnyPermission, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { assertState, loadMigration, planAtCutover, READERS, readScope, writeScope } from './access.js'

const createBody = z.strictObject({
  import_batch_id: z.uuid(), cutover_period_id: z.uuid(), volume_key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
})
const cancelBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })
const listQuery = z.strictObject({ ...pageQuery })

const UNEXPLAINED = `count(*) FILTER (WHERE d.delta_minor <> 0 AND d.accepted_at IS NULL)`
const APPROVAL = (column: string) => `(SELECT jsonb_build_object('id', a.id, 'by', jsonb_build_object('id', a.approver_id, 'display_name', u.display_name), 'at', a.decided_at)
   FROM approval a JOIN user_account u ON u.id = a.approver_id WHERE a.id = ${column})`

/** API-38 migration view (money as minor-unit strings). */
export const MIGRATION_VIEW = `
  SELECT m.id, jsonb_build_object('id', k.id, 'code', k.code, 'currency', k.currency) AS market,
    jsonb_build_object('id', b.id, 'period_from', to_char(b.period_from, 'YYYY-MM'), 'period_to', to_char(b.period_to, 'YYYY-MM'),
                       'row_counts', b.row_counts) AS batch,
    jsonb_build_object('id', p.id, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'state', p.state) AS cutover_period,
    m.volume_key, m.state, m.applied_counts, m.applied_at,
    jsonb_build_object(
      'balances', (SELECT jsonb_build_object('count', count(*), 'total_minor', coalesce(sum(ob.amount_minor), 0)::text)
                   FROM migration_opening_balance ob WHERE ob.migration_id = m.id),
      'state_rows', (SELECT count(*) FROM migration_opening_state os WHERE os.migration_id = m.id),
      'submitted_by', m.opening_submitted_by, 'submitted_at', m.opening_submitted_at,
      'approval', ${APPROVAL('m.opening_approval_id')}, 'journal_entry_id', m.opening_entry_id) AS opening,
    (SELECT jsonb_build_object('id', r.id, 'state', r.state,
              'unexplained', (SELECT ${UNEXPLAINED} FROM parallel_run_difference d WHERE d.parallel_run_id = r.id))
     FROM parallel_run r WHERE r.migration_id = m.id AND r.state <> 'superseded') AS latest_parallel_run,
    ${APPROVAL('m.signoff_approval_id')} AS signoff,
    -- The bonus types of the batch's legacy payouts compared with the cutover period (mig_compare's month), for the bonus map.
    (SELECT coalesce(jsonb_agg(DISTINCT l.bonus_type ORDER BY l.bonus_type), '[]') FROM cpl_fact_payout_line l
     WHERE l.tenant_id = m.tenant_id AND l.batch_id = m.import_batch_id
       AND l.pay_month = date_trunc('month', p.starts_at AT TIME ZONE k.time_zone)::date) AS legacy_bonus_types,
    m.created_by, m.created_at
  FROM migration m
  JOIN market k ON k.tenant_id = m.tenant_id AND k.id = m.market_id
  JOIN import_batch b ON b.tenant_id = m.tenant_id AND b.id = m.import_batch_id
  JOIN period p ON p.tenant_id = m.tenant_id AND p.id = m.cutover_period_id`

export async function migrationView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<Record<string, unknown>>(`${MIGRATION_VIEW} WHERE m.id = $1`, [id])
  return rows[0]!
}

interface BatchFacts {
  readonly market_id: string
  readonly kind: string
  readonly state: string
  readonly market_state: string
  readonly period_from: string
  readonly period_to: string
  readonly in_batch: boolean | null
}

const notInImplementation = (): ApiError =>
  new ApiError(422, 'MARKET_NOT_IN_IMPLEMENTATION', 'A migration loads into a market that is still in implementation.')

/** D-B6-09 creation checks; the guard and the partial unique indexes enforce them again. */
async function createMigration(tx: Tx, scope: readonly string[] | null, body: z.infer<typeof createBody>): Promise<string> {
  const { rows } = await tx.query<BatchFacts>(
    `SELECT b.market_id, b.kind, b.state, k.state AS market_state, to_char(b.period_from, 'YYYY-MM') AS period_from,
            to_char(b.period_to, 'YYYY-MM') AS period_to,
            (SELECT date_trunc('month', p.starts_at AT TIME ZONE k.time_zone)::date BETWEEN b.period_from AND b.period_to
             FROM period p JOIN calendar c ON c.tenant_id = p.tenant_id AND c.id = p.calendar_id
             WHERE p.id = $2 AND c.market_id = b.market_id) AS in_batch
     FROM import_batch b JOIN market k ON k.tenant_id = b.tenant_id AND k.id = b.market_id
     WHERE b.id = $1 AND ($3::uuid[] IS NULL OR b.market_id = ANY ($3::uuid[]))
     FOR UPDATE OF b`,
    [body.import_batch_id, body.cutover_period_id, scope],
  )
  const batch = rows[0]
  if (batch === undefined || batch.in_batch === null) throw notFound()
  if (batch.kind !== 'migration') throw new ApiError(422, 'BATCH_KIND', 'A migration loads a batch imported with kind migration.')
  if (batch.state !== 'loaded') throw new ApiError(422, 'BATCH_NOT_LOADED', 'Load the migration batch first.', { state: batch.state })
  if (batch.market_state !== 'draft') throw notInImplementation()
  if (!batch.in_batch) {
    throw new ApiError(422, 'CUTOVER_OUTSIDE_BATCH', "The cutover period's month must be a month of the batch (its legacy payouts are compared).", { period_from: batch.period_from, period_to: batch.period_to })
  }
  // C is not calculated yet: an earlier run snapshotted neither the migrated orders nor the opening state, and the opening
  // posts into C. The row lock serialises with requestRun (loadPeriod FOR UPDATE), whose preflight then sees this migration.
  const { rows: cutover } = await tx.query<{ state: string; runs: boolean }>(
    `SELECT p.state, EXISTS (SELECT 1 FROM run r WHERE r.period_id = p.id AND r.state IN ('queued', 'running', 'calculated', 'committed')) AS runs
     FROM period p WHERE p.id = $1 FOR SHARE OF p`, [body.cutover_period_id])
  if (cutover[0]!.state !== 'open' || cutover[0]!.runs) {
    throw new ApiError(422, 'CUTOVER_NOT_OPEN', 'The cutover period must be open and not yet calculated.', { state: cutover[0]!.state })
  }
  await planAtCutover(tx, body.cutover_period_id, false)
  const exists =(): ApiError => new ApiError(409, 'MIGRATION_EXISTS', 'The market or the batch already has a migration.')
  const { rows: open } = await tx.query(
    "SELECT 1 FROM migration WHERE state <> 'cancelled' AND (market_id = $1 OR import_batch_id = $2) LIMIT 1", [batch.market_id, body.import_batch_id])
  if (open.length > 0) throw exists()
  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO migration (tenant_id, market_id, import_batch_id, cutover_period_id, volume_key)
     VALUES (app_tenant_id(), $1, $2, $3, $4) RETURNING id`,
    [batch.market_id, body.import_batch_id, body.cutover_period_id, body.volume_key],
  ).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === '23505') throw exists()
    throw error
  })
  const id = created[0]!.id
  await recordAudit(tx, { action: 'MIGRATION.CREATED', objectType: 'migration', objectId: id, after: { state: 'draft', ...body, market_id: batch.market_id } })
  return id
}

/**
 * mig_apply_batch refusals: MG001 DETAIL = findings JSON; 23514 DETAIL = the migration's state. The market is
 * share-locked and checked first, so it cannot go live between this check and the guard's (D-B6-09).
 */
async function applyBatch(tx: Tx, id: string, marketId: string): Promise<Record<string, number>> {
  const { rows: market } = await tx.query<{ state: string }>('SELECT state FROM market WHERE id = $1 FOR SHARE', [marketId])
  if (market[0]?.state !== 'draft') throw notInImplementation()
  try {
    const { rows } = await tx.query<{ counts: Record<string, number> }>('SELECT mig_apply_batch($1) AS counts', [id])
    return rows[0]!.counts
  } catch (error) {
    const { code, detail } = error as { code?: string; detail?: string }
    if (code === 'MG001') throw new ApiError(422, 'MIGRATION_INVALID', 'The batch cannot be applied; nothing was written.', { findings: JSON.parse(detail ?? '[]') as unknown })
    if (code === '23514' && detail !== undefined) throw new ApiError(409, 'MIGRATION_STATE', 'Only a draft migration of a market in implementation is applied.', { state: detail ?? null })
    throw error
  }
}

export function registerMigrationRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requireAnyPermission(...READERS)] }
  const manage = { preHandler: [requireRealm('tenant'), requirePermission('migration.manage')] }

  app.post('/v1/migrations', manage, async (request, reply) => {
    const body = parse(createBody, request.body)
    const scope = writeScope(request, 'migration.manage')
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () =>
      ({ statusCode: 201, body: envelope(await migrationView(tx, await createMigration(tx, scope, body))) })))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/migrations', read, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const rows = await inTenant(request, async (tx) => (await tx.query<{ id: string }>(
      `${MIGRATION_VIEW}
       WHERE ($1::uuid[] IS NULL OR m.market_id = ANY ($1::uuid[]))
         AND ($2::uuid IS NULL OR (m.created_at, m.id) < (SELECT created_at, id FROM migration WHERE id = $2))
       ORDER BY m.created_at DESC, m.id DESC LIMIT $3`,
      [readScope(request), after ?? null, query.limit + 1],
    )).rows)
    return toPage(rows, query.limit, (row) => row.id)
  })

  app.get('/v1/migrations/:id', read, async (request) =>
    envelope(await inTenant(request, async (tx) => migrationView(tx, (await loadMigration(tx, request, readScope(request))).id))))

  app.post('/v1/migrations/:id/apply', manage, async (request, reply) => {
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'), true)
      assertState(migration, 'draft')
      const counts = await applyBatch(tx, migration.id, migration.market_id)
      await recordAudit(tx, { action: 'MIGRATION.APPLIED', objectType: 'migration', objectId: migration.id, before: { state: 'draft' }, after: { state: 'applied', applied_counts: counts } })
      return { statusCode: 200, body: envelope({ applied_counts: counts }) }
    }))
    return sendIdempotent(reply, result)
  })

  // Apply cannot be undone, so only a draft is cancelled (D-B6-09); its batch and market are free again.
  app.post('/v1/migrations/:id/cancel', manage, async (request) => {
    const body = parse(cancelBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      const migration = await loadMigration(tx, request, writeScope(request, 'migration.manage'), true)
      assertState(migration, 'draft')
      await tx.query("UPDATE migration SET state = 'cancelled' WHERE id = $1", [migration.id])
      await recordAudit(tx, { action: 'MIGRATION.CANCELLED', objectType: 'migration', objectId: migration.id, before: { state: 'draft' }, after: { state: 'cancelled' }, reason: body.reason })
      return migrationView(tx, migration.id)
    }))
  })
}
