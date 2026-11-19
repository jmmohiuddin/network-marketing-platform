import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requireAnyPermission, requirePermission, requireRealm, scopeOfAny } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { getSetting } from '../ten/index.js'
import { notConfigured } from './selection.js'

const idParams = z.object({ id: z.uuid() })
const holdsQuery = z.strictObject({ active: z.enum(['true', 'false']).optional() })
const placeBody = z.strictObject({ market_id: z.uuid(), reason: z.string().max(500).optional() })
const releaseBody = z.strictObject({ reason: z.string().max(500).optional() })
const dormantQuery = z.strictObject({ market_id: z.uuid().optional(), ...pageQuery })

/** AC-PAY7-1: a hold or release without a reason is 422 VALIDATION_FAILED (not a malformed request). */
function requiredReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? ''
  if (trimmed === '') {
    throw new ApiError(422, 'VALIDATION_FAILED', 'reason is required.', { issues: [{ path: 'reason', message: 'is required' }] })
  }
  return trimmed
}

const HOLD_VIEW = `
  SELECT h.id, jsonb_build_object('id', m.id, 'code', m.code) AS market, h.reason,
         jsonb_build_object('id', pu.id, 'display_name', pu.display_name) AS placed_by, h.placed_at,
         CASE WHEN ru.id IS NOT NULL THEN jsonb_build_object('id', ru.id, 'display_name', ru.display_name) END AS released_by,
         h.released_at, h.release_reason
  FROM payout_hold h JOIN market m ON m.id = h.market_id JOIN user_account pu ON pu.id = h.placed_by
  LEFT JOIN user_account ru ON ru.id = h.released_by`

/** FR-PAY-007 holds (dated events with reason, owner and release) and the dormant-balance report. */
export function registerHoldRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')

  app.get('/v1/payees/:id/holds', { preHandler: [tenant, requireAnyPermission('payout.read', 'participant.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const { active } = parse(holdsQuery, request.query)
    const scope = scopeOfAny(currentAuth(request), ['payout.read', 'participant.read'])
    return envelope(await inTenant(request, async (tx) => {
      // 404 unless the participant's market or one of its holds is in scope: an empty list would confirm it exists.
      const { rows: visible } = await tx.query<{ visible: boolean }>(
        `SELECT $2::uuid[] IS NULL OR p.market_id = ANY ($2)
                OR EXISTS (SELECT 1 FROM payout_hold h WHERE h.participant_id = p.id AND h.market_id = ANY ($2)) AS visible
         FROM participant p WHERE p.id = $1`,
        [id, scope],
      )
      if (visible[0]?.visible !== true) throw notFound()
      const { rows } = await tx.query(
        `${HOLD_VIEW} WHERE h.participant_id = $1 AND ($2::uuid[] IS NULL OR h.market_id = ANY ($2))
           AND ($3::boolean IS NULL OR (h.released_at IS NULL) = $3) ORDER BY h.placed_at DESC, h.id`,
        [id, scope, active === undefined ? null : active === 'true'],
      )
      return rows
    }))
  })

  app.post('/v1/payees/:id/holds', { preHandler: [tenant, requirePermission('payout.hold')] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(placeBody, request.body)
    const reason = requiredReason(body.reason)
    const scope = marketScope(currentAuth(request), 'payout.hold')
    if (scope !== null && !scope.includes(body.market_id)) {
      throw new ApiError(403, 'SCOPE_NOT_HELD', 'Your payout.hold permission does not cover this market.', { permission: 'payout.hold' })
    }
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { rowCount } = await tx.query('SELECT 1 FROM participant WHERE id = $1', [id])
      if (rowCount === 0) throw notFound()
      const { rowCount: markets } = await tx.query('SELECT 1 FROM market WHERE id = $1', [body.market_id])
      if (markets === 0) {
        throw new ApiError(422, 'VALIDATION_FAILED', 'market_id is not valid: no such market.', { issues: [{ path: 'market_id', message: 'no such market' }] })
      }
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO payout_hold (tenant_id, participant_id, market_id, reason, placed_by) VALUES (app_tenant_id(), $1, $2, $3, app_user_id()) RETURNING id`,
        [id, body.market_id, reason],
      )
      const holdId = rows[0]!.id
      await recordAudit(tx, { action: 'PAYOUT.HOLD_PLACED', objectType: 'payout_hold', objectId: holdId, after: { participant_id: id, market_id: body.market_id }, reason })
      return { statusCode: 201, body: envelope((await tx.query(`${HOLD_VIEW} WHERE h.id = $1`, [holdId])).rows[0]) }
    }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/payout-holds/:id/release', { preHandler: [tenant, requirePermission('payout.hold')] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const reason = requiredReason(parse(releaseBody, request.body).reason)
    const auth = currentAuth(request)
    const scope = marketScope(auth, 'payout.hold')
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      const { rows } = await tx.query<{ market_id: string; released_at: Date | null }>(
        'SELECT market_id, released_at FROM payout_hold WHERE id = $1 FOR UPDATE', [id])
      const hold = rows[0]
      if (hold === undefined || (scope !== null && !scope.includes(hold.market_id))) throw notFound()
      if (hold.released_at !== null) throw new ApiError(409, 'HOLD_RELEASED', 'This hold is already released.')
      // Separation of duties: a hold restrains whoever prepares payouts, so they never lift it (DB backstop in 0412).
      const prepareScope = marketScope(auth, 'payout.prepare')
      if (prepareScope === null || prepareScope.includes(hold.market_id)) {
        throw new ApiError(403, 'RELEASER_NOT_INDEPENDENT', 'You prepare payouts in this market, so you cannot release its payout holds: a compliance holder of payout.hold releases it.')
      }
      await tx.query('UPDATE payout_hold SET released_by = app_user_id(), released_at = now(), release_reason = $2 WHERE id = $1', [id, reason])
      await recordAudit(tx, { action: 'PAYOUT.HOLD_RELEASED', objectType: 'payout_hold', objectId: id, before: { released: false }, after: { released: true }, reason })
      return { statusCode: 200, body: envelope((await tx.query(`${HOLD_VIEW} WHERE h.id = $1`, [id])).rows[0]) }
    }))
    return sendIdempotent(reply, result)
  })

  // AC-PAY7-2: payables older than payouts.dormant_after_days with no settled instruction since they arose: dated from
  // the start of the payable's current positive streak (as led_receivables dates receivables). A payout that came back
  // (returned or failed: posting #2 and its reversal #4) is left out, so a return does not restart the date.
  app.get('/v1/payouts/dormant', { preHandler: [tenant, requireAnyPermission('payout.read', 'ledger.read')] }, async (request) => {
    const query = parse(dormantQuery, request.query)
    const after = decodeCursor(query.cursor, z.tuple([z.uuid(), z.uuid()]))
    const scope = scopeOfAny(currentAuth(request), ['payout.read', 'ledger.read'])
    const rows = await inTenant(request, async (tx) => {
      const days = await getSetting(tx, 'payouts.dormant_after_days')
      if (days === null) throw notConfigured('payouts.dormant_after_days')
      const { rows: dormant } = await tx.query<{ market_id: string; participant_id: string }>(
        `WITH payables AS (
           SELECT a.market_id, a.payee_participant_id AS participant_id, led_balance(a.market_id, a.payee_participant_id, 'payee_payable') AS payable,
                  (SELECT max(i.terminal_at) FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id
                   WHERE b.market_id = a.market_id AND i.payee_participant_id = a.payee_participant_id AND i.state = 'settled') AS last_settled_at, a.id
           FROM ledger_account a
           WHERE a.type = 'payee_payable' AND ($1::uuid[] IS NULL OR a.market_id = ANY ($1)) AND ($2::uuid IS NULL OR a.market_id = $2)
         ), moves AS (
           SELECT x.account_id, e.posted_at, e.id AS entry_id, sum(x.credit_minor - x.debit_minor) AS delta
           FROM payables p JOIN posting x ON x.account_id = p.id JOIN journal_entry e ON e.id = x.entry_id
           WHERE p.payable > 0 AND NOT (e.origin_type = 'payout_instruction' AND EXISTS (
             SELECT 1 FROM payout_instruction i WHERE i.id = e.origin_id AND i.state IN ('returned', 'failed')))
           GROUP BY x.account_id, e.posted_at, e.id
         ), running AS (
           SELECT account_id, posted_at, entry_id, sum(delta) OVER w AS balance FROM moves
           WINDOW w AS (PARTITION BY account_id ORDER BY posted_at, entry_id)
         ), streaks AS (
           SELECT account_id, posted_at, balance, count(*) FILTER (WHERE balance <= 0) OVER w AS resets FROM running
           WINDOW w AS (PARTITION BY account_id ORDER BY posted_at, entry_id)
         ), since AS (
           SELECT account_id, min(posted_at) AS payable_since
           FROM (SELECT *, max(resets) OVER (PARTITION BY account_id) AS last_reset FROM streaks) s
           WHERE resets = last_reset AND balance > 0 GROUP BY account_id
         ), dated AS (
           SELECT p.*, s.payable_since FROM payables p JOIN since s ON s.account_id = p.id WHERE p.payable > 0
         )
         SELECT d.market_id, d.participant_id,
                (SELECT jsonb_build_object('id', x.id, 'external_ref', x.external_ref, 'display_name', x.display_name) FROM participant x WHERE x.id = d.participant_id) AS participant,
                d.payable::text AS payable_minor, d.payable_since, d.last_settled_at
         FROM dated d
         WHERE d.payable_since < now() - make_interval(days => $3) AND ($4::uuid IS NULL OR (d.market_id, d.participant_id) > ($4, $5::uuid))
         ORDER BY d.market_id, d.participant_id LIMIT $6`,
        [scope, query.market_id ?? null, days, after?.[0] ?? null, after?.[1] ?? null, query.limit + 1],
      )
      return dormant
    })
    return toPage(rows, query.limit, (row) => [row.market_id, row.participant_id])
  })
}
