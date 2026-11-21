import { gzipSync } from 'node:zlib'
import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { maskContact } from '../../lib/contact.js'
import { ApiError } from '../../lib/errors.js'
import { enqueue } from '../../lib/jobs.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'
import { sendOutcomeJob } from './jobs.js'
import {
  correctionFields, correctionsSchema, getRequest, SYSTEM_REASON_CODES, unsealFor, type RequestRow,
} from './requests.js'

const CORRECTABLE = ['contact.email', 'contact.phone', 'display_name'] as const

const payloadSchema = z.strictObject({
  request_id: z.uuid(),
  participant_id: z.uuid().optional(),
  retention_basis: z.string().trim().min(1).max(2000).optional(),
  corrections: z.array(z.enum(CORRECTABLE)).min(1).max(CORRECTABLE.length).optional(),
})
type PrivacyPayload = z.infer<typeof payloadSchema>

// D-B5-18, the same lists prv_erase_participant (0511) returns: the preview shows what the approval will clear and keep.
export const ERASURE_CLEARED = [
  'participant.display_name', 'participant.contact', 'participant.identity_doc_id', 'participant.account_holders', 'user_account.email', 'user_account.idp_subject',
  'user_account.display_name', 'user_account.firebase_subject', 'user_account.locale', 'password_credential', 'mfa_credential', 'portal_sign_in_code',
  'user_invitation (open: revoked)', 'login_attempt', 'session.ip', 'session.user_agent', 'participant_signal',
  'bank_detail_request.details_sealed', 'bank_detail_request.contact_email_sealed', 'bank_detail_version.details_sealed',
  'tax_profile.tax_id_sealed', 'tax_profile.tax_id_masked', 'notification.params.masked', 'notification.params.previous_masked',
  'notification (queued email: suppressed)',
  'privacy_export', 'privacy_request.corrections_sealed', 'privacy_request.requester_sealed (other requests)', 'data_export_file.content',
]
export const ERASURE_RETAINED = [
  'position', 'relationship', 'result_line', 'qualification_state', 'run_snapshot', 'journal_entry', 'posting', 'payout_instruction',
  'bank_detail fingerprints', 'tax_profile.residency', 'tax_profile.entity_type', 'notification', 'case_file', 'audit',
]

const NEEDS_RETENTION_BASIS = new Set(['access', 'portability', 'erasure'])
const ERASURE_DEFERRED_STATE = 'PV001'
const CORRECTION_MISMATCH_STATE = '22023'
/** D-B5-23: a request opened without a known market is read only with privacy.manage for all markets. */
const NO_MARKET = '00000000-0000-0000-0000-000000000000'

async function requestOf(tx: Tx, c: CaseRecord<PrivacyPayload>): Promise<RequestRow> {
  const request = await getRequest(tx, c.payload.request_id)
  if (request === undefined) throw new Error(`privacy case ${c.id} has no request`)
  return request
}

export async function erasureBlockers(tx: Tx, subjectId: string): Promise<{ reason: string }[]> {
  const { rows } = await tx.query<{ blockers: { reason: string }[] }>('SELECT prv_erasure_blockers($1) AS blockers', [subjectId])
  return rows[0]!.blockers
}

async function subjectOf(tx: Tx, id: string) {
  const { rows } = await tx.query<{ id: string; external_ref: string; display_name: string | null; contact: Record<string, string> | null }>(
    'SELECT id, external_ref, display_name, contact FROM participant WHERE id = $1', [id])
  return rows[0]!
}

// Current and corrected values, masked: the preview is immutable case history erasure cannot clear (D-B5-19).
async function correctionPreview(tx: Tx, request: RequestRow, fields: readonly string[]) {
  if (request.corrections_sealed === null) {
    throw new ApiError(422, 'CORRECTIONS_REQUIRED', 'Save the corrected values before submitting this request.')
  }
  const corrections = unsealFor(request.id, request.corrections_sealed, correctionsSchema)
  const sealedFields = correctionFields(corrections)
  if (sealedFields.join() !== [...fields].sort().join()) {
    throw new ApiError(422, 'CORRECTIONS_MISMATCH', 'The case lists other fields than the saved corrections.', { fields: sealedFields })
  }
  const subject = await subjectOf(tx, request.subject_participant_id!)
  const masked = (contact: Record<string, string> | null | undefined) => maskContact(contact ?? null) ?? {}
  return sealedFields.map((field) => field === 'display_name'
    ? { field, current: subject.display_name === null ? null : '•••', corrected: '•••' }
    : { field, current: masked(subject.contact)[field.slice(8) as 'email'] ?? null, corrected: masked(corrections.contact)[field.slice(8) as 'email'] ?? null })
}

async function effectPreview(tx: Tx, c: CaseRecord<PrivacyPayload>): Promise<unknown> {
  const request = await requestOf(tx, c)
  if (request.verified_at === null) {
    throw new ApiError(422, 'VERIFICATION_REQUIRED', "Verify the requester's identity before submitting this request.")
  }
  if (NEEDS_RETENTION_BASIS.has(request.type) && c.payload.retention_basis === undefined) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'State the retention basis before submitting this request.', { field: 'retention_basis' })
  }
  const subject = await subjectOf(tx, request.subject_participant_id!)
  const base = { request_id: request.id, type: request.type, subject: { id: subject.id, external_ref: subject.external_ref } }
  if (request.type === 'correction') return { ...base, corrections: await correctionPreview(tx, request, c.payload.corrections ?? []) }
  if (request.type === 'erasure') {
    return { ...base, cleared: ERASURE_CLEARED, retained: ERASURE_RETAINED, blockers: await erasureBlockers(tx, subject.id) }
  }
  const { rows } = await tx.query<{ section: string }>('SELECT DISTINCT section FROM prv_personal_data_map() WHERE section IS NOT NULL ORDER BY 1')
  return { ...base, sections: rows.map((row) => row.section) }
}

async function exportData(tx: Tx, request: RequestRow): Promise<void> {
  const { rows } = await tx.query<{ data: unknown }>('SELECT prv_personal_data($1) AS data', [request.subject_participant_id])
  const content = gzipSync(Buffer.from(JSON.stringify(rows[0]!.data), 'utf8'))
  const created = await tx.query<{ id: string }>(
    // content_sha256 is computed by the insert trigger.
    'INSERT INTO privacy_export (tenant_id, request_id, content) VALUES (app_tenant_id(), $1, $2) RETURNING id',
    [request.id, content],
  )
  await recordAudit(tx, { action: 'PRIVACY_EXPORT.CREATED', objectType: 'privacy_export', objectId: created.rows[0]!.id, after: { request_id: request.id } })
}

async function correct(tx: Tx, request: RequestRow): Promise<void> {
  const erased = await tx.query('SELECT 1 FROM participant WHERE id = $1 AND pseudonymised_at IS NOT NULL', [request.subject_participant_id])
  if (erased.rowCount !== 0) throw new ApiError(409, 'SUBJECT_ERASED', 'This person has been erased: there is nothing left to correct.')
  const corrections = unsealFor(request.id, request.corrections_sealed!, correctionsSchema)
  try {
    const { rows } = await tx.query<{ result: { fields: string[] } }>(
      'SELECT prv_correct_participant($1, $2, $3::jsonb) AS result',
      [request.id, corrections.display_name ?? null, corrections.contact === undefined ? null : JSON.stringify(corrections.contact)],
    )
    await recordAudit(tx, {
      action: 'PARTICIPANT.CORRECTED', objectType: 'participant', objectId: request.subject_participant_id!,
      after: { request_id: request.id, fields: rows[0]!.result.fields },
    })
  } catch (error) {
    if ((error as { code?: string }).code !== CORRECTION_MISMATCH_STATE) throw error
    throw new ApiError(422, 'CORRECTIONS_MISMATCH', 'The saved corrections no longer match the case: save them again.')
  }
}

async function erase(tx: Tx, request: RequestRow): Promise<void> {
  let result: { cleared: string[]; retained: string[]; exports: { id: string; state: 'expired' | 'failed' }[] }
  try {
    const { rows } = await tx.query<{ result: typeof result }>('SELECT prv_erase_participant($1) AS result', [request.id])
    result = rows[0]!.result
  } catch (error) {
    const { code, detail } = error as { code?: string; detail?: string }
    if (code !== ERASURE_DEFERRED_STATE) throw error
    throw new ApiError(409, 'ERASURE_DEFERRED', 'The erasure must wait: something still needs this person\'s data.', { reasons: JSON.parse(detail ?? '[]') })
  }
  await recordAudit(tx, {
    action: 'PARTICIPANT.PSEUDONYMISED', objectType: 'participant', objectId: request.subject_participant_id!,
    after: { request_id: request.id, cleared: result.cleared },
  })
  // D-B6-13: every full export holds the subject's data; the erasure expired or failed it and deleted its files.
  for (const { id, state } of result.exports) {
    await recordAudit(tx, {
      action: state === 'expired' ? 'EXPORT.EXPIRED' : 'EXPORT.FAILED', objectType: 'data_export', objectId: id,
      after: state === 'expired' ? { request_id: request.id } : { code: 'ERASED_DURING_EXPORT', request_id: request.id },
    })
  }
}

async function close(tx: Tx, request: RequestRow, outcome: 'fulfilled' | 'refused', retentionBasis: string | null): Promise<void> {
  await tx.query(
    `UPDATE privacy_request SET outcome = $2, closed_at = now(), retention_basis = coalesce(retention_basis, $3)
     WHERE id = $1 AND outcome IS NULL`,
    [request.id, outcome, retentionBasis],
  )
}

/**
 * D-B5-16..19 on decision: the type's effect, the outcome, then the requester is told: a portal requester by a notice, a
 * public or staff requester by prv.send-outcome after the commit (a rolled-back decision leaves no job).
 */
async function onDecision(tx: Tx, c: CaseRecord<PrivacyPayload>, decision: 'approved' | 'rejected'): Promise<void> {
  const request = await requestOf(tx, c)
  const outcome = decision === 'approved' ? 'fulfilled' : 'refused'
  if (request.channel === 'portal') {
    await tx.query('SELECT notify_participant($1, $2, $3::jsonb)', [
      request.subject_participant_id, 'privacy_request.updated', JSON.stringify({ request_id: request.id, type: request.type, outcome }),
    ])
  }
  if (decision === 'approved') {
    if (request.type === 'access' || request.type === 'portability') await exportData(tx, request)
    if (request.type === 'correction') await correct(tx, request)
    if (request.type === 'erasure') await erase(tx, request)
    // prv.send-outcome clears a public/staff request's own details after mailing; a portal request is told by the notice.
    if (request.type === 'erasure' && request.channel === 'portal') {
      await tx.query('UPDATE privacy_request SET requester_sealed = NULL WHERE id = $1', [request.id])
    }
  }
  await close(tx, request, outcome, c.payload.retention_basis ?? null)
  await recordAudit(tx, {
    action: decision === 'approved' ? 'PRIVACY_REQUEST.FULFILLED' : 'PRIVACY_REQUEST.REFUSED', objectType: 'privacy_request',
    objectId: request.id, after: { case_id: c.id, type: request.type, outcome },
  })
  if (request.channel !== 'portal') await enqueue(tx, sendOutcomeJob, { request_id: request.id })
}

/** The privacy case type (PRV, D-B5-16): system-opened only, decided by a second privacy.manage holder. */
export const PRIVACY_CASE_TYPE: CaseTypeDefinition<PrivacyPayload> = {
  type: 'privacy',
  subjectTypes: ['privacy_request'],
  reasonCodes: [],
  systemReasonCodes: SYSTEM_REASON_CODES,
  evidenceRequired: false,
  permissions: { read: 'privacy.manage', create: 'privacy.manage', decide: 'privacy.manage' },
  payload: payloadSchema,
  // A case without a market (public form, staff request without a known member) stays with all-market holders for its
  // whole life (D-B5-23): no market id ever equals NO_MARKET, so a market-scoped holder never reads it.
  relatedMarketSql: `CASE WHEN c.market_id IS NULL THEN '${NO_MARKET}'::uuid END`,
  async resolveSubject(tx, _subjectType, subjectId) {
    const request = await getRequest(tx, subjectId)
    return request === undefined ? null : { marketId: request.case_market_id }
  },
  // Only the retention basis is the DPO's to edit here; the request, subject and corrected fields come from their routes.
  async validateCreate(_tx, _subject, payload, _scope, stored) {
    if (stored === undefined) return
    const fixed = (p: PrivacyPayload) => JSON.stringify([p.request_id, p.participant_id ?? null, p.corrections ?? null])
    if (fixed(payload) !== fixed(stored.payload)) {
      throw new ApiError(422, 'PAYLOAD_FIXED', 'Only the retention basis can be changed on a privacy case.')
    }
  },
  effectPreview,
  // Staff related to the subject never decide its request (as for disputes); the subject is known once verified, and
  // submit needs verification, so every decision sees it.
  async excludedApprovers(tx, c) {
    if (c.payload.participant_id === undefined) return []
    const { rows } = await tx.query<{ id: string }>('SELECT staff_related_users($1) AS id', [c.payload.participant_id])
    return rows.map((row) => row.id)
  },
  async dueAt(tx, c) {
    return (await requestOf(tx, c)).due_at
  },
  onDecision,
}
