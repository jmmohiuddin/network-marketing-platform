import type { Tx } from '@nmp/db'
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent, type StoredResponse } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { apiKeyOrSession } from '../iam/index.js'
import { lockLedger, marketInScope } from './ledger.js'
import { timeCursor, timePage } from './routes.js'

// API-23 credit balances, lots and redemptions (PLAN V1-A 2.1, D-V1A-03). Credits are obligations of the tenant settled
// in kind, never cash: a redemption is Dr credit_liability / Cr settled_clearing, taken FIFO from lots not yet due.

type Scope = readonly string[] | null

const positiveMinor = z.string().regex(/^[1-9]\d{0,17}$/, 'must be a positive decimal string of minor units')
const balancesQuery = z.strictObject({
  ...pageQuery, market_id: z.uuid().optional(), credit_type_id: z.uuid().optional(), participant_id: z.uuid().optional(),
})
const lotsQuery = z.strictObject({ participant_id: z.uuid(), credit_type_id: z.uuid(), market_id: z.uuid() })
const redemptionsQuery = z.strictObject({ ...pageQuery, market_id: z.uuid().optional(), participant_id: z.uuid().optional() })
const redeemBody = z.strictObject({
  source_redemption_id: z.string().min(1).max(100),
  participant_external_ref: z.string().regex(/^[\x21-\x7e]{1,100}$/),
  market: z.string().min(1).max(16),
  credit_type: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
  amount_minor: positiveMinor,
  occurred_at: z.iso.datetime({ offset: true }),
  item_class: z.string().min(1).max(50).optional(),
})
type Redeem = z.infer<typeof redeemBody>

// Per (holder, type, market): the liability balance, the lots not yet due and the next of them to expire.
const BALANCE_SELECT = `
  SELECT a.id, a.market_id, a.currency, jsonb_build_object('id', p.id, 'external_ref', p.external_ref) AS participant,
         jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) AS credit_type,
         (SELECT coalesce(sum(x.credit_minor - x.debit_minor), 0) FROM posting x WHERE x.account_id = a.id)::text AS balance_minor,
         l.available::text AS available_minor,
         CASE WHEN l.next_on IS NULL THEN NULL
              ELSE jsonb_build_object('on', l.next_on, 'amount_minor', l.next_amount::text) END AS next_expiry
  FROM ledger_account a JOIN participant p ON p.id = a.payee_participant_id JOIN credit_type t ON t.id = a.credit_type_id
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(c.remaining_minor), 0) AS available, min(c.expires_on) AS next_on,
           sum(c.remaining_minor) FILTER (WHERE c.soonest) AS next_amount
    FROM (SELECT d.remaining_minor, d.expires_on, d.expires_on = min(d.expires_on) OVER () AS soonest
          FROM credit_lots(a.payee_participant_id, a.credit_type_id, a.market_id) d
          WHERE d.remaining_minor > 0 AND (d.expires_at IS NULL OR d.expires_at > now())) c) l
  WHERE a.type = 'credit_liability' AND ($1::uuid[] IS NULL OR a.market_id = ANY ($1)) AND ($2::uuid IS NULL OR a.market_id = $2)
    AND ($3::uuid IS NULL OR a.credit_type_id = $3) AND ($4::uuid IS NULL OR a.payee_participant_id = $4)`

async function balances(tx: Tx, scope: Scope, q: z.infer<typeof balancesQuery>, after: string | undefined) {
  if (q.market_id !== undefined) await marketInScope(tx, q.market_id, scope)
  const filter = [scope, q.market_id ?? null, q.credit_type_id ?? null, q.participant_id ?? null]
  const { rows } = await tx.query<{ id: string; currency: string; balance_minor: string; available_minor: string }>(
    `${BALANCE_SELECT} AND ($5::uuid IS NULL OR a.id > $5) ORDER BY a.id LIMIT $6`, [...filter, after ?? null, q.limit + 1],
  )
  const { rows: totals } = await tx.query(
    `SELECT b.currency, sum(b.balance_minor::bigint)::text AS balance_minor, sum(b.available_minor::bigint)::text AS available_minor
     FROM (${BALANCE_SELECT}) b GROUP BY b.currency ORDER BY b.currency`, filter,
  )
  const page = toPage(rows, q.limit, (row) => row.id)
  return envelope(page.data.map(({ id: _id, ...row }) => row), { ...page.meta, totals })
}

async function lots(tx: Tx, scope: Scope, q: z.infer<typeof lotsQuery>) {
  await marketInScope(tx, q.market_id, scope)
  const { rows: found } = await tx.query(
    'SELECT 1 FROM participant p, credit_type t WHERE p.id = $1 AND t.id = $2', [q.participant_id, q.credit_type_id],
  )
  if (found.length === 0) throw notFound()
  const { rows } = await tx.query(
    `SELECT l.award_id, l.run_id, l.committed_at, to_char(l.expires_on, 'YYYY-MM-DD') AS expires_on, l.amount_minor::text, l.remaining_minor::text,
            (SELECT e.created_at FROM credit_lot_event e WHERE e.award_id = l.award_id AND e.kind = 'notified') AS notified_at,
            (SELECT e.created_at FROM credit_lot_event e WHERE e.award_id = l.award_id AND e.kind = 'expired') AS expired_at
     FROM credit_lots($1, $2, $3) l ORDER BY l.expires_on NULLS LAST, l.committed_at, l.award_id`,
    [q.participant_id, q.credit_type_id, q.market_id],
  )
  return envelope(rows)
}

const REDEMPTION_SELECT = `
  SELECT x.id, jsonb_build_object('id', p.id, 'external_ref', p.external_ref) AS participant,
         jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name) AS credit_type, x.market_id, x.amount_minor::text, x.currency,
         x.item_class, x.occurred_at, x.source_system, x.source_redemption_id, e.id AS entry_id, x.created_at::text AS at
  FROM credit_redemption x JOIN participant p ON p.id = x.participant_id JOIN credit_type t ON t.id = x.credit_type_id
  LEFT JOIN journal_entry e ON e.idempotency_key = 'credit-redeem:' || x.id`

async function redemptions(tx: Tx, scope: Scope, q: z.infer<typeof redemptionsQuery>, after: z.infer<typeof timeCursor> | undefined) {
  if (q.market_id !== undefined) await marketInScope(tx, q.market_id, scope)
  const { rows } = await tx.query<{ at: string; id: string }>(
    `${REDEMPTION_SELECT}
     WHERE ($1::uuid[] IS NULL OR x.market_id = ANY ($1)) AND ($2::uuid IS NULL OR x.market_id = $2) AND ($3::uuid IS NULL OR x.participant_id = $3)
       AND ($4::timestamptz IS NULL OR (x.created_at, x.id) < ($4, $5::uuid))
     ORDER BY x.created_at DESC, x.id DESC LIMIT $6`,
    [scope, q.market_id ?? null, q.participant_id ?? null, after?.at ?? null, after?.id ?? null, q.limit + 1],
  )
  return timePage(rows, q.limit)
}

const refuse = (code: string, message: string, details: unknown = null) => new ApiError(422, code, message, details)

/** The holder's lots not yet due, and what lots already expired held (to tell CREDIT_EXPIRED from CREDIT_INSUFFICIENT). */
async function lotTotals(tx: Tx, participantId: string, typeId: string, marketId: string): Promise<{ available: bigint; expired: bigint }> {
  const { rows } = await tx.query<{ available: string; expired: string }>(
    `SELECT (SELECT coalesce(sum(l.remaining_minor), 0) FROM credit_lots($1, $2, $3) l
             WHERE l.expires_at IS NULL OR l.expires_at > now())::text AS available,
            (SELECT coalesce(sum(e.amount_minor), 0) FROM credit_lot_event e JOIN credit_award a ON a.id = e.award_id
             WHERE e.kind = 'expired' AND a.payee_participant_id = $1 AND a.credit_type_id = $2 AND a.market_id = $3)::text AS expired`,
    [participantId, typeId, marketId],
  )
  return { available: BigInt(rows[0]!.available), expired: BigInt(rows[0]!.expired) }
}

async function redemptionView(tx: Tx, id: string): Promise<Record<string, unknown>> {
  const { rows } = await tx.query<{ id: string; amount_minor: string; currency: string; entry_id: string; participant_id: string; credit_type_id: string; market_id: string }>(
    `SELECT x.id, x.amount_minor::text, x.currency, e.id AS entry_id, x.participant_id, x.credit_type_id, x.market_id
     FROM credit_redemption x JOIN journal_entry e ON e.idempotency_key = 'credit-redeem:' || x.id WHERE x.id = $1`, [id],
  )
  const { participant_id: participantId, credit_type_id: typeId, market_id: marketId, ...view } = rows[0]!
  const { available } = await lotTotals(tx, participantId, typeId, marketId)
  return { ...view, available_after_minor: available.toString() }
}

/** The same source redemption id again is the first redemption (200), never a second posting; other facts are a conflict. */
async function existingRedemption(tx: Tx, sourceSystem: string, body: Redeem, marketId: string): Promise<StoredResponse | null> {
  const { rows } = await tx.query<{ id: string; same: boolean }>(
    `SELECT x.id, (x.market_id = $3 AND p.external_ref = $4 AND t.code = $5 AND x.amount_minor = $6::bigint
                   AND x.item_class IS NOT DISTINCT FROM $7) AS same
     FROM credit_redemption x JOIN participant p ON p.id = x.participant_id JOIN credit_type t ON t.id = x.credit_type_id
     WHERE x.source_system = $1 AND x.source_redemption_id = $2`,
    [sourceSystem, body.source_redemption_id, marketId, body.participant_external_ref, body.credit_type, body.amount_minor, body.item_class ?? null],
  )
  const existing = rows[0]
  if (existing === undefined) return null
  if (!existing.same) {
    throw new ApiError(409, 'REDEMPTION_CONFLICT', 'This redemption was already recorded with other facts.', { redemption_id: existing.id })
  }
  return { statusCode: 200, body: envelope({ redemption: await redemptionView(tx, existing.id), replayed: true }) }
}

async function scopedType(tx: Tx, body: Redeem, marketId: string): Promise<string> {
  const { rows } = await tx.query<{ id: string; redemption_scope: { markets?: string[]; item_classes?: string[] } | null }>(
    'SELECT id, redemption_scope FROM credit_type WHERE code = $1', [body.credit_type],
  )
  const type = rows[0]
  if (type === undefined) throw refuse('CREDIT_TYPE_UNKNOWN', 'No credit type has this code.', { credit_type: body.credit_type })
  const { markets, item_classes: itemClasses } = type.redemption_scope ?? {}
  if ((markets !== undefined && !markets.includes(marketId))
      || (itemClasses !== undefined && (body.item_class === undefined || !itemClasses.includes(body.item_class)))) {
    throw refuse('REDEMPTION_OUT_OF_SCOPE', 'These credits cannot be redeemed in this market or for this item class.')
  }
  return type.id
}

/**
 * POST /v1/credit-redemptions in one transaction (PLAN V1-A 2.1): ledger lock first, then due lots expired, the amount
 * checked against the lots not yet due, the redemption row and its entry (the deferred check refuses anything else).
 */
async function redeem(tx: Tx, sourceSystem: string, body: Redeem): Promise<StoredResponse> {
  const { rows: markets } = await tx.query<{ id: string; currency: string }>('SELECT id, currency FROM market WHERE code = $1', [body.market])
  const market = markets[0]
  if (market === undefined) throw refuse('MARKET_NOT_FOUND', 'No market has this code.', { market: body.market })
  await lockLedger(tx, market.id)
  const replay = await existingRedemption(tx, sourceSystem, body, market.id)
  if (replay !== null) return replay
  const { rows: holders } = await tx.query<{ id: string }>('SELECT id FROM participant WHERE external_ref = $1', [body.participant_external_ref])
  if (holders[0] === undefined) throw refuse('PARTICIPANT_NOT_FOUND', 'No participant has this external reference.')
  const participantId = holders[0].id
  const typeId = await scopedType(tx, body, market.id)
  const { rows: period } = await tx.query<{ id: string | null }>('SELECT led_attribution_period($1) AS id', [market.id])
  if (period[0]!.id === null) throw refuse('NO_COMMITTED_PERIOD', 'The market has no committed or paid period open to post the redemption to.')
  await tx.query('SELECT credit_expire_due($1, $2, $3)', [participantId, typeId, market.id])
  const amount = BigInt(body.amount_minor)
  const { available, expired } = await lotTotals(tx, participantId, typeId, market.id)
  if (amount > available) {
    const details = { available_minor: available.toString() }
    throw amount <= available + expired
      ? refuse('CREDIT_EXPIRED', 'Part of these credits expired: the credits not yet expired do not cover the amount.', details)
      : refuse('CREDIT_INSUFFICIENT', 'The amount is above the credits owed.', details)
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO credit_redemption (tenant_id, market_id, participant_id, credit_type_id, amount_minor, currency, source_system,
       source_redemption_id, item_class, occurred_at)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [market.id, participantId, typeId, body.amount_minor, market.currency, sourceSystem, body.source_redemption_id, body.item_class ?? null,
      body.occurred_at],
  )
  const id = rows[0]!.id
  const { rows: entry } = await tx.query<{ id: string }>(
    `SELECT ledger_post($1, $2, 'credit_redeemed', 'credit_redemption', $3::uuid, 'credit-redeem:' || $3::uuid::text, NULL, $4) AS id`,
    [market.id, period[0]!.id, id, JSON.stringify([
      { type: 'credit_liability', payee_participant_id: participantId, credit_type_id: typeId, debit_minor: body.amount_minor, credit_minor: '0' },
      { type: 'settled_clearing', debit_minor: '0', credit_minor: body.amount_minor },
    ])],
  )
  await recordAudit(tx, {
    action: 'CREDIT.REDEEMED', objectType: 'credit_redemption', objectId: id,
    after: { market_id: market.id, participant_id: participantId, credit_type_id: typeId, amount_minor: body.amount_minor, entry_id: entry[0]!.id },
  })
  return { statusCode: 201, body: envelope({ redemption: await redemptionView(tx, id) }) }
}

/** Redemptions come from the store or fulfilment system by API key only (scope credits:write). */
const keyRequired: preHandlerAsyncHookHandler = async (request) => {
  currentAuth(request)
  throw new ApiError(403, 'API_KEY_REQUIRED', 'This endpoint accepts API keys with the scope credits:write only.')
}

export function registerCreditRoutes(app: FastifyInstance): void {
  const read = { preHandler: [requireRealm('tenant'), requirePermission('credit.read')] }
  const scopeOf = (request: FastifyRequest) => marketScope(currentAuth(request), 'credit.read')

  app.get('/v1/credits/balances', read, async (request) => {
    const query = parse(balancesQuery, request.query)
    return inTenant(request, (tx) => balances(tx, scopeOf(request), query, decodeCursor(query.cursor, z.uuid())))
  })

  app.get('/v1/credits/lots', read, async (request) => {
    const query = parse(lotsQuery, request.query)
    return inTenant(request, (tx) => lots(tx, scopeOf(request), query))
  })

  app.get('/v1/credits/redemptions', read, async (request) => {
    const query = parse(redemptionsQuery, request.query)
    return inTenant(request, (tx) => redemptions(tx, scopeOf(request), query, decodeCursor(query.cursor, timeCursor)))
  })

  app.post('/v1/credit-redemptions', { preHandler: [apiKeyOrSession(app, 'credits:write', keyRequired)], config: { apiKey: true } }, async (request, reply) => {
    const body = parse(redeemBody, request.body)
    const sourceSystem = `api:${request.apiKey!.serviceAccountId}`
    return sendIdempotent(reply, await inTenant(request, (tx) => idempotent(tx, request, () => redeem(tx, sourceSystem, body))))
  })
}
