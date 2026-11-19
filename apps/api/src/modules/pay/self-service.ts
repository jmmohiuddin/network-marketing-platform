import { createHmac, randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { recordAudit } from '../../lib/audit.js'
import { assertStepUp, currentAuth, requirePortal } from '../../lib/auth.js'
import { BankDetails, bankFingerprint, bankRequestContext, bankVersionContext, maskAccount } from '../../lib/bank-crypto.js'
import { inPortal } from '../../lib/db.js'
import { ApiError } from '../../lib/errors.js'
import { envelope } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { seal } from '../../lib/secret-box.js'
import { getSetting } from '../ten/index.js'
import { invalid, notifyBankDetailChanged } from './bank-details.js'
import { notConfigured } from './selection.js'

// D-B5-12 payee self-service (API-27 portal path, C-B5-5): the payee's own portal session records new bank details
// (re-auth, Idempotency-Key). An account shared with as many other payees as payouts.shared_account_threshold goes to a
// system-opened bank_detail review; otherwise the new version is current at once and waits the cooling-off. Responses
// carry masked values only.

const COOLING_OFF = 'payouts.bank_detail_cooling_off_hours'

/**
 * The shared-account review: a bank_detail case the system opens in the payee's portal transaction (0506 admits only
 * this one). shortcut: written here, not through CAS openSystemCase, whose `opened` event has no actor while a portal
 * transaction records only events of its own user (case_event_insert_guard); move to a CAS facade when CAS offers one.
 */
async function openSharedAccountReview(tx: Tx, participantId: string, marketId: string, requestId: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by, opened_by_kind)
     VALUES (app_tenant_id(), 'bank_detail', 'participant', $1, 'SHARED_ACCOUNT', 'open', $2::jsonb, $3, NULL, 'system') RETURNING id`,
    [participantId, JSON.stringify({ request_id: requestId, participant_id: participantId }), marketId],
  )
  const caseId = rows[0]!.id
  await tx.query(`INSERT INTO case_event (tenant_id, case_id, actor_id, kind, data) VALUES (app_tenant_id(), $1, app_user_id(), 'opened', NULL)`, [caseId])
  await recordAudit(tx, {
    action: 'CASE.OPENED', objectType: 'case', objectId: caseId,
    after: { type: 'bank_detail', subject_type: 'participant', subject_id: participantId, reason_code: 'SHARED_ACCOUNT', opened_by_kind: 'system' },
  })
  return caseId
}

/**
 * The payee's undecided bank_detail case (staff-opened or a shared-account review), newest first. Through SQL
 * pay_pending_bank_review: the self policy hides staff-opened cases (no payload.participant_id) from a portal transaction.
 */
async function pendingReview(tx: Tx, participantId: string): Promise<{ case_id: string; created_at: Date } | null> {
  const { rows } = await tx.query<{ case_id: string; created_at: Date }>('SELECT case_id, created_at FROM pay_pending_bank_review($1)', [participantId])
  return rows[0] ?? null
}

interface VersionRow {
  readonly masked: string
  readonly scheme: string
  readonly created_via: string
  readonly created_at: Date
  readonly cooling_off_until: Date
  readonly superseded_at: Date | null
}

interface NewDetails {
  readonly details: BankDetails
  readonly fingerprint: Buffer
  readonly masked: string
}

/** The new current version from the payee's own request: the previous one superseded now. */
async function selfVersion(tx: Tx, participantId: string, requestId: string, input: NewDetails, hours: number, secretKey: Buffer) {
  const { rows: previous } = await tx.query<{ id: string; masked: string }>(
    'SELECT id, masked FROM bank_detail_version WHERE participant_id = $1 AND superseded_at IS NULL FOR UPDATE', [participantId])
  if (previous[0] !== undefined) await tx.query('UPDATE bank_detail_version SET superseded_at = now() WHERE id = $1', [previous[0].id])
  const versionId = randomUUID()
  const { rows } = await tx.query<{ cooling_off_until: Date }>(
    `INSERT INTO bank_detail_version (id, tenant_id, participant_id, scheme, details_sealed, fingerprint, masked, created_via, request_id,
       cooling_off_until)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, 'self', $7, now() + make_interval(hours => $8)) RETURNING cooling_off_until`,
    [versionId, participantId, input.details.scheme, seal(secretKey, JSON.stringify(input.details), bankVersionContext(versionId)),
      input.fingerprint, input.masked, requestId, hours],
  )
  return { versionId, previousMasked: previous[0]?.masked ?? null, until: rows[0]!.cooling_off_until }
}

export function registerSelfBankDetailRoutes(app: FastifyInstance): void {
  const { secretKey } = app.config
  const portal = { preHandler: [requirePortal()] }

  app.get('/v1/me/bank-details', portal, async (request) => {
    const participantId = currentAuth(request).participantId!
    return envelope(await inPortal(request, async (tx) => {
      const { rows } = await tx.query<VersionRow>(
        `SELECT masked, scheme, created_via, created_at, cooling_off_until, superseded_at FROM bank_detail_version
         WHERE participant_id = $1 ORDER BY created_at DESC, id`,
        [participantId],
      )
      // What a batch prepared during the cooling-off would skip (D-B5-12): the payable per market.
      const { rows: owed } = await tx.query(
        `SELECT m.code AS market_code, m.currency, m.minor_unit, led_balance(a.market_id, a.payee_participant_id, 'payee_payable')::text AS payable_minor
         FROM ledger_account a JOIN market m ON m.id = a.market_id
         WHERE a.payee_participant_id = $1 AND a.type = 'payee_payable' ORDER BY m.code`,
        [participantId],
      )
      const current = rows.find((row) => row.superseded_at === null)
      return {
        current: current === undefined ? null : (({ superseded_at: _superseded, ...view }) => view)(current),
        pending_review: await pendingReview(tx, participantId),
        history: rows.filter((row) => row.superseded_at !== null)
          .map(({ masked, created_via, created_at, superseded_at }) => ({ masked, created_via, created_at, superseded_at })),
        owed,
      }
    }))
  })

  // A terminated payee may still change its account (D-B5-06): it can be owed money or have a returned payment.
  app.put('/v1/me/bank-details', portal, async (request, reply) => {
    assertStepUp(request)
    const auth = currentAuth(request)
    const participantId = auth.participantId!
    const parsed = BankDetails.safeParse(request.body)
    if (!parsed.success) throw invalid(parsed.error.issues[0]!.path.join('.') || 'scheme')
    const details = parsed.data
    // The Idempotency-Key hash is unkeyed SHA-256: it gets a keyed digest of the details, never the details themselves.
    request.body = { digest: createHmac('sha256', secretKey).update(`bank-self:${auth.tenantId}:${participantId}:${JSON.stringify(details)}`).digest('hex') }
    const result = await inPortal(request, (tx) => idempotent(tx, request, async () => {
      const hours = await getSetting(tx, COOLING_OFF)
      if (hours === null) throw notConfigured(COOLING_OFF)
      // One change per payee at a time: two would each supersede the same current version.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('bank_detail_version:' || $1::text, 0))`, [participantId])
      // An undecided review would later supersede this newer choice with its older request: decide it first.
      const review = await pendingReview(tx, participantId)
      if (review !== null) {
        throw new ApiError(409, 'BANK_DETAIL_REVIEW_PENDING', 'A review of your earlier bank details is still open: wait for its outcome.', { case_id: review.case_id })
      }
      const input = { details, fingerprint: bankFingerprint(secretKey, auth.tenantId!, details), masked: maskAccount(details) }
      const requestId = randomUUID()
      const { rows: market } = await tx.query<{ market_id: string }>(
        `INSERT INTO bank_detail_request (id, tenant_id, participant_id, scheme, details_sealed, fingerprint, masked, created_by)
         VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, app_user_id())
         RETURNING (SELECT market_id FROM participant WHERE id = $2) AS market_id`,
        [requestId, participantId, details.scheme, seal(secretKey, JSON.stringify(details), bankRequestContext(requestId)), input.fingerprint, input.masked],
      )
      await recordAudit(tx, {
        action: 'BANK_DETAIL.REQUESTED', objectType: 'bank_detail_request', objectId: requestId,
        after: { participant_id: participantId, scheme: details.scheme, masked: input.masked, created_via: 'self' },
      })
      const threshold = await getSetting(tx, 'payouts.shared_account_threshold')
      if (threshold !== null) {
        const { rows } = await tx.query<{ n: number }>('SELECT pay_shared_fingerprint_count($1, $2) AS n', [participantId, input.fingerprint])
        if (rows[0]!.n >= threshold) {
          const caseId = await openSharedAccountReview(tx, participantId, market[0]!.market_id, requestId)
          return { statusCode: 202, body: envelope({ state: 'review_required', case_id: caseId }) }
        }
      }
      const created = await selfVersion(tx, participantId, requestId, input, hours, secretKey)
      await recordAudit(tx, {
        action: 'BANK_DETAIL.CHANGED', objectType: 'bank_detail_version', objectId: created.versionId,
        before: created.previousMasked === null ? null : { masked: created.previousMasked },
        after: {
          participant_id: participantId, request_id: requestId, masked: input.masked, created_via: 'self',
          cooling_off_until: created.until, shared_check: threshold === null ? 'not_configured' : 'below_threshold',
        },
      })
      await notifyBankDetailChanged(tx, participantId, created.versionId, input.masked, created.previousMasked, created.until)
      return { statusCode: 201, body: envelope({ state: 'pending_cooling_off', until: created.until }) }
    }))
    return sendIdempotent(reply, result)
  })
}
