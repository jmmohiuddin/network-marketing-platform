import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm, requireStepUp, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { decideWithSod } from '../ten/index.js'
import { generateBankFile } from './bank-file.js'
import {
  approveBatch, batchDetail, cancelBatch, findBatch, listBatches, prepareBatch, retryFailed, submitBatch,
} from './batches.js'

const idParams = z.object({ id: z.uuid() })
const STATES = ['draft', 'reviewed', 'approved', 'instructing', 'partially_settled', 'settled', 'failed', 'cancelled'] as const
const INSTRUCTION_STATES = ['pending', 'instructed', 'accepted', 'settled', 'returned', 'failed', 'cancelled'] as const
const listQuery = z.strictObject({ market_id: z.uuid().optional(), state: z.enum(STATES).optional(), ...pageQuery })
const createBody = z.strictObject({ market_id: z.uuid(), provider_config_id: z.uuid() })
const cancelBody = z.strictObject({ reason: z.string().trim().min(1).max(500) })
const linesQuery = z.strictObject({ ...pageQuery })
const instructionsQuery = z.strictObject({ state: z.enum(INSTRUCTION_STATES).optional(), ...pageQuery })
const listCursor = z.tuple([z.string(), z.uuid()])
const idCursor = z.uuid()

const participant = (column: string) =>
  `(SELECT jsonb_build_object('id', x.id, 'external_ref', x.external_ref, 'display_name', x.display_name) FROM participant x WHERE x.id = ${column})`

/** FR-PAY-001 batches (API-25). Batch lines and instructions show masked bank data only (D-B4-23). */
export function registerBatchRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')
  const readScope = (request: Parameters<typeof currentAuth>[0]) => marketScope(currentAuth(request), 'payout.read')

  app.post('/v1/payout-batches', { preHandler: [tenant, requirePermission('payout.prepare')] }, async (request, reply) => {
    const body = parse(createBody, request.body)
    const scope = marketScope(currentAuth(request), 'payout.prepare')
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await prepareBatch(tx, scope, body)) })))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/payout-batches', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const query = parse(listQuery, request.query)
    const after = decodeCursor(query.cursor, listCursor)
    const rows = await inTenant(request, (tx) => listBatches(tx, readScope(request), query, after, query.limit))
    return toPage(rows, query.limit, (row) => [(row.created_at as Date).toISOString(), row.id])
  })

  app.get('/v1/payout-batches/:id', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, (tx) => batchDetail(tx, id, readScope(request))))
  })

  app.get('/v1/payout-batches/:id/lines', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const query = parse(linesQuery, request.query)
    const after = decodeCursor(query.cursor, idCursor)
    const rows = await inTenant(request, async (tx) => {
      await findBatch(tx, id, readScope(request))
      const { rows: lines } = await tx.query<{ participant_id: string }>(
        `SELECT l.participant_id, ${participant('l.participant_id')} AS participant, l.amount_minor::text AS amount_minor,
                jsonb_build_object('id', v.id, 'masked', v.masked) AS bank_detail
         FROM payout_batch_line l JOIN bank_detail_version v ON v.id = l.bank_detail_version_id
         WHERE l.batch_id = $1 AND ($2::uuid IS NULL OR l.participant_id > $2) ORDER BY l.participant_id LIMIT $3`,
        [id, after ?? null, query.limit + 1],
      )
      return lines
    })
    const page = toPage(rows, query.limit, (row) => row.participant_id)
    return { ...page, data: page.data.map(({ participant_id: _id, ...rest }) => rest) }
  })

  app.get('/v1/payout-batches/:id/instructions', { preHandler: [tenant, requirePermission('payout.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const query = parse(instructionsQuery, request.query)
    const after = decodeCursor(query.cursor, idCursor)
    const rows = await inTenant(request, async (tx) => {
      await findBatch(tx, id, readScope(request))
      const { rows: instructions } = await tx.query<{ id: string }>(
        `SELECT i.id, ${participant('i.payee_participant_id')} AS participant, i.amount_minor::text AS amount_minor, i.state, i.provider_ref,
                i.attempts, i.last_error, i.next_attempt_at, v.masked AS bank_detail_masked, i.retry_of,
                greatest(i.created_at, i.instructed_at, i.accepted_at, i.terminal_at) AS updated_at
         FROM payout_instruction i JOIN bank_detail_version v ON v.id = i.bank_detail_version_id
         WHERE i.batch_id = $1 AND ($2::text IS NULL OR i.state = $2) AND ($3::uuid IS NULL OR i.id > $3) ORDER BY i.id LIMIT $4`,
        [id, query.state ?? null, after ?? null, query.limit + 1],
      )
      return instructions
    })
    return toPage(rows, query.limit, (row) => row.id)
  })

  app.post('/v1/payout-batches/:id/submit', { preHandler: [tenant, requirePermission('payout.prepare')] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'payout.prepare')
    const result = await inTenant(request, (tx) => idempotent(tx, request, () => submitBatch(tx, request, id, scope)))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/payout-batches/:id/approve', { preHandler: [tenant, requirePermission('payout.approve'), requireStepUp()] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const auth = currentAuth(request)
    const result = await decideWithSod(request, (tx) => approveBatch(tx, request, auth, id, marketScope(auth, 'payout.approve')))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/payout-batches/:id/retry-failed', { preHandler: [tenant, requirePermission('payout.approve'), requireStepUp()] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const auth = currentAuth(request)
    const result = await decideWithSod(request, (tx) => retryFailed(tx, request, auth, id, marketScope(auth, 'payout.approve')))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/payout-batches/:id/cancel', { preHandler: [tenant, requireAnyPermission('payout.prepare', 'payout.approve')] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const { reason } = parse(cancelBody, request.body)
    const scope = scopeOfAny(currentAuth(request), ['payout.prepare', 'payout.approve'])
    const result = await inTenant(request, (tx) =>
      idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await cancelBatch(tx, id, scope, reason)) })))
    return sendIdempotent(reply, result)
  })

  // AC-PAY2-2: the file holds decrypted account details; regenerated on every call, never stored, never logged.
  app.post('/v1/payout-batches/:id/bank-file', { preHandler: [tenant, requirePermission('payout.prepare'), requireStepUp()] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'payout.prepare')
    const csv = await inTenant(request, (tx) => generateBankFile(tx, app.config.secretKey, id, scope))
    reply.header('cache-control', 'no-store')
    reply.header('content-disposition', `attachment; filename="payouts-${id}.csv"`)
    reply.type('text/csv; charset=utf-8')
    return csv
  })
}
