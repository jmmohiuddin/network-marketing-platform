import { createHmac, randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Config } from '../../config.js'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import { open, seal } from '../../lib/secret-box.js'
import { openSystemCase } from '../cas/index.js'
import { getSetting } from '../ten/index.js'

export const REQUEST_TYPES = ['access', 'correction', 'erasure', 'portability'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]
export type Channel = 'portal' | 'public_form' | 'staff'

const REASON_CODES: Readonly<Record<Channel, string>> = {
  portal: 'PORTAL_REQUEST', public_form: 'PUBLIC_FORM', staff: 'RECEIVED_BY_STAFF',
}
export const SYSTEM_REASON_CODES = Object.values(REASON_CODES)

/** The sealed requester of a public-form or staff request (and the details of a portal request). */
export const requesterSchema = z.object({
  full_name: z.string().optional(),
  email: z.string().optional(),
  participant_ref: z.string().optional(),
  details: z.string().optional(),
  received_via: z.string().optional(),
})
export type Requester = z.infer<typeof requesterSchema>

/** D-B5-19 corrected values, sealed in privacy_request.corrections_sealed. */
export const correctionsSchema = z.strictObject({
  display_name: z.string().trim().min(1).max(200).optional(),
  contact: z.strictObject({ email: z.email().max(320).optional(), phone: z.string().trim().min(3).max(40).optional() }).optional(),
})
export type Corrections = z.infer<typeof correctionsSchema>

/** The field names a set of corrections changes, sorted (the case payload's `corrections`). */
export function correctionFields(corrections: Corrections): string[] {
  const contact = Object.keys(corrections.contact ?? {}).map((key) => `contact.${key}`)
  return [...(corrections.display_name === undefined ? [] : ['display_name']), ...contact].sort()
}

// The API's key and mail drop, set when prvModule registers (case hooks receive no config), as PAY keeps its seal key.
let prvConfig: Pick<Config, 'secretKey' | 'mailDir'> | null = null

export function setPrvConfig(config: Config): void {
  prvConfig = { secretKey: config.secretKey, mailDir: config.mailDir }
}

export function currentPrvConfig(): Pick<Config, 'secretKey' | 'mailDir'> {
  if (prvConfig === null) throw new Error('prvModule is not registered: no key to seal privacy requests')
  return prvConfig
}

const context = (requestId: string) => `privacy_request:${requestId}`

export function sealFor(requestId: string, value: unknown): string {
  return seal(currentPrvConfig().secretKey, JSON.stringify(value), context(requestId))
}

export function unsealFor<S extends z.ZodType>(requestId: string, sealed: string, schema: S): z.infer<S> {
  return schema.parse(JSON.parse(open(currentPrvConfig().secretKey, sealed, context(requestId))))
}

/**
 * The Idempotency-Key request hash is an unkeyed SHA-256 of the body: personal data in it is replaced by a keyed digest
 * before idempotent() runs (as PAY's bank-detail routes do).
 */
export function digestBody(request: FastifyRequest, purpose: string): void {
  const digest = createHmac('sha256', currentPrvConfig().secretKey).update(`${purpose}:${JSON.stringify(request.body ?? null)}`).digest('hex')
  request.body = { digest }
}

/** The reference a public requester gets: the first 8 characters of the request id, upper case. */
export const referenceOf = (id: string): string => id.slice(0, 8).toUpperCase()

export interface NewRequest {
  readonly type: RequestType
  readonly channel: Channel
  /** Portal only: the session participant (verified by the session). */
  readonly subjectId: string | null
  readonly marketId: string | null
  readonly requester: Requester | null
}

/**
 * Opens the system privacy case (subject = the request, D-B5-16) and the request in the caller's transaction. A portal
 * request is the session participant's own: verified by the session, by the portal user (requester_user_id, verified_by).
 */
export async function createRequest(tx: Tx, input: NewRequest): Promise<{ id: string; caseId: string }> {
  const id = randomUUID()
  const portal = input.channel === 'portal'
  const payload = { request_id: id, ...(portal ? { participant_id: input.subjectId } : {}) }
  const caseInput = {
    type: 'privacy', subjectType: 'privacy_request', subjectId: id, reasonCode: REASON_CODES[input.channel], payload, marketId: input.marketId,
  }
  const caseId = portal ? await openPortalPrivacyCase(tx, caseInput) : (await openSystemCase(tx, caseInput)).id
  await tx.query(
    `INSERT INTO privacy_request (id, tenant_id, case_id, type, channel, subject_participant_id, requester_user_id, requester_sealed,
       verified_at, verified_by, verification_method)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, CASE WHEN $6 THEN app_user_id() END, $7,
       CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN app_user_id() END, CASE WHEN $6 THEN 'portal_session' END)`,
    [id, caseId, input.type, input.channel, input.subjectId, portal, input.requester === null ? null : sealFor(id, input.requester)],
  )
  if (portal) await setDueAt(tx, id, input.subjectId!)
  await recordAudit(tx, {
    action: 'PRIVACY_REQUEST.RECEIVED', objectType: 'privacy_request', objectId: id,
    after: { case_id: caseId, type: input.type, channel: input.channel, subject_participant_id: input.subjectId },
  })
  return { id, caseId }
}

/**
 * The system privacy case of a portal request. shortcut: CAS openSystemCase records its opened event without an actor,
 * which case_event_insert_guard (0506) refuses in a portal transaction (it needs the portal user as the actor); move to
 * openSystemCase once CAS records the acting portal user there.
 */
async function openPortalPrivacyCase(tx: Tx, input: { type: string; subjectType: string; subjectId: string; reasonCode: string; payload: unknown; marketId: string | null }) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by, opened_by_kind)
     VALUES (app_tenant_id(), $1, $2, $3, $4, 'open', $5::jsonb, $6, NULL, 'system') RETURNING id`,
    [input.type, input.subjectType, input.subjectId, input.reasonCode, JSON.stringify(input.payload), input.marketId],
  )
  const caseId = rows[0]!.id
  const after = { type: input.type, subject_type: input.subjectType, subject_id: input.subjectId, reason_code: input.reasonCode, opened_by_kind: 'system' }
  await tx.query(
    `INSERT INTO case_event (tenant_id, case_id, actor_id, kind, data) VALUES (app_tenant_id(), $1, app_user_id(), 'opened', NULL)`,
    [caseId],
  )
  await recordAudit(tx, { action: 'CASE.OPENED', objectType: 'case', objectId: caseId, after })
  return caseId
}

/** due_at = received + privacy.policy.response_days[subject market] days; unset market: no deadline (C-B5-4). */
export async function setDueAt(tx: Tx, requestId: string, subjectId: string): Promise<void> {
  const policy = await getSetting(tx, 'privacy.policy')
  const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [subjectId])
  const days = policy?.response_days[rows[0]!.market_id]
  if (days === undefined) return
  await tx.query(`UPDATE privacy_request SET due_at = received_at + make_interval(days => $2) WHERE id = $1`, [requestId, days])
}

export interface RequestRow {
  id: string
  case_id: string
  type: RequestType
  channel: Channel
  subject_participant_id: string | null
  requester_user_id: string | null
  requester_sealed: string | null
  corrections_sealed: string | null
  verified_at: Date | null
  verification_method: string | null
  due_at: Date | null
  outcome: 'fulfilled' | 'refused' | null
  case_state: string
  case_market_id: string | null
  payload: { retention_basis?: string; corrections?: string[] }
}

/** One request with its case (FOR UPDATE of the request with lock). */
export async function getRequest(tx: Tx, id: string, lock = false): Promise<RequestRow | undefined> {
  const { rows } = await tx.query<RequestRow>(
    `SELECT r.id, r.case_id, r.type, r.channel, r.subject_participant_id, r.requester_user_id, r.requester_sealed, r.corrections_sealed,
            r.verified_at, r.verification_method, r.due_at, r.outcome, c.state AS case_state, c.market_id AS case_market_id, c.payload
     FROM privacy_request r JOIN case_file c ON c.id = r.case_id WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`,
    [id],
  )
  return rows[0]
}

/** SQL of the request state shown to people (r = privacy_request, c = its case). */
export const STATE_SQL = `CASE WHEN r.outcome IS NOT NULL THEN r.outcome
  WHEN r.verified_at IS NOT NULL OR c.state <> 'open' THEN 'in_progress' ELSE 'received' END`

/** The export of an approved access or portability request, as a JSON attachment (D-B5-17), audited. */
export async function exportOf(tx: Tx, requestId: string): Promise<Buffer> {
  const { rows } = await tx.query<{ id: string; content: Buffer }>('SELECT id, content FROM privacy_export WHERE request_id = $1', [requestId])
  const found = rows[0]
  if (found === undefined) throw new ApiError(404, 'NOT_FOUND', 'The resource does not exist.')
  await recordAudit(tx, { action: 'PRIVACY_EXPORT.DOWNLOADED', objectType: 'privacy_export', objectId: found.id, after: { request_id: requestId } })
  return found.content
}
