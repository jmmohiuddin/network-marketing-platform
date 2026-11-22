import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { currentAuth, hasPermission, marketScope, requireAnyPermission, requirePermission, requireRealm, requireStepUp, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, encodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { decideWithSod } from '../ten/index.js'
import { runCreditAwards } from './awards.js'
import { commitRun, requestCommit } from './commit.js'
import { linesCsv, listLines, lineTrace, replayRun } from './lines.js'
import { trueUp } from './provisional.js'
import { positionQualification } from './qualification.js'
import { restatementDetail, restatementLines } from './restatement.js'
import { reviewRun, runTransitions } from './review.js'
import { requestRun } from './runs.js'
import { listSimulations, requestSimulation, simulationDetail, simulationPayees, simulationPayeesCsv } from './simulations.js'
import { listPeriods, periodDetail, runDetail } from './views.js'

// API-17..22 (PLAN B3 §2.3, §2.5): periods, runs, review, commit, lines, trace, replay, qualification, simulations and
// restatement reads. Scope per D-B3-23.

const id = z.object({ id: z.uuid() })
const PERIOD_STATES = ['open', 'calculating', 'calculated', 'committed', 'paid', 'closed'] as const
const periodsQuery = z.strictObject({
  ...pageQuery, calendar_id: z.uuid().optional(), state: z.enum(PERIOD_STATES).optional(), from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})
const periodCursor = z.object({ starts_at: z.string(), id: z.uuid() })
const ruleKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const linesQuery = z.strictObject({
  ...pageQuery, payee_participant_id: z.uuid().optional(), payee_position_id: z.uuid().optional(), rule_key: ruleKey.optional(),
  origin_type: z.enum(['late_transaction', 'clawback', 'manual', 'restatement', 'provisional']).optional(), format: z.enum(['json', 'csv']).default('json'),
})
const reviewQuery = z.strictObject({ compare_run_id: z.uuid().optional() })
const commitBody = z.strictObject({ acknowledged_exceptions: z.array(z.string().min(1).max(200)).max(10_000).default([]) })
const traceQuery = z.strictObject({ expand: z.enum(['true', 'false']).default('false') })
const qualificationQuery = z.strictObject({ ...pageQuery, calendar_id: z.uuid().optional() })
const qualificationCursor = z.object({ starts_at: z.string(), period_id: z.uuid() })
const simulationBody = z.strictObject({ plan_version_id: z.uuid(), period_id: z.uuid() })
const simulationsQuery = z.strictObject({ ...pageQuery, plan_version_id: z.uuid().optional() })
const payeesQuery = z.strictObject({ ...pageQuery, sort: z.enum(['delta', 'participant']).default('delta'), format: z.enum(['json', 'csv']).default('json') })
const offsetCursor = z.number().int().min(0)
const RUN_REQUEST_ID = /^[\x21-\x7e]{1,100}$/

const scopeOf = (request: FastifyRequest, permission: Permission) => marketScope(currentAuth(request), permission)
/** Each held permission's own scope, for objects spanning markets (a plan): one of them must cover all (D-B3-23). */
const scopesOf = (request: FastifyRequest, permissions: readonly Permission[]) =>
  permissions.filter((p) => hasPermission(currentAuth(request), p)).map((p) => scopeOf(request, p))
const offsetPage = <T>(rows: readonly T[], offset: number, limit: number) => {
  const data = rows.slice(0, limit)
  return envelope(data, { next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null })
}

// A refused export is committed (EXPORT.REFUSED is audited), so it is sent, not thrown.
function sendCsv(request: FastifyRequest, reply: FastifyReply, file: { refused?: { rowCount: number; rowCap: number }; csv?: string }, name: string): unknown {
  if (file.refused !== undefined) {
    return reply.code(422).send({ error: {
      code: 'EXPORT_ROW_CAP_EXCEEDED', message: 'The export is larger than the row limit. Narrow the filters.',
      details: { row_count: file.refused.rowCount, row_cap: file.refused.rowCap }, request_id: request.id,
    } })
  }
  reply.header('content-type', 'text/csv; charset=utf-8')
  reply.header('content-disposition', `attachment; filename="${name}"`)
  return reply.send(file.csv)
}

const guard = (...permissions: Permission[]) => ({ preHandler: [requireRealm('tenant'), requirePermission(...permissions)] })

export function registerPeriodRoutes(app: FastifyInstance): void {
  app.get('/v1/periods', guard('period.read'), async (request) => {
    const query = parse(periodsQuery, request.query)
    const after = decodeCursor(query.cursor, periodCursor)
    return inTenant(request, (tx) => listPeriods(tx, scopeOf(request, 'period.read'), query, after, query.limit))
  })

  app.get('/v1/periods/:id', guard('period.read'), async (request) => {
    const { id: periodId } = parse(id, request.params)
    return envelope(await inTenant(request, (tx) => periodDetail(tx, periodId, scopeOf(request, 'period.read'))))
  })

  app.post('/v1/periods/:id/runs', guard('run.execute'), async (request, reply) => {
    const { id: periodId } = parse(id, request.params)
    const header = request.headers['run-request-id']
    if (typeof header !== 'string' || !RUN_REQUEST_ID.test(header)) {
      throw new ApiError(422, 'RUN_REQUEST_ID_REQUIRED', 'Send a Run-Request-Id header (1-100 printable characters).')
    }
    const requested = await inTenant(request, (tx) => requestRun(tx, periodId, header, scopeOf(request, 'run.execute')))
    return reply.code(202).send(envelope({ run_id: requested.run_id, state: requested.state }, { replayed: requested.replayed }))
  })
}

export function registerRunRoutes(app: FastifyInstance): void {
  const readers: Permission[] = ['period.read', 'run.review']
  app.get('/v1/runs/:id', { preHandler: [requireRealm('tenant'), requireAnyPermission(...readers)] }, async (request) => {
    const { id: runId } = parse(id, request.params)
    return envelope(await inTenant(request, (tx) => runDetail(tx, runId, scopeOfAny(currentAuth(request), readers))))
  })

  app.get('/v1/runs/:id/review', guard('run.review'), async (request) => {
    const { id: runId } = parse(id, request.params)
    const query = parse(reviewQuery, request.query)
    return envelope(await inTenant(request, (tx) => reviewRun(tx, currentAuth(request), runId, query.compare_run_id, scopeOf(request, 'run.review'))))
  })

  // D-V1A-02 (AC-COMP11-7): final, advances paid and true-up per payee of a final run; payees cursor-paged.
  app.get('/v1/runs/:id/true-up', guard('run.review'), async (request) => {
    const { id: runId } = parse(id, request.params)
    const query = parse(z.strictObject(pageQuery), request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const result = await inTenant(request, (tx) => trueUp(tx, runId, scopeOf(request, 'run.review'), after, query.limit))
    const page = toPage(result.payees, query.limit, (payee) => payee.participant.id)
    return envelope({ ...result, payees: page.data }, page.meta)
  })

  // D-V1A-03: the run's credit awards (not cash) with totals per credit type.
  app.get('/v1/runs/:id/credit-awards', guard('run.review'), async (request) => {
    const { id: runId } = parse(id, request.params)
    const query = parse(z.strictObject(pageQuery), request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const { rows, totals } = await inTenant(request, (tx) => runCreditAwards(tx, runId, scopeOf(request, 'run.review'), after, query.limit))
    const page = toPage(rows, query.limit, (row) => row.id)
    return envelope(page.data, { ...page.meta, totals })
  })

  app.get('/v1/runs/:id/transitions', guard('run.review'), async (request) => {
    const { id: runId } = parse(id, request.params)
    const query = parse(z.strictObject(pageQuery), request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const rows = await inTenant(request, (tx) => runTransitions(tx, runId, scopeOf(request, 'run.review'), after, query.limit))
    return toPage(rows, query.limit, (row) => row.position_id)
  })

  app.get('/v1/runs/:id/lines', guard('run.review'), async (request, reply) => {
    const { id: runId } = parse(id, request.params)
    const { cursor, limit, format, ...filter } = parse(linesQuery, request.query)
    const scope = scopeOf(request, 'run.review')
    if (format === 'csv') return sendCsv(request, reply, await inTenant(request, (tx) => linesCsv(tx, runId, scope, filter)), `run-${runId}-lines.csv`)
    const after = decodeCursor(cursor, z.uuid())
    const rows = await inTenant(request, (tx) => listLines(tx, runId, scope, filter, after, limit))
    return toPage(rows, limit, (row) => row.id)
  })

  app.post('/v1/runs/:id/request-commit', guard('run.execute'), async (request, reply) => {
    const { id: runId } = parse(id, request.params)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 200, body: envelope(await requestCommit(tx, runId, scopeOf(request, 'run.execute'))),
    })))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/runs/:id/commit', { preHandler: [requireRealm('tenant'), requirePermission('run.commit'), requireStepUp()] }, async (request, reply) => {
    const { id: runId } = parse(id, request.params)
    const body = parse(commitBody, request.body)
    const auth = currentAuth(request)
    const result = await decideWithSod(request, async (tx) => ({
      statusCode: 200, body: envelope(await commitRun(tx, auth, runId, body.acknowledged_exceptions, marketScope(auth, 'run.commit'))),
    }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/runs/:id/replay', guard('run.execute'), async (request) => {
    const { id: runId } = parse(id, request.params)
    const outcome = await inTenant(request, (tx) => replayRun(tx, runId, scopeOf(request, 'run.execute')))
    if (outcome.corrupt) throw new ApiError(500, 'SNAPSHOT_CORRUPT', 'The stored snapshot of this run does not match its checksum.')
    return envelope(outcome.body)
  })

  app.get('/v1/result-lines/:id/trace', guard('trace.read'), async (request) => {
    const { id: lineId } = parse(id, request.params)
    const { expand } = parse(traceQuery, request.query)
    const trace = await inTenant(request, (tx) => lineTrace(tx, lineId, scopeOf(request, 'trace.read'), expand === 'true', request.log))
    if ('corrupt' in trace) throw new ApiError(500, 'SNAPSHOT_CORRUPT', 'The stored snapshot of this run does not match its checksum.')
    return envelope(trace)
  })

  app.get('/v1/positions/:id/qualification', guard('participant.read'), async (request) => {
    const { id: positionId } = parse(id, request.params)
    const query = parse(qualificationQuery, request.query)
    const after = decodeCursor(query.cursor, qualificationCursor)
    const rows = await inTenant(request, (tx) =>
      positionQualification(tx, positionId, scopeOf(request, 'participant.read'), query.calendar_id, after, query.limit))
    const page = toPage(rows, query.limit, (row) => ({ starts_at: row.cursor_starts_at.toISOString(), period_id: row.period.id }))
    return { ...page, data: page.data.map(({ cursor_starts_at: _at, ...row }) => row) }
  })
}

export function registerSimulationRoutes(app: FastifyInstance): void {
  const readers: Permission[] = ['plan.simulate', 'plan.read']
  const read = { preHandler: [requireRealm('tenant'), requireAnyPermission(...readers)] }

  app.post('/v1/simulations', guard('plan.simulate'), async (request, reply) => {
    const body = parse(simulationBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({
      statusCode: 202, body: envelope(await requestSimulation(tx, body, scopeOf(request, 'plan.simulate'))),
    })))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/simulations', read, async (request) => {
    const query = parse(simulationsQuery, request.query)
    const after = decodeCursor(query.cursor, z.uuid())
    const rows = await inTenant(request, (tx) => listSimulations(tx, scopesOf(request, readers), query.plan_version_id, after, query.limit))
    return toPage(rows, query.limit, (row) => row.id)
  })

  app.get('/v1/simulations/:id', read, async (request) => {
    const { id: simulationId } = parse(id, request.params)
    return envelope(await inTenant(request, (tx) => simulationDetail(tx, simulationId, scopesOf(request, readers))))
  })

  app.get('/v1/simulations/:id/payees', guard('plan.simulate'), async (request, reply) => {
    const { id: simulationId } = parse(id, request.params)
    const query = parse(payeesQuery, request.query)
    const scope = scopeOf(request, 'plan.simulate')
    if (query.format === 'csv') {
      return sendCsv(request, reply, await inTenant(request, (tx) => simulationPayeesCsv(tx, simulationId, scope)), `simulation-${simulationId}-payees.csv`)
    }
    const offset = decodeCursor(query.cursor, offsetCursor) ?? 0
    const rows = await inTenant(request, (tx) => simulationPayees(tx, simulationId, scope, query.sort, offset, query.limit + 1))
    return offsetPage(rows, offset, query.limit)
  })
}

export function registerRestatementRoutes(app: FastifyInstance): void {
  app.get('/v1/restatements/:id', guard('case.restatement.read'), async (request) => {
    const { id: restatementId } = parse(id, request.params)
    return envelope(await inTenant(request, (tx) => restatementDetail(tx, restatementId, scopeOf(request, 'case.restatement.read'))))
  })

  app.get('/v1/restatements/:id/lines', guard('case.restatement.read'), async (request) => {
    const { id: restatementId } = parse(id, request.params)
    const query = parse(z.strictObject(pageQuery), request.query)
    const offset = decodeCursor(query.cursor, offsetCursor) ?? 0
    const rows = await inTenant(request, (tx) => restatementLines(tx, restatementId, scopeOf(request, 'case.restatement.read'), offset, query.limit))
    return offsetPage(rows, offset, query.limit)
  })
}
