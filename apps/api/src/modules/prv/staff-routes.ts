import { gunzipSync } from 'node:zlib'
import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { erasureBlockers } from './privacy-case.js'
import {
  correctionFields, correctionsSchema, createRequest, digestBody, exportOf, getRequest, REQUEST_TYPES, requesterSchema, sealFor, setDueAt,
  STATE_SQL, unsealFor, type RequestRow,
} from './requests.js'

const MANAGE = 'privacy.manage'
const idParams = z.object({ id: z.uuid() })
const listQuery = z.strictObject({
  state: z.enum(['received', 'in_progress', 'fulfilled', 'refused']).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  ...pageQuery,
})
const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.uuid()])
const createBody = z.strictObject({
  type: z.enum(REQUEST_TYPES),
  full_name: z.string().trim().min(1).max(200).optional(),
  email: z.email().max(320).optional(),
  participant_ref: z.string().trim().min(1).max(100).optional(),
  details: z.string().trim().min(1).max(2000).optional(),
  received_via: z.string().trim().min(1).max(200),
})

const MAILBOX_PROOF_NEEDED = new Set(['erasure', 'correction'])

const verifyBody = z.strictObject({
  method: z.enum(['contact_match', 'document', 'other']),
  subject_participant_id: z.uuid(),
  note: z.string().trim().min(1).max(1000),
})

/** D-B5-23: privacy.manage over the case market; a case without a market needs it for all markets. */
function inScope(scope: readonly string[] | null, marketId: string | null): boolean {
  return scope === null || (marketId !== null && scope.includes(marketId))
}

async function scopedRequest(tx: Tx, request: FastifyRequest, id: string, lock = false): Promise<RequestRow> {
  const found = await getRequest(tx, id, lock)
  if (found === undefined || !inScope(marketScope(currentAuth(request), MANAGE), found.case_market_id)) throw notFound()
  return found
}

const COLUMNS = `r.id, r.case_id, r.type, r.channel, ${STATE_SQL} AS state,
         CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'external_ref', p.external_ref) END AS subject,
         r.verified_at IS NOT NULL AS verified, r.received_at, r.due_at, r.escalated_at, r.due_at IS NOT NULL AS deadline_configured`
const FROM = `FROM privacy_request r JOIN case_file c ON c.id = r.case_id LEFT JOIN participant p ON p.id = r.subject_participant_id`

async function listRequests(tx: Tx, scope: readonly string[] | null, query: z.infer<typeof listQuery>) {
  const after = decodeCursor(query.cursor, cursorSchema)
  const { rows } = await tx.query<{ id: string; received_at: Date }>(
    `SELECT * FROM (SELECT ${COLUMNS} ${FROM}
       WHERE ($1::uuid[] IS NULL OR c.market_id = ANY ($1)) AND ($2::text IS NULL OR r.type = $2)
         AND ($3::boolean IS NULL OR coalesce(r.closed_at IS NULL AND r.due_at < now(), false) = $3)
         AND ($4::timestamptz IS NULL OR (date_trunc('milliseconds', r.received_at), r.id) < ($4::timestamptz, $5::uuid))) x
     WHERE ($6::text IS NULL OR x.state = $6)
     ORDER BY date_trunc('milliseconds', x.received_at) DESC, x.id DESC LIMIT $7`,
    [scope, query.type ?? null, query.overdue ?? null, after?.[0] ?? null, after?.[1] ?? null, query.state ?? null, query.limit + 1],
  )
  return toPage(rows, query.limit, (row) => [row.received_at.toISOString(), row.id])
}

// The DPO's view: requester and corrections unsealed (each read audited), verification, erasure blockers, export summary.
async function requestDetail(tx: Tx, found: RequestRow) {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT ${COLUMNS}, r.verification_method, r.verification_note, r.verified_at, r.verified_by,
            coalesce(r.retention_basis, c.payload ->> 'retention_basis') AS retention_basis, r.outcome, r.closed_at,
            c.state AS case_state, c.market_id,
            (SELECT jsonb_build_object('id', e.id, 'created_at', e.created_at, 'sha256', encode(e.content_sha256, 'hex'), 'bytes', length(e.content))
             FROM privacy_export e WHERE e.request_id = r.id) AS export
     ${FROM} WHERE r.id = $1`,
    [found.id],
  )
  const requester = found.requester_sealed === null ? null : unsealFor(found.id, found.requester_sealed, requesterSchema)
  if (requester !== null) {
    await recordAudit(tx, { action: 'PRIVACY_REQUEST.REQUESTER_READ', objectType: 'privacy_request', objectId: found.id })
  }
  const corrections = found.corrections_sealed === null ? null : unsealFor(found.id, found.corrections_sealed, correctionsSchema)
  if (corrections !== null) {
    await recordAudit(tx, { action: 'PRIVACY_REQUEST.CORRECTIONS_READ', objectType: 'privacy_request', objectId: found.id })
  }
  const blockers = found.type === 'erasure' && found.subject_participant_id !== null && found.outcome === null
    ? await erasureBlockers(tx, found.subject_participant_id)
    : null
  return { ...rows[0]!, requester, corrections, blockers }
}

async function staffCreate(tx: Tx, request: FastifyRequest, body: z.infer<typeof createBody>) {
  const { rows } = body.participant_ref === undefined
    ? { rows: [] }
    : await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE external_ref = $1', [body.participant_ref])
  const marketId = rows[0]?.market_id ?? null
  if (!inScope(marketScope(currentAuth(request), MANAGE), marketId)) {
    throw new ApiError(403, 'SCOPE_NOT_HELD', 'Recording this request needs privacy.manage for its market (all markets when no member is named).')
  }
  const { type, ...requester } = body
  return createRequest(tx, { type, channel: 'staff', subjectId: null, marketId, requester })
}

async function verify(tx: Tx, request: FastifyRequest, id: string, body: z.infer<typeof verifyBody>) {
  const found = await scopedRequest(tx, request, id, true)
  if (found.verified_at !== null) throw new ApiError(409, 'ALREADY_VERIFIED', 'This request is already verified.')
  if (found.case_state !== 'open') throw new ApiError(409, 'CASE_NOT_OPEN', 'The case of this request is no longer open.')
  const { rows } = await tx.query<{ email: string | null; market_id: string }>(
    "SELECT contact ->> 'email' AS email, market_id FROM participant WHERE id = $1", [body.subject_participant_id])
  const subject = rows[0]
  if (subject === undefined || !inScope(marketScope(currentAuth(request), MANAGE), subject.market_id)) {
    throw new ApiError(422, 'SUBJECT_NOT_FOUND', 'No member with this id.')
  }
  // D-B5-23: the case market is fixed at open, so a subject of another market would move the request out of its scope.
  if (found.case_market_id !== null && subject.market_id !== found.case_market_id) {
    throw new ApiError(422, 'SUBJECT_MARKET_MISMATCH', 'This request was opened for a member of another market. Record a new request for this member.')
  }
  if (body.method === 'contact_match') {
    // An equal email shows only that the requester knows the address, not that it controls the mailbox: never enough
    // for an irreversible erasure or a correction (which can move the contact email to someone else).
    if (MAILBOX_PROOF_NEEDED.has(found.type)) {
      throw new ApiError(422, 'VERIFICATION_METHOD_NOT_ALLOWED', 'An email match cannot verify an erasure or a correction. Check an identity document instead.')
    }
    const claimed = found.requester_sealed === null ? undefined : unsealFor(found.id, found.requester_sealed, requesterSchema).email
    if (claimed === undefined || subject.email === null || claimed.toLowerCase() !== subject.email.toLowerCase()) {
      throw new ApiError(422, 'VERIFICATION_MISMATCH', "The requester's email does not match the member's contact email.")
    }
  }
  if (body.method === 'document') {
    const evidence = await tx.query('SELECT 1 FROM case_evidence WHERE case_id = $1 LIMIT 1', [found.case_id])
    if (evidence.rowCount === 0) throw new ApiError(422, 'EVIDENCE_REQUIRED', 'Attach the identity document to the case first.')
  }
  await tx.query(
    `UPDATE privacy_request SET verified_at = now(), verified_by = app_user_id(), verification_method = $2, verification_note = $3,
       subject_participant_id = $4 WHERE id = $1`,
    [id, body.method, body.note, body.subject_participant_id],
  )
  // The subject reads its own request's case in the portal through payload.participant_id (D-B5-02 self scope).
  await tx.query(`UPDATE case_file SET payload = payload || jsonb_build_object('participant_id', $2::text) WHERE id = $1`,
    [found.case_id, body.subject_participant_id])
  await setDueAt(tx, id, body.subject_participant_id)
  await recordAudit(tx, {
    action: 'PRIVACY_REQUEST.VERIFIED', objectType: 'privacy_request', objectId: id,
    after: { method: body.method, subject_participant_id: body.subject_participant_id },
  })
  return requestDetail(tx, (await getRequest(tx, id))!)
}

async function setCorrections(tx: Tx, request: FastifyRequest, id: string, corrections: z.infer<typeof correctionsSchema>) {
  const found = await scopedRequest(tx, request, id, true)
  if (found.type !== 'correction') throw new ApiError(422, 'NOT_A_CORRECTION', 'Only a correction request takes corrected values.')
  if (found.case_state !== 'open') throw new ApiError(409, 'CASE_NOT_OPEN', 'The case of this request is no longer open.')
  const fields = correctionFields(corrections)
  await tx.query('UPDATE privacy_request SET corrections_sealed = $2 WHERE id = $1', [id, sealFor(id, corrections)])
  // Field names only in the case: its payload and preview are history an erasure cannot clear (D-B5-19).
  await tx.query(`UPDATE case_file SET payload = payload || jsonb_build_object('corrections', $2::jsonb) WHERE id = $1`,
    [found.case_id, JSON.stringify(fields)])
  await recordAudit(tx, { action: 'PRIVACY_REQUEST.CORRECTIONS_SET', objectType: 'privacy_request', objectId: id, after: { fields } })
  return { fields }
}

export function sendExport(reply: FastifyReply, id: string, content: Buffer) {
  return reply
    .header('content-type', 'application/json')
    .header('content-disposition', `attachment; filename="privacy-export-${id}.json"`)
    .header('cache-control', 'no-store')
    .send(gunzipSync(content))
}

/** API-31 staff side (SC-15): list, detail, record, verify, corrections, export download. */
export function registerStaffRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission(MANAGE)] }
  const write = { preHandler: [requireRealm('tenant'), requirePermission(MANAGE), requireStepUp()] }

  app.get('/v1/privacy-requests', read, async (request) => {
    const query = parse(listQuery, request.query)
    const scope = marketScope(currentAuth(request), MANAGE)
    return inTenant(request, (tx) => listRequests(tx, scope, query))
  })

  app.get('/v1/privacy-requests/:id', read, async (request) => {
    const { id } = parse(idParams, request.params)
    return envelope(await inTenant(request, async (tx) => requestDetail(tx, await scopedRequest(tx, request, id))))
  })

  app.post('/v1/privacy-requests', write, async (request, reply) => {
    const body = parse(createBody, request.body)
    digestBody(request, `privacy-staff:${currentAuth(request).tenantId}`)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const created = await staffCreate(tx, request, body)
      return { statusCode: 201, body: envelope(await requestDetail(tx, (await getRequest(tx, created.id))!)) }
    }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/privacy-requests/:id/verify', write, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(verifyBody, request.body)
    return envelope(await inTenant(request, (tx) => verify(tx, request, id, body)))
  })

  app.put('/v1/privacy-requests/:id/corrections', write, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(correctionsSchema, request.body)
    if (correctionFields(body).length === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Send at least one corrected field.')
    return envelope(await inTenant(request, (tx) => setCorrections(tx, request, id, body)))
  })

  app.get('/v1/privacy-requests/:id/export', read, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const content = await inTenant(request, async (tx) => exportOf(tx, (await scopedRequest(tx, request, id)).id))
    return sendExport(reply, id, content)
  })
}
