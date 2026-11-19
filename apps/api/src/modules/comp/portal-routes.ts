import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertPortalActive, currentAuth, requirePortal } from '../../lib/auth.js'
import { inPortal } from '../../lib/db.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, encodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { disputeDetail, disputeMessage, listDisputes, openDispute } from './disputes.js'
import { rankStatus } from './rank.js'
import { lineExplanation, listStatements, statementCsv, statementDetail } from './statements.js'

// PLAN B5 section 2.2 (API-28/29/30, portal): statements, line explanations, rank status and disputes of the session
// participant. Another participant's object, or another tenant's, is 404.

const STATEMENTS_PAGE = 24
const RANK_PAGE = 12

const id = z.object({ id: z.uuid() })
const runId = z.object({ runId: z.uuid() })
const statementsQuery = z.strictObject({
  cursor: pageQuery.cursor, limit: z.coerce.number().int().min(1).max(STATEMENTS_PAGE).default(12), market_id: z.uuid().optional(),
})
const statementCursor = z.object({ starts_at: z.iso.datetime(), run_id: z.uuid() })
const rankQuery = z.strictObject({
  cursor: pageQuery.cursor, limit: z.coerce.number().int().min(1).max(RANK_PAGE).default(RANK_PAGE), position_id: z.uuid().optional(),
})
const rankCursor = z.object({ starts_at: z.iso.datetime(), period_id: z.uuid() })
const disputeBody = z.strictObject({ line_id: z.uuid(), message: disputeMessage })
const disputesQuery = z.strictObject(pageQuery)

const portal = { preHandler: [requirePortal()] }

/** inPortal with the session's participant (requirePortal has checked the realm and inPortal its participant). */
function asParticipant<T>(request: FastifyRequest, fn: (tx: Tx, participantId: string) => Promise<T>): Promise<T> {
  return inPortal(request, (tx) => fn(tx, currentAuth(request).participantId!))
}

export function registerPortalRoutes(app: FastifyInstance): void {
  app.get('/v1/me/statements', portal, async (request) => {
    const query = parse(statementsQuery, request.query)
    const after = decodeCursor(query.cursor, statementCursor)
    const rows = await asParticipant(request, (tx, participant) => listStatements(tx, participant, query.market_id, after, query.limit))
    return toPage(rows, query.limit, (row) => ({ starts_at: row.period.starts_at.toISOString(), run_id: row.run_id }))
  })

  app.get('/v1/me/statements/:runId', portal, async (request) => {
    const params = parse(runId, request.params)
    return envelope(await asParticipant(request, (tx, participant) => statementDetail(tx, participant, params.runId, request.log)))
  })

  app.get('/v1/me/statements/:runId/download', portal, async (request, reply) => {
    const params = parse(runId, request.params)
    const file = await asParticipant(request, (tx, participant) => statementCsv(tx, participant, params.runId, request.log))
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="${file.name}"`)
    reply.header('cache-control', 'no-store')
    return reply.send(file.csv)
  })

  app.get('/v1/me/statement-lines/:id/explanation', portal, async (request) => {
    const params = parse(id, request.params)
    return envelope(await asParticipant(request, (tx, participant) => lineExplanation(tx, participant, params.id, request.log)))
  })

  app.get('/v1/me/rank', portal, async (request) => {
    assertPortalActive(currentAuth(request))
    const query = parse(rankQuery, request.query)
    const after = decodeCursor(query.cursor, rankCursor)
    const status = await asParticipant(request, (tx, participant) => rankStatus(tx, participant, query.position_id, after, query.limit))
    return envelope(status.data, { next_cursor: status.next === null ? null : encodeCursor(status.next) })
  })

  app.post('/v1/me/disputes', portal, async (request, reply) => {
    assertPortalActive(currentAuth(request))
    const body = parse(disputeBody, request.body)
    const result = await asParticipant(request, (tx, participant) => idempotent(tx, request, async () => ({
      statusCode: 201, body: envelope(await openDispute(tx, participant, body.line_id, body.message)),
    })))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/me/disputes', portal, async (request) => {
    const query = parse(disputesQuery, request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const rows = await asParticipant(request, (tx, participant) => listDisputes(tx, participant, { after }, query.limit))
    return toPage(rows, query.limit, (row) => row.case_id)
  })

  app.get('/v1/me/disputes/:id', portal, async (request) => {
    const params = parse(id, request.params)
    return envelope(await asParticipant(request, (tx, participant) => disputeDetail(tx, participant, params.id)))
  })
}
