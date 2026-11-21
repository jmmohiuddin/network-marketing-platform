import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, requireAllMarkets, requireAnyPermission, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type StoredResponse } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery } from '../../lib/pagination.js'
import { releaseHeld } from '../ord/index.js'
import { approveOrRefuse, decideWithSod, minorUnitOf } from '../ten/index.js'
import { timeCursor, timePage } from './routes.js'

// FR-FIN-007 rates (PLAN V1-A 2.2, D-V1A-04): staff propose a batch of 1..500 effective-dated rates, another person
// approves it (step-up) and only then the immutable rates exist. Rates are tenant data: nothing here, or anywhere in
// the API, fetches a rate from outside (no-network test).

/** D-V1A-10: rows per batch. */
export const FX_BATCH_ROWS_MAX = 500

const rowSchema = z.strictObject({
  base: z.string().regex(/^[A-Z]{3}$/),
  quote: z.string().regex(/^[A-Z]{3}$/),
  rate: z.string().regex(/^\d{1,10}\.\d{10}$/, 'a decimal with exactly 10 fractional digits').refine((rate) => /[1-9]/.test(rate), 'must be above zero'),
  valid_from: z.iso.datetime({ offset: true }).refine((value) => !/\.\d{4,}/.test(value), 'at most millisecond precision'),
}).refine((row) => row.base !== row.quote, { message: 'base and quote differ', path: ['quote'] })
const batchBody = z.strictObject({ source: z.string().trim().min(1).max(200), rows: z.array(z.unknown()).min(1).max(FX_BATCH_ROWS_MAX) })
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), note: z.string().trim().min(1).max(500).optional() })
const batchesQuery = z.strictObject({ ...pageQuery, state: z.enum(['proposed', 'approved', 'rejected']).optional() })
const ratesQuery = z.strictObject({
  ...pageQuery, base: z.string().regex(/^[A-Z]{3}$/).optional(), quote: z.string().regex(/^[A-Z]{3}$/).optional(),
  at: z.iso.datetime({ offset: true }).optional(),
})
const idParams = z.object({ id: z.uuid() })

type Row = z.infer<typeof rowSchema>
const userJson = (alias: string) => `jsonb_build_object('id', ${alias}.id, 'name', coalesce(${alias}.display_name, ${alias}.email))`
const BATCH_SELECT = `
  SELECT b.id, b.source, b.rows, b.state, ${userJson('u')} AS proposed_by, b.proposed_at, b.decided_at,
         (SELECT ${userJson('v')} FROM approval a JOIN user_account v ON v.id = a.approver_id WHERE a.id = b.approval_id) AS approver,
         b.proposed_at::text AS at
  FROM fx_rate_batch b JOIN user_account u ON u.id = b.proposed_by`

async function batchView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query(`${BATCH_SELECT} WHERE b.id = $1`, [id])
  const { at: _at, ...batch } = rows[0]!
  return batch
}

/** Each row valid (422 VALIDATION_FAILED {row, field}), of ISO 4217 currencies (422 CURRENCY_UNKNOWN {row}), once. */
function validRows(raw: readonly unknown[]): Row[] {
  const rows = raw.map((value, row) => {
    const parsed = rowSchema.safeParse(value)
    if (!parsed.success) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'A rate row is not valid.', { row, field: parsed.error.issues[0]!.path.join('.') || null })
    }
    if (minorUnitOf(parsed.data.base) === undefined || minorUnitOf(parsed.data.quote) === undefined) {
      throw new ApiError(422, 'CURRENCY_UNKNOWN', 'A rate row names a currency that is not an active ISO 4217 currency.', { row })
    }
    return { ...parsed.data, valid_from: new Date(parsed.data.valid_from).toISOString() }
  })
  const keys = rows.map((r) => `${r.base}:${r.quote}:${r.valid_from}`)
  const repeated = keys.findIndex((key, index) => keys.indexOf(key) !== index)
  if (repeated >= 0) throw new ApiError(422, 'VALIDATION_FAILED', 'A pair and validity start appear twice.', { row: repeated, field: 'valid_from' })
  return rows
}

/** 409 RATE_EXISTS {row} for the first row whose (base, quote, valid_from) already has a rate. */
async function assertNoRate(tx: Tx, rows: readonly Row[]): Promise<void> {
  const { rows: taken } = await tx.query<{ row: number }>(
    `SELECT (r.n - 1)::int AS row FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS r (v, n)
     JOIN fx_rate f ON f.base = r.v ->> 'base' AND f.quote = r.v ->> 'quote' AND f.valid_from = (r.v ->> 'valid_from')::timestamptz
     ORDER BY r.n LIMIT 1`,
    [JSON.stringify(rows)],
  )
  if (taken[0] !== undefined) throw new ApiError(409, 'RATE_EXISTS', 'A rate for this pair and validity start exists already.', { row: taken[0].row })
}

async function propose(tx: Tx, body: z.infer<typeof batchBody>): Promise<StoredResponse> {
  const rows = validRows(body.rows)
  await assertNoRate(tx, rows)
  const { rows: created } = await tx.query<{ id: string }>(
    'INSERT INTO fx_rate_batch (tenant_id, source, rows) VALUES (app_tenant_id(), $1, $2) RETURNING id', [body.source, JSON.stringify(rows)],
  )
  const id = created[0]!.id
  await recordAudit(tx, { action: 'FX_RATES.PROPOSED', objectType: 'fx_rate_batch', objectId: id, after: { rows: rows.length } })
  return { statusCode: 201, body: envelope(await batchView(tx, id)) }
}

async function decide(tx: Tx, request: FastifyRequest, id: string, body: z.infer<typeof decisionBody>, toleranceSeconds: number): Promise<StoredResponse> {
  const { rows } = await tx.query<{ state: string; proposed_by: string; rows: Row[] }>(
    'SELECT state, proposed_by, rows FROM fx_rate_batch WHERE id = $1 FOR UPDATE', [id],
  )
  const batch = rows[0]
  if (batch === undefined) throw notFound()
  if (batch.state !== 'proposed') throw new ApiError(409, 'BATCH_DECIDED', 'This batch was decided already.', { state: batch.state })
  const decision = body.decision === 'approve' ? 'approved' : 'rejected'
  const { approvalId } = await approveOrRefuse(tx, {
    objectType: 'fx_rate_batch', objectId: id, preparerId: batch.proposed_by, contributorIds: [], excludedIds: [], decision,
    reason: body.note ?? null, factorVerifiedAt: currentAuth(request).stepUpAt, approverPermission: 'fx.approve', marketId: null, allMarkets: true,
  })
  await tx.query('UPDATE fx_rate_batch SET state = $2, approval_id = $3, decided_at = now() WHERE id = $1', [id, decision, approvalId])
  let released = 0
  if (decision === 'approved') {
    await assertNoRate(tx, batch.rows)
    await tx.query(
      `INSERT INTO fx_rate (tenant_id, batch_id, base, quote, rate, source, valid_from)
       SELECT app_tenant_id(), b.id, r ->> 'base', r ->> 'quote', (r ->> 'rate')::numeric, b.source, (r ->> 'valid_from')::timestamptz
       FROM fx_rate_batch b CROSS JOIN LATERAL jsonb_array_elements(b.rows) r WHERE b.id = $1`,
      [id],
    )
    // Before this transaction audits (the release waits on order locks): orders held for these pairs convert now.
    const pairs = [...new Set(batch.rows.map((row) => `${row.base}:${row.quote}`))]
    released = await releaseHeld(tx, ['FX_RATE_MISSING', 'FX_RATE_STALE'], pairs, { requestId: request.id, toleranceSeconds })
  }
  await recordAudit(tx, {
    action: decision === 'approved' ? 'FX_RATES.APPROVED' : 'FX_RATES.REJECTED', objectType: 'fx_rate_batch', objectId: id,
    after: { approval_id: approvalId, released_orders: released },
  })
  return { statusCode: 200, body: envelope({ ...(await batchView(tx, id)), released_orders: released }) }
}

export function registerFxRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')

  app.get('/v1/fx-rates', { preHandler: [tenant, requireAnyPermission('ledger.read', 'fx.manage', 'fx.approve')] }, async (request) => {
    const query = parse(ratesQuery, request.query)
    const after = decodeCursor(query.cursor, timeCursor)
    const { rows } = await inTenant(request, (tx) => tx.query<{ at: string; id: string }>(
      `SELECT f.id, f.base, f.quote, f.rate::text AS rate, f.source, f.valid_from, f.batch_id,
              coalesce(f.id = (SELECT n.id FROM fx_rate_at(f.base, f.quote, coalesce($3::timestamptz, now())) n), false) AS in_force, f.created_at::text AS at
       FROM fx_rate f
       WHERE ($1::text IS NULL OR f.base = $1) AND ($2::text IS NULL OR f.quote = $2)
         AND ($4::timestamptz IS NULL OR (f.created_at, f.id) < ($4, $5::uuid))
       ORDER BY f.created_at DESC, f.id DESC LIMIT $6`,
      [query.base ?? null, query.quote ?? null, query.at ?? null, after?.at ?? null, after?.id ?? null, query.limit + 1],
    ))
    return timePage(rows, query.limit)
  })

  app.get('/v1/fx-rate-batches', { preHandler: [tenant, requireAnyPermission('fx.manage', 'fx.approve')] }, async (request) => {
    const query = parse(batchesQuery, request.query)
    const after = decodeCursor(query.cursor, timeCursor)
    const { rows } = await inTenant(request, (tx) => tx.query<{ at: string; id: string }>(
      `${BATCH_SELECT} WHERE ($1::text IS NULL OR b.state = $1) AND ($2::timestamptz IS NULL OR (b.proposed_at, b.id) < ($2, $3::uuid))
       ORDER BY b.proposed_at DESC, b.id DESC LIMIT $4`,
      [query.state ?? null, after?.at ?? null, after?.id ?? null, query.limit + 1],
    ))
    return timePage(rows, query.limit)
  })

  const manage = { preHandler: [tenant, requirePermission('fx.manage'), requireAllMarkets('fx.manage')] }
  app.post('/v1/fx-rate-batches', manage, async (request, reply) => {
    const body = parse(batchBody, request.body)
    return sendIdempotent(reply, await inTenant(request, (tx) => idempotent(tx, request, () => propose(tx, body))))
  })

  const approve = { preHandler: [tenant, requirePermission('fx.approve'), requireAllMarkets('fx.approve'), requireStepUp()] }
  app.post('/v1/fx-rate-batches/:id/decision', approve, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(decisionBody, request.body)
    const result = await decideWithSod(request, (tx) => decide(tx, request, id, body, app.config.orderFutureToleranceSeconds))
    return sendIdempotent(reply, result)
  })
}
