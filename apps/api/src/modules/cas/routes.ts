import { eligibleApprovers, recordApproval, type Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { assertStepUp, currentAuth, hasPermission, marketScope, requireRealm, type AuthContext } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound, permissionDenied, validationFailed } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type StoredResponse } from '../../lib/idempotency.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import type { Permission } from '../../lib/permissions.js'
import { holdsFor } from './access.js'
import {
  caseEvents, caseEvidence, contributors, getCase, hasEvidence, insertCase, insertEvidence, listCases, markDecided,
  markSubmitted, markWithdrawn, preparerOf, recordChange, setAssignee,
} from './cases.js'
import { registerCaseUpdates } from './routes-update.js'
import { caseTypeOf, type CaseRecord, type CaseTypeDefinition, type CaseTypeRegistry } from './types.js'

const NOTE = z.string().trim().min(1).max(2000)
const REASON = z.string().trim().min(1).max(500)
const STATES = ['open', 'submitted', 'approved', 'rejected', 'withdrawn'] as const

const createBody = z.strictObject({
  type: z.string().min(1).max(50),
  subject_type: z.string().min(1).max(100),
  subject_id: z.uuid(),
  reason_code: z.string().min(1).max(100),
  payload: z.unknown(),
  note: NOTE.optional(),
})
const listQuery = z.object({
  type: z.string().min(1).max(50).optional(),
  state: z.enum(STATES).optional(),
  subject_type: z.string().min(1).max(100).optional(),
  subject_id: z.uuid().optional(),
  assigned_to: z.uuid().optional(),
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  ...pageQuery,
})
const idParams = z.object({ id: z.uuid() })
const evidenceBody = z.strictObject({ document_id: z.uuid(), note: NOTE.optional() })
const assignBody = z.strictObject({ user_id: z.uuid().nullable() })
const emptyBody = z.strictObject({})
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']), reason: REASON })
const withdrawBody = z.strictObject({ reason: REASON })

export interface Loaded {
  readonly record: CaseRecord
  readonly definition: CaseTypeDefinition
}

export const caseId = (request: FastifyRequest): string => parse(idParams, request.params).id

export const stateConflict = (state: string): ApiError =>
  new ApiError(409, 'CASE_STATE_CONFLICT', `The case is ${state}: this action is not possible now.`, { state })

/** The case if the caller may read it (registered type, read permission over its market); anything else is 404. */
export async function readableCase(tx: Tx, registry: CaseTypeRegistry, auth: AuthContext, id: string, lock: boolean): Promise<Loaded> {
  const record = await getCase(tx, id, lock)
  const definition = record === null ? undefined : caseTypeOf(registry, record.type)
  if (record === null || definition === undefined || !holdsFor(auth, definition.permissions.read, record.market_id)) {
    throw notFound()
  }
  return { record, definition }
}

export function assertHolds(auth: AuthContext, permission: Permission, record: CaseRecord): void {
  if (!holdsFor(auth, permission, record.market_id)) throw permissionDenied()
}

async function detail(tx: Tx, { record, definition }: Loaded) {
  const preparer = preparerOf(record)
  const approvers = record.state === 'submitted'
    ? await eligibleApprovers(tx, {
      permission: definition.permissions.decide,
      marketId: record.market_id,
      excludeUserIds: [...(preparer === null ? [] : [preparer]), ...(await contributors(tx, record))],
    })
    : null
  return { ...record, evidence: await caseEvidence(tx, record.id), events: await caseEvents(tx, record.id), eligible_approvers: approvers }
}

/** The type's payload schema; a failure is 422 like the type's other checks (PLAN B1 section 2.9). */
export function parsePayload(definition: CaseTypeDefinition, payload: unknown): unknown {
  const result = definition.payload.safeParse(payload)
  if (result.success) return result.data
  const { code, message, details } = validationFailed(result.error)
  throw new ApiError(422, code, message, details)
}

function registerOpen(app: FastifyInstance, registry: CaseTypeRegistry): void {
  app.post('/v1/cases', { preHandler: [requireRealm('tenant')] }, async (request, reply) => {
    const auth = currentAuth(request)
    const body = parse(createBody, request.body)
    // Only a caller who may open some case type learns which types are enabled.
    if (![...registry.values()].some((definition) => hasPermission(auth, definition.permissions.create))) throw permissionDenied()
    const definition = caseTypeOf(registry, body.type)
    if (definition === undefined) {
      throw new ApiError(422, 'CASE_TYPE_NOT_ENABLED', 'Cases of this type cannot be opened.', { type: body.type })
    }
    const create = definition.permissions.create
    if (!hasPermission(auth, create)) throw permissionDenied()
    if (!definition.reasonCodes.includes(body.reason_code)) {
      throw new ApiError(422, 'REASON_CODE_INVALID', 'Choose a reason code of this case type.', { reason_codes: definition.reasonCodes })
    }
    const payload = parsePayload(definition, body.payload)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const subject = definition.subjectTypes.includes(body.subject_type)
        ? await definition.resolveSubject(tx, body.subject_type, body.subject_id)
        : null
      if (subject === null || !holdsFor(auth, create, subject.marketId)) {
        throw new ApiError(422, 'SUBJECT_NOT_FOUND', 'The subject of the case does not exist.')
      }
      await definition.validateCreate?.(tx, { type: body.subject_type, id: body.subject_id }, payload, marketScope(auth, create))
      const opened = await insertCase(tx, {
        type: definition.type, subjectType: body.subject_type, subjectId: body.subject_id, reasonCode: body.reason_code,
        payload, marketId: subject.marketId,
      })
      await recordChange(tx, opened.id, 'opened', body.note === undefined ? null : { note: body.note }, {
        after: { type: opened.type, subject_type: opened.subject_type, subject_id: opened.subject_id, reason_code: opened.reason_code },
      })
      return { statusCode: 201, body: envelope(opened) }
    }))
    return sendIdempotent(reply, result)
  })
}

function registerReads(app: FastifyInstance, registry: CaseTypeRegistry): void {
  app.get('/v1/cases', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const auth = currentAuth(request)
    const { cursor, limit, ...filter } = parse(listQuery, request.query)
    const readable = [...registry.values()]
      .filter((definition) => hasPermission(auth, definition.permissions.read))
      .map((definition) => ({ type: definition.type, markets: marketScope(auth, definition.permissions.read) }))
    if (readable.length === 0) throw permissionDenied()
    const after = decodeCursor(cursor, z.uuid())
    const rows = await inTenant(request, (tx) => listCases(tx, filter, readable, after, limit))
    return toPage(rows, limit, (row) => row.id)
  })

  app.get('/v1/cases/:id', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    return envelope(await inTenant(request, async (tx) => detail(tx, await readableCase(tx, registry, auth, id, false))))
  })
}

async function addEvidence(tx: Tx, record: CaseRecord, body: z.infer<typeof evidenceBody>): Promise<StoredResponse> {
  if (record.state !== 'open') throw stateConflict(record.state)
  if (await hasEvidence(tx, record.id, body.document_id)) {
    throw new ApiError(409, 'EVIDENCE_DUPLICATE', 'This document is already evidence of the case.')
  }
  try {
    const evidence = await insertEvidence(tx, record.id, body.document_id, body.note ?? null)
    await recordChange(tx, record.id, 'evidence_added', { document_id: body.document_id }, { after: { document_id: body.document_id } })
    return { statusCode: 201, body: envelope(evidence) }
  } catch (error) {
    // assert_document_referenceable (D-B1-04): unknown, someone else's, not evidence or already referenced.
    if ((error as { code?: unknown }).code === 'P0002') {
      throw new ApiError(422, 'DOCUMENT_NOT_FOUND', 'Upload the document yourself, then attach it.')
    }
    throw error
  }
}

async function assignableUser(tx: Tx, definition: CaseTypeDefinition, record: CaseRecord, userId: string): Promise<boolean> {
  for (const permission of [definition.permissions.decide, definition.permissions.create]) {
    const users = await eligibleApprovers(tx, { permission, marketId: record.market_id, excludeUserIds: [] })
    if (users.some((user) => user.user_id === userId)) return true
  }
  return false
}

function registerPreparation(app: FastifyInstance, registry: CaseTypeRegistry): void {
  app.post('/v1/cases/:id/evidence', { preHandler: [requireRealm('tenant')] }, async (request, reply) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    const body = parse(evidenceBody, request.body)
    const result = await inTenant(request, async (tx) => {
      const { record, definition } = await readableCase(tx, registry, auth, id, true)
      assertHolds(auth, definition.permissions.create, record)
      return idempotent(tx, request, () => addEvidence(tx, record, body))
    })
    return sendIdempotent(reply, result)
  })

  app.post('/v1/cases/:id/assign', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    const body = parse(assignBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      const { record, definition } = await readableCase(tx, registry, auth, id, true)
      assertHolds(auth, definition.permissions.decide, record)
      if (record.state !== 'open' && record.state !== 'submitted') throw stateConflict(record.state)
      if (body.user_id !== null && !(await assignableUser(tx, definition, record, body.user_id))) {
        throw new ApiError(422, 'ASSIGNEE_NOT_ELIGIBLE', 'Assign the case to someone who can prepare or decide it.')
      }
      const assigned = await setAssignee(tx, record.id, body.user_id)
      await recordChange(tx, record.id, 'assigned', { user_id: body.user_id }, {
        before: { assigned_to: record.assigned_to }, after: { assigned_to: body.user_id },
      })
      return assigned
    }))
  })

  app.post('/v1/cases/:id/submit', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    parse(emptyBody, request.body ?? {})
    return envelope(await inTenant(request, async (tx) => {
      const { record, definition } = await readableCase(tx, registry, auth, id, true)
      assertHolds(auth, definition.permissions.create, record)
      if (record.state !== 'open') throw stateConflict(record.state)
      if (definition.evidenceRequired && !(await hasEvidence(tx, record.id))) {
        throw new ApiError(422, 'EVIDENCE_REQUIRED', 'Attach evidence before submitting this case.')
      }
      const preview = definition.effectPreview === undefined ? null : await definition.effectPreview(tx, record)
      const dueAt = definition.dueAt === undefined ? null : await definition.dueAt(tx, record)
      const submitted = await markSubmitted(tx, record.id, preview, dueAt)
      await recordChange(tx, record.id, 'submitted', null, { after: { state: 'submitted', due_at: submitted.due_at } })
      return submitted
    }))
  })
}

async function decide(
  tx: Tx, request: FastifyRequest, { record, definition }: Loaded, body: z.infer<typeof decisionBody>,
): Promise<StoredResponse> {
  if (record.state !== 'submitted') throw stateConflict(record.state)
  const decision = body.decision === 'approve' ? 'approved' : 'rejected'
  const outcome = await recordApproval(tx, {
    // A submitted case always has a preparer: its opener or, opened by the system, its submitter.
    objectType: 'case', objectId: record.id, preparerId: preparerOf(record)!, contributorIds: await contributors(tx, record),
    excludedIds: [], decision, reason: body.reason, factorVerifiedAt: currentAuth(request).stepUpAt,
    approverPermission: definition.permissions.decide, marketId: record.market_id,
  })
  if (!outcome.ok) {
    // AC-IAM4-1: the refusal is committed with its audit event, so it is a stored response, not a thrown error.
    await recordAudit(tx, {
      action: 'APPROVAL.REFUSED', objectType: 'case', objectId: record.id,
      after: { object_type: 'case', object_id: record.id, reason_code: outcome.reasonCode },
    })
    const details = {
      reason_code: outcome.reasonCode, eligible_approvers: outcome.eligibleApprovers,
      no_eligible_approver: outcome.eligibleApprovers.length === 0,
    }
    const message = 'You prepared or contributed to this case, so someone else must decide it.'
    return { statusCode: 422, body: { error: { code: 'SOD_SELF_APPROVAL', message, details, request_id: request.id } } }
  }
  const decided = await markDecided(tx, record.id, decision, outcome.approvalId)
  await recordChange(tx, record.id, decision, { approval_id: outcome.approvalId, reason: body.reason }, {
    before: { state: record.state }, after: { state: decision, approval_id: outcome.approvalId }, reason: body.reason,
  })
  if (definition.onDecision !== undefined) await definition.onDecision(tx, decided, decision)
  await enqueueOutbox(tx, { type: 'case.decided', payload: { case_id: record.id, type: record.type, decision }, key: record.id })
  return { statusCode: 200, body: envelope(decided) }
}

/**
 * The case if the caller opened it and still holds the type's create permission over its market (no read permission
 * needed); a reader who may not withdraw it gets 403, anyone else 404. A case the system opened has no opener, so it
 * is never withdrawn (D-B2-04): it is decided.
 */
async function withdrawableCase(tx: Tx, registry: CaseTypeRegistry, auth: AuthContext, id: string): Promise<CaseRecord> {
  const record = await getCase(tx, id, true)
  const definition = record === null ? undefined : caseTypeOf(registry, record.type)
  if (record === null || definition === undefined) throw notFound()
  if (record.opened_by === auth.userId && holdsFor(auth, definition.permissions.create, record.market_id)) return record
  throw holdsFor(auth, definition.permissions.read, record.market_id) ? permissionDenied() : notFound()
}

function registerDecisions(app: FastifyInstance, registry: CaseTypeRegistry): void {
  app.post('/v1/cases/:id/decision', { preHandler: [requireRealm('tenant')] }, async (request, reply) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    const body = parse(decisionBody, request.body)
    const result = await inTenant(request, async (tx) => {
      const loaded = await readableCase(tx, registry, auth, id, true)
      assertHolds(auth, loaded.definition.permissions.decide, loaded.record)
      assertStepUp(request)
      return idempotent(tx, request, () => decide(tx, request, loaded, body))
    })
    return sendIdempotent(reply, result)
  })

  app.post('/v1/cases/:id/withdraw', { preHandler: [requireRealm('tenant')] }, async (request) => {
    const id = caseId(request)
    const auth = currentAuth(request)
    const body = parse(withdrawBody, request.body)
    return envelope(await inTenant(request, async (tx) => {
      const record = await withdrawableCase(tx, registry, auth, id)
      if (record.state !== 'open' && record.state !== 'submitted') throw stateConflict(record.state)
      const withdrawn = await markWithdrawn(tx, record.id)
      await recordChange(tx, record.id, 'withdrawn', { reason: body.reason }, {
        before: { state: record.state }, after: { state: 'withdrawn' }, reason: body.reason,
      })
      return withdrawn
    }))
  })
}

/** API-30 case routes (PLAN B1 section 2.9). */
export function registerCaseRoutes(app: FastifyInstance, registry: CaseTypeRegistry): void {
  registerOpen(app, registry)
  registerReads(app, registry)
  registerPreparation(app, registry)
  registerDecisions(app, registry)
  registerCaseUpdates(app, registry)
}
