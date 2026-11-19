import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, hasPermission, marketScope, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { countCases, recordChange, updateCase } from './cases.js'
import { assertHolds, assertReasonCode, caseId, caseView, parsePayload, readableCase, stateConflict } from './routes.js'
import type { CaseTypeRegistry } from './types.js'

const patchBody = z
  .strictObject({ reason_code: z.string().min(1).max(100).optional(), payload: z.unknown().optional() })
  .refine((body) => body.reason_code !== undefined || body.payload !== undefined, 'send reason_code or payload')
const countsQuery = z.strictObject({ type: z.string().min(1).max(50).optional() })

/** PATCH /v1/cases/:id and GET /v1/cases/counts (PLAN B2 section 2.4). */
export function registerCaseUpdates(app: FastifyInstance, registry: CaseTypeRegistry): void {
  // The preparer completes an open case (e.g. the proposed outcome of a duplicate review) before submitting it: its
  // opener or assignee; a case the system opened has no opener, so any holder of the type's create permission.
  app.patch('/v1/cases/:id', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    const body = parse(patchBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      const { record, definition } = await readableCase(tx, registry, auth, id, true)
      assertHolds(auth, definition.permissions.create, record)
      if (record.opened_by !== null && auth.userId !== record.opened_by && auth.userId !== record.assigned_to) throw permissionDenied()
      if (record.state !== 'open') throw stateConflict(record.state)
      const reasonCode = body.reason_code ?? record.reason_code
      assertReasonCode(definition, reasonCode, record)
      const payload = parsePayload(definition, body.payload ?? record.payload)
      const scope = marketScope(auth, definition.permissions.create)
      await definition.validateCreate?.(tx, { type: record.subject_type, id: record.subject_id }, payload, scope, record)
      const updated = await updateCase(tx, record.id, reasonCode, payload)
      const fields = Object.keys(body)
      await recordChange(tx, record.id, 'updated', { fields }, {
        before: { reason_code: record.reason_code, payload: record.payload }, after: { reason_code: reasonCode, payload, fields },
      })
      return caseView(tx, registry, updated)
    }))
  })

  app.get('/v1/cases/counts', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const auth = currentAuth(request)
    const { type } = parse(countsQuery, request.query)
    const readable = [...registry.values()]
      .filter((definition) => hasPermission(auth, definition.permissions.read) && (type === undefined || definition.type === type))
      .map((definition) => ({ type: definition.type, markets: marketScope(auth, definition.permissions.read), related: definition.relatedMarketSql }))
    if (readable.length === 0) throw permissionDenied()
    return envelope(await inTenant(request, (tx) => countCases(tx, readable)))
  })
}
