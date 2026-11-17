import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { decodeCursor, pageQuery, toPage } from '../../lib/pagination.js'
import { callerScope, participantsWrite, sqlCall } from '../par/index.js'
import { inScope } from '../ten/index.js'

// API-35 (PLAN B2 2.3): one servicer at a time per customer, effective-dated; position null = the company.
const MANAGE = 'servicing.manage'
const READ = 'participant.read'
const id = z.guid()

const servicingBody = z.strictObject({
  position_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/).nullable().describe('null = the company services the customer'),
  valid_from: z.iso.datetime({ offset: true }).optional().describe('Default now; never in the past'),
  reason: z.string().trim().min(1).max(500),
})
const servicingResponse = z.object({
  servicing: z.object({ position_id: id.nullable(), source: z.literal('manual'), valid_from: z.iso.datetime() }),
})

/** PLAN B2 4.1: the key-open servicing schemas for the OpenAPI document. */
export const publicServicingSchemas = { servicingBody, servicingResponse }

const idParams = z.object({ id: z.uuid() })
const customersQuery = z.strictObject(pageQuery)

async function marketOf(tx: Tx, table: 'participant' | 'position', rowId: string, scope: readonly string[] | null): Promise<void> {
  const { rows } = await tx.query<{ market_id: string }>(`SELECT market_id FROM ${table} WHERE id = $1`, [rowId])
  if (rows[0] === undefined || !inScope(scope, rows[0].market_id)) throw notFound()
}

async function servicerId(tx: Tx, positionRef: string | null): Promise<string | null> {
  if (positionRef === null) return null
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM position WHERE position_ref = $1', [positionRef])
  if (rows[0] === undefined) throw new ApiError(422, 'SERVICER_NOT_ELIGIBLE', 'No position has this reference.')
  return rows[0].id
}

/** C1 with source manual; C1 refuses a row starting at or before the current one (a pending future change) with 23514. */
async function setServicer(tx: Tx, customerId: string, positionId: string | null, at: Date, reason: string): Promise<string> {
  try {
    const { rows } = await sqlCall(() => tx.query<{ id: string }>(
      `SELECT crm_set_servicer($1, $2, 'manual', $3, NULL, $4) AS id`, [customerId, positionId, at, reason],
    ))
    return rows[0]!.id
  } catch (error) {
    if ((error as { code?: unknown }).code === '23514') {
      throw new ApiError(422, 'VALID_FROM_INVALID', 'valid_from must follow the start of the current servicer.')
    }
    throw error
  }
}

/** AC-CRM1-1/2: closes the current servicer at T and opens the new one (C1); past orders keep their attribution. */
async function changeServicer(tx: Tx, customerId: string, body: z.infer<typeof servicingBody>) {
  const { rows: time } = await tx.query<{ at: Date; past: boolean; customer: boolean | null }>(
    `SELECT t.at, t.at < now() AS past, (SELECT counts_as_end_customer FROM par_type_at($2, t.at)) AS customer
     FROM (SELECT coalesce($1::timestamptz, now()) AS at) t`,
    [body.valid_from ?? null, customerId],
  )
  const { at, past, customer } = time[0]!
  if (past) throw new ApiError(422, 'VALID_FROM_INVALID', 'valid_from cannot be in the past.')
  if (customer !== true) throw new ApiError(422, 'NOT_A_CUSTOMER', 'The participant is not an end customer at that date.')
  const positionId = await servicerId(tx, body.position_ref)
  const { rows: current } = await tx.query<{ position_id: string | null }>(
    'SELECT servicing_position_id AS position_id FROM customer_servicing WHERE customer_id = $1 AND valid_to IS NULL', [customerId],
  )
  if (current[0] !== undefined && current[0].position_id === positionId) {
    throw new ApiError(409, 'SERVICER_UNCHANGED', 'This servicer already services the customer.')
  }
  const servicingId = await setServicer(tx, customerId, positionId, at, body.reason)
  await recordAudit(tx, {
    action: 'SERVICING.CHANGED', objectType: 'participant', objectId: customerId,
    before: { position_id: current[0]?.position_id ?? null },
    after: { servicing_id: servicingId, position_id: positionId, source: 'manual', valid_from: at }, reason: body.reason,
  })
  return servicingResponse.parse({ servicing: { position_id: positionId, source: 'manual', valid_from: at.toISOString() } })
}

/** Servicers of the customer, newest first; position null = the company. */
async function servicingHistory(tx: Tx, customerId: string) {
  const { rows } = await tx.query(
    `SELECT CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'position_ref', p.position_ref,
              'owner_name', (SELECT display_name FROM participant WHERE id = gen_owner_at(p.id, now()))) END AS position,
            s.source, s.valid_from, s.valid_to, s.case_id
     FROM customer_servicing s LEFT JOIN position p ON p.id = s.servicing_position_id
     WHERE s.customer_id = $1 ORDER BY s.valid_from DESC, s.id DESC`,
    [customerId],
  )
  return rows
}

/** The customers the position services now, by customer id (cursor = the last id). */
async function currentCustomers(tx: Tx, positionId: string, after: string | undefined, limit: number) {
  const { rows } = await tx.query<{ participant: { id: string } }>(
    `SELECT jsonb_build_object('id', c.id, 'external_ref', c.external_ref, 'display_name', c.display_name) AS participant,
            s.source, s.valid_from
     FROM customer_servicing s JOIN participant c ON c.id = s.customer_id
     WHERE s.servicing_position_id = $1 AND s.valid_from <= now() AND (s.valid_to IS NULL OR s.valid_to > now())
       AND ($2::uuid IS NULL OR c.id > $2)
     ORDER BY c.id LIMIT $3`,
    [positionId, after ?? null, limit + 1],
  )
  return toPage(rows, limit, (row) => row.participant.id)
}

/** PUT /v1/customers/:id/servicing, GET /v1/participants/:id/servicing, GET /v1/positions/:id/customers. */
export function registerServicingRoutes(app: FastifyInstance): void {
  app.put('/v1/customers/:id/servicing', participantsWrite(app, MANAGE), async (request, reply) => {
    const { id: customerId } = parse(idParams, request.params)
    const body = parse(servicingBody, request.body)
    const scope = callerScope(request, MANAGE)
    const result = await inTenant(request, async (tx) => {
      await marketOf(tx, 'participant', customerId, scope)
      return idempotent(tx, request, async () => ({ statusCode: 200, body: envelope(await changeServicer(tx, customerId, body)) }))
    })
    return sendIdempotent(reply, result)
  })

  const read = { preHandler: [requireRealm('tenant'), requirePermission(READ)] }
  app.get('/v1/participants/:id/servicing', read, async (request) => {
    const { id: customerId } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), READ)
    return envelope(await inTenant(request, async (tx) => {
      await marketOf(tx, 'participant', customerId, scope)
      return servicingHistory(tx, customerId)
    }))
  })

  app.get('/v1/positions/:id/customers', read, async (request) => {
    const { id: positionId } = parse(idParams, request.params)
    const { cursor, limit } = parse(customersQuery, request.query)
    const after = decodeCursor(cursor, z.uuid())
    const scope = marketScope(currentAuth(request), READ)
    return inTenant(request, async (tx) => {
      await marketOf(tx, 'position', positionId, scope)
      return currentCustomers(tx, positionId, after, limit)
    })
  })
}
