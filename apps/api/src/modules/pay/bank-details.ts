import { createHmac, randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { BankDetails, bankFingerprint, bankRequestContext, bankVersionContext, maskAccount } from '../../lib/bank-crypto.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { enqueue } from '../../lib/jobs.js'
import { open, seal } from '../../lib/secret-box.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'
import { getSetting } from '../ten/index.js'
import { noticeJob } from './notices.js'
import { notConfigured } from './selection.js'

// D-B4-16 bank details (staff path): a Support agent records the new details as a sealed request (step-up), opens a
// bank_detail case for it, and a second staff member approves it into a new version with a cooling-off window. Reads
// show masked values only; there is no unmask route (SECURITY section 6).

const idParams = z.object({ id: z.uuid() })
const contactEmail = z.email().max(254)

type Scope = readonly string[] | null

/** The participant's market if it exists and is in scope, else 404. */
async function participantMarket(tx: Tx, id: string, scope: Scope): Promise<string> {
  const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [id])
  const market = rows[0]?.market_id
  if (market === undefined || (scope !== null && !scope.includes(market))) throw notFound()
  return market
}

/**
 * Payees other than `participantId` whose current account has this fingerprint, among participants of the scope's
 * markets (null = every market: the approver's case preview, which judges the shared-account threshold tenant-wide).
 */
async function sharedWith(tx: Tx, participantId: string, fingerprint: Buffer, scope: Scope): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(DISTINCT v.participant_id)::int AS n FROM bank_detail_version v JOIN participant p ON p.id = v.participant_id
     WHERE v.fingerprint = $1 AND v.superseded_at IS NULL AND v.participant_id <> $2 AND ($3::uuid[] IS NULL OR p.market_id = ANY ($3))`,
    [fingerprint, participantId, scope],
  )
  return rows[0]!.n
}

const invalid = (path: string) => new ApiError(422, 'BANK_DETAILS_INVALID', `The bank details are not valid (${path}).`, { path })

export function registerBankDetailRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')
  const { secretKey } = app.config
  sealKey = secretKey

  app.post('/v1/participants/:id/bank-detail-requests', { preHandler: [tenant, requirePermission('case.bank_detail.create'), requireStepUp()] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const auth = currentAuth(request)
    const raw = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>
    const { contact_email: email, ...rest } = raw
    const details = BankDetails.safeParse(rest)
    if (!details.success) throw invalid(details.error.issues[0]!.path.join('.') || 'scheme')
    const contact = email === undefined ? null : contactEmail.safeParse(email)
    if (contact !== null && !contact.success) throw invalid('contact_email')
    // The Idempotency-Key hash is unkeyed SHA-256: it gets a keyed digest of the details, never the details themselves.
    request.body = { digest: createHmac('sha256', secretKey).update(`bank-request:${auth.tenantId}:${JSON.stringify(raw)}`).digest('hex') }
    const scope = marketScope(auth, 'case.bank_detail.create')
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      await participantMarket(tx, id, scope)
      if ((await getSetting(tx, 'payouts.bank_detail_cooling_off_hours')) === null) throw notConfigured('payouts.bank_detail_cooling_off_hours')
      const requestId = randomUUID()
      const context = bankRequestContext(requestId)
      const fingerprint = bankFingerprint(secretKey, auth.tenantId!, details.data)
      const masked = maskAccount(details.data)
      await tx.query(
        `INSERT INTO bank_detail_request (id, tenant_id, participant_id, scheme, details_sealed, contact_email_sealed, fingerprint, masked, created_by)
         VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, $7, app_user_id())`,
        [requestId, id, details.data.scheme, seal(secretKey, JSON.stringify(details.data), context),
          contact === null ? null : seal(secretKey, contact.data, context), fingerprint, masked],
      )
      await recordAudit(tx, {
        action: 'BANK_DETAIL.REQUESTED', objectType: 'bank_detail_request', objectId: requestId,
        after: { participant_id: id, scheme: details.data.scheme, masked },
      })
      return { statusCode: 201, body: envelope({ request_id: requestId, masked, shared_with_count: await sharedWith(tx, id, fingerprint, scope) }) }
    }))
    return sendIdempotent(reply, result)
  })

  app.get('/v1/participants/:id/bank-details', { preHandler: [tenant, requirePermission('participant.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'participant.read')
    return envelope(await inTenant(request, async (tx) => {
      await participantMarket(tx, id, scope)
      const { rows } = await tx.query<{ superseded_at: Date | null }>(
        `SELECT id, scheme, masked, created_via, cooling_off_until, cooling_off_until > now() AS in_cooling_off, created_at, superseded_at
         FROM bank_detail_version WHERE participant_id = $1 ORDER BY created_at DESC, id`,
        [id],
      )
      const current = rows.find((row) => row.superseded_at === null)
      return {
        current: current === undefined ? null : (({ superseded_at: _superseded, ...view }) => view)(current),
        history: rows.filter((row) => row.superseded_at !== null),
      }
    }))
  })
}

const payload = z.strictObject({ request_id: z.uuid() })
type BankDetailPayload = z.infer<typeof payload>

interface RequestRow {
  readonly id: string
  readonly participant_id: string
  readonly scheme: string
  readonly details_sealed: string
  readonly fingerprint: Buffer
  readonly masked: string
  readonly created_by: string
}

async function requestOf(tx: Tx, id: string): Promise<RequestRow | undefined> {
  const { rows } = await tx.query<RequestRow>(
    'SELECT id, participant_id, scheme, details_sealed, fingerprint, masked, created_by FROM bank_detail_request WHERE id = $1', [id])
  return rows[0]
}

// CAS hooks receive no app config, so registerBankDetailRoutes hands the key over.
// shortcut: one SECRET_ENCRYPTION_KEY per process (the app that registered PAY last); pass config to CAS hooks if two
// apps with different keys ever share a process.
let sealKey: Buffer | null = null

function currentSealKey(): Buffer {
  if (sealKey === null) throw new Error('payModule is not registered: no key to seal bank details')
  return sealKey
}

/** The bank_detail case type (PAY): approving it writes the new current version (D-B4-16, AC-17.1). */
export const BANK_DETAIL_CASE_TYPE: CaseTypeDefinition<BankDetailPayload> = {
  type: 'bank_detail',
  subjectTypes: ['participant'],
  reasonCodes: ['PAYEE_REQUEST', 'CORRECTION'],
  evidenceRequired: true,
  permissions: { read: 'case.bank_detail.read', create: 'case.bank_detail.create', decide: 'case.bank_detail.approve' },
  payload,
  async resolveSubject(tx, _subjectType, subjectId) {
    const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [subjectId])
    return rows[0] === undefined ? null : { marketId: rows[0].market_id }
  },
  async validateCreate(tx, subject, value, _scope, stored) {
    const found = await requestOf(tx, value.request_id)
    const { rows: acting } = await tx.query<{ id: string }>('SELECT app_user_id() AS id')
    if (found === undefined || found.participant_id !== subject.id || found.created_by !== acting[0]!.id) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'request_id is not valid: it must be your bank-detail request for this participant.', {
        issues: [{ path: 'request_id', message: 'must be your bank-detail request for this participant' }],
      })
    }
    // The check below is check-then-insert: two cases opened at once for one request wait here (before any audit write).
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('bank_detail_request:' || $1::text, 0))`, [value.request_id])
    const { rowCount } = await tx.query(
      `SELECT 1 FROM case_file WHERE type = 'bank_detail' AND payload ->> 'request_id' = $1 AND id IS DISTINCT FROM $2::uuid`,
      [value.request_id, stored?.id ?? null],
    )
    if (rowCount !== 0) throw new ApiError(409, 'REQUEST_USED', 'This bank-detail request already belongs to a case: record the details again.')
  },
  async effectPreview(tx, c) {
    const found = (await requestOf(tx, c.payload.request_id))!
    const { rows } = await tx.query<{ masked: string }>(
      'SELECT masked FROM bank_detail_version WHERE participant_id = $1 AND superseded_at IS NULL', [c.subject_id])
    const shared = await sharedWith(tx, c.subject_id, found.fingerprint, null)
    const threshold = await getSetting(tx, 'payouts.shared_account_threshold')
    return {
      current_masked: rows[0]?.masked ?? null, new_masked: found.masked, scheme: found.scheme,
      cooling_off_hours: await getSetting(tx, 'payouts.bank_detail_cooling_off_hours'),
      shared_with_count: shared, shared_account_threshold: threshold, shared_above_threshold: threshold === null ? null : shared >= threshold,
    }
  },
  async onDecision(tx, c: CaseRecord<BankDetailPayload>, decision) {
    if (decision !== 'approved') return
    const hours = await getSetting(tx, 'payouts.bank_detail_cooling_off_hours')
    if (hours === null) throw notConfigured('payouts.bank_detail_cooling_off_hours')
    const found = (await requestOf(tx, c.payload.request_id))!
    const { rows: previous } = await tx.query<{ id: string; masked: string }>(
      'SELECT id, masked FROM bank_detail_version WHERE participant_id = $1 AND superseded_at IS NULL FOR UPDATE', [c.subject_id])
    if (previous[0] !== undefined) await tx.query('UPDATE bank_detail_version SET superseded_at = now() WHERE id = $1', [previous[0].id])
    const versionId = randomUUID()
    const secretKey = currentSealKey()
    const details = open(secretKey, found.details_sealed, bankRequestContext(found.id))
    const { rows } = await tx.query<{ cooling_off_until: Date }>(
      `INSERT INTO bank_detail_version (id, tenant_id, participant_id, scheme, details_sealed, fingerprint, masked, created_via, request_id, case_id,
         cooling_off_until)
       VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, 'case', $7, $8, now() + make_interval(hours => $9)) RETURNING cooling_off_until`,
      [versionId, c.subject_id, found.scheme, seal(secretKey, details, bankVersionContext(versionId)), found.fingerprint, found.masked, found.id, c.id, hours],
    )
    await recordAudit(tx, {
      action: 'BANK_DETAIL.VERSION_CREATED', objectType: 'bank_detail_version', objectId: versionId,
      before: previous[0] === undefined ? null : { masked: previous[0].masked },
      after: { participant_id: c.subject_id, masked: found.masked, case_id: c.id, cooling_off_until: rows[0]!.cooling_off_until },
    })
    await enqueue(tx, noticeJob, { template: 'bank_detail.changed', participant_id: c.subject_id, ref_id: versionId })
  },
}
