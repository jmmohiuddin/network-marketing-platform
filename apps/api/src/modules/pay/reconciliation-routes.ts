import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { recordAudit } from '../../lib/audit.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { NOT_RETRIED } from './instructions.js'
import { importSettlementReport } from './settlement.js'

const REPORT_MAX_BYTES = 5 * 1024 * 1024
const idParams = z.object({ id: z.uuid() })
const summaryQuery = z.strictObject({ market_id: z.uuid().optional(), provider_config_id: z.uuid().optional() })
const itemsQuery = z.strictObject({
  market_id: z.uuid().optional(), state: z.enum(['pending', 'instructed', 'accepted', 'settled', 'returned', 'failed', 'cancelled']).optional(), ...pageQuery,
})
const exceptionsQuery = z.strictObject({ state: z.enum(['open', 'resolved']).optional(), provider_config_id: z.uuid().optional(), ...pageQuery })
const resolveBody = z.strictObject({ note: z.string().trim().min(1).max(1000) })
const idCursor = z.uuid()

const amountOf = (filter: string) =>
  `jsonb_build_object('count', count(i.id) FILTER (WHERE ${filter}), 'amount_minor', (coalesce(sum(i.amount_minor) FILTER (WHERE ${filter}), 0))::text)`

/** FR-PAY-004 reconciliation (API-25): result-file import, per-provider summary, item history and the exceptions queue. */
export function registerReconciliationRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')

  void app.register(async (scope) => {
    scope.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: REPORT_MAX_BYTES }, (_request, body, done) => done(null, body))
    scope.post('/v1/payout-providers/:id/settlement-reports', { preHandler: [tenant, requirePermission('payout.reconcile')] }, async (request, reply) => {
      const { id } = parse(idParams, request.params)
      if (typeof request.body !== 'string') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the result file as text/csv.')
      const csv = request.body
      const reconcileScope = marketScope(currentAuth(request), 'payout.reconcile')
      const result = await inTenant(request, (tx) =>
        idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await importSettlementReport(tx, id, reconcileScope, csv)) })))
      return sendIdempotent(reply, result)
    })
  })

  app.get('/v1/payout-reconciliation/summary', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const query = parse(summaryQuery, request.query)
    const scope = marketScope(currentAuth(request), 'payout.read')
    const providers = await inTenant(request, async (tx) => (await tx.query(
      `SELECT c.id, c.provider, c.market_id,
              ${amountOf(`i.state IN ('pending', 'instructed', 'accepted')`)} AS in_transit,
              ${amountOf(`i.state = 'settled'`)} AS settled, ${amountOf(`i.state = 'returned'`)} AS returned,
              ${amountOf(`i.state = 'failed' AND ${NOT_RETRIED}`)} AS failed,
              (SELECT count(*)::int FROM payout_exception e WHERE e.provider_config_id = c.id AND e.state = 'open') AS open_exceptions
       FROM provider_config c
       LEFT JOIN payout_batch b ON b.provider_config_id = c.id LEFT JOIN payout_instruction i ON i.batch_id = b.id
       WHERE c.kind = 'payout' AND ($1::uuid[] IS NULL OR c.market_id = ANY ($1)) AND ($2::uuid IS NULL OR c.market_id = $2)
         AND ($3::uuid IS NULL OR c.id = $3)
       GROUP BY c.id ORDER BY c.provider, c.id`,
      [scope, query.market_id ?? null, query.provider_config_id ?? null],
    )).rows)
    return envelope({ providers })
  })

  app.get('/v1/payout-reconciliation/items', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const query = parse(itemsQuery, request.query)
    const after = decodeCursor(query.cursor, idCursor)
    const scope = marketScope(currentAuth(request), 'payout.read')
    const rows = await inTenant(request, async (tx) => (await tx.query<{ id: string }>(
      `SELECT i.id, i.batch_id, b.market_id, b.provider_config_id,
              (SELECT jsonb_build_object('id', x.id, 'external_ref', x.external_ref, 'display_name', x.display_name)
               FROM participant x WHERE x.id = i.payee_participant_id) AS participant,
              i.amount_minor::text AS amount_minor, i.currency, i.state, i.provider_ref, i.last_error,
              (SELECT jsonb_agg(e ORDER BY e ->> 'at') FROM jsonb_array_elements(jsonb_build_array(
                 jsonb_build_object('type', 'created', 'at', i.created_at, 'source', 'platform'),
                 CASE WHEN i.instructed_at IS NOT NULL THEN jsonb_build_object('type', 'instructed', 'at', i.instructed_at, 'source', 'platform') END,
                 CASE WHEN i.accepted_at IS NOT NULL THEN jsonb_build_object('type', 'accepted', 'at', i.accepted_at, 'source', 'provider') END,
                 CASE WHEN i.terminal_at IS NOT NULL THEN jsonb_build_object('type', i.state, 'at', i.terminal_at, 'source', 'provider') END)) e
               WHERE e <> 'null'::jsonb) AS events,
              (SELECT c.id FROM case_file c WHERE c.type = 'returned_payment' AND c.subject_id = i.id ORDER BY c.created_at DESC LIMIT 1) AS returned_case_id
       FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id
       WHERE ($1::uuid[] IS NULL OR b.market_id = ANY ($1)) AND ($2::uuid IS NULL OR b.market_id = $2) AND ($3::text IS NULL OR i.state = $3)
         AND ($4::uuid IS NULL OR i.id > $4)
       ORDER BY i.id LIMIT $5`,
      [scope, query.market_id ?? null, query.state ?? null, after ?? null, query.limit + 1],
    )).rows)
    return toPage(rows, query.limit, (row) => row.id)
  })

  app.get('/v1/payout-exceptions', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const query = parse(exceptionsQuery, request.query)
    const after = decodeCursor(query.cursor, idCursor)
    const scope = marketScope(currentAuth(request), 'payout.read')
    const rows = await inTenant(request, async (tx) => (await tx.query<{ id: string }>(
      `SELECT e.id, e.provider_config_id, e.kind, e.reference, e.amount_minor::text AS amount_minor, e.instruction_id, e.state, e.detail,
              e.created_at, CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('id', u.id, 'display_name', u.display_name) END AS resolved_by,
              e.resolved_at, e.resolution_note
       FROM payout_exception e JOIN provider_config c ON c.id = e.provider_config_id LEFT JOIN user_account u ON u.id = e.resolved_by
       WHERE ($1::uuid[] IS NULL OR c.market_id = ANY ($1)) AND ($2::text IS NULL OR e.state = $2) AND ($3::uuid IS NULL OR e.provider_config_id = $3)
         AND ($4::uuid IS NULL OR e.id > $4)
       ORDER BY e.id LIMIT $5`,
      [scope, query.state ?? null, query.provider_config_id ?? null, after ?? null, query.limit + 1],
    )).rows)
    return toPage(rows, query.limit, (row) => row.id)
  })

  app.post('/v1/payout-exceptions/:id/resolve', { preHandler: [tenant, requirePermission('payout.reconcile')] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const { note } = parse(resolveBody, request.body)
    const scope = marketScope(currentAuth(request), 'payout.reconcile')
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { rows } = await tx.query<{ state: string; market_id: string }>(
        `SELECT e.state, c.market_id FROM payout_exception e JOIN provider_config c ON c.id = e.provider_config_id WHERE e.id = $1 FOR UPDATE OF e`, [id])
      const row = rows[0]
      if (row === undefined || (scope !== null && !scope.includes(row.market_id))) throw notFound()
      if (row.state !== 'open') throw new ApiError(409, 'EXCEPTION_RESOLVED', 'This exception is already resolved.')
      await tx.query(
        `UPDATE payout_exception SET state = 'resolved', resolved_by = app_user_id(), resolved_at = now(), resolution_note = $2 WHERE id = $1`, [id, note])
      await recordAudit(tx, { action: 'PAYOUT.EXCEPTION_RESOLVED', objectType: 'payout_exception', objectId: id, before: { state: 'open' }, after: { state: 'resolved' }, reason: note })
      return { statusCode: 200, body: envelope({ id, state: 'resolved' }) }
    }))
    return sendIdempotent(reply, result)
  })
}
