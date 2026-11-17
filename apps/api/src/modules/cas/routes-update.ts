import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentAuth, hasPermission, marketScope, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, permissionDenied } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { countCases, recordChange, updateCase } from './cases.js'
import { assertHolds, caseId, parsePayload, readableCase, stateConflict } from './routes.js'
import type { CaseTypeRegistry } from './types.js'

const patchBody = z
  .strictObject({ reason_code: z.string().min(1).max(100).optional(), payload: z.unknown().optional() })
  .refine((body) => body.reason_code !== undefined || body.payload !== undefined, 'send reason_code or payload')
const countsQuery = z.strictObject({ type: z.string().min(1).max(50).optional() })

/** PATCH /v1/cases/:id and GET /v1/cases/counts (PLAN B2 section 2.4). */
export function registerCaseUpdates(app: FastifyInstance, registry: CaseTypeRegistry): void {
  // The preparer completes an open case (e.g. the proposed outcome of a duplicate review) before submitting it.
  app.patch('/v1/cases/:id', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    const body = parse(patchBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      const { record, definition } = await readableCase(tx, registry, auth, id, true)
      assertHolds(auth, definition.permissions.create, record)
      if (record.state !== 'open') throw stateConflict(record.state)
      const reasonCode = body.reason_code ?? record.reason_code
      if (!definition.reasonCodes.includes(reasonCode)) {
        throw new ApiError(422, 'REASON_CODE_INVALID', 'Choose a reason code of this case type.', { reason_codes: definition.reasonCodes })
      }
      const payload = parsePayload(definition, body.payload ?? record.payload)
      await definition.validateCreate?.(tx, { type: record.subject_type, id: record.subject_id }, payload, marketScope(auth, definition.permissions.create))
      const updated = await updateCase(tx, record.id, reasonCode, payload)
      const fields = Object.keys(body)
      await recordChange(tx, record.id, 'updated', { fields }, {
        before: { reason_code: record.reason_code, payload: record.payload }, after: { reason_code: reasonCode, payload, fields },
      })
      return updated
    }))
  })

  app.get('/v1/cases/counts', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const auth = currentAuth(request)
    const { type } = parse(countsQuery, request.query)
    const readable = [...registry.values()]
      .filter((definition) => hasPermission(auth, definition.permissions.read) && (type === undefined || definition.type === type))
      .map((definition) => ({ type: definition.type, markets: marketScope(auth, definition.permissions.read) }))
    if (readable.length === 0) throw permissionDenied()
    return envelope(await inTenant(request, (tx) => countCases(tx, readable)))
  })
}
