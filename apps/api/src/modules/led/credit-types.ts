import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { requireAllMarkets, requireAnyPermission, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'

// API-23 credit types (PLAN V1-A 2.1, D-V1A-03): tenant-wide, so managed with credit.manage for all markets and step-up.
// No field has a default but active; the code never changes; awards copy the type's terms when they are calculated.

const positiveMinor = z.string().regex(/^[1-9]\d{0,17}$/, 'must be a positive decimal string of minor units')
const uniqueList = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).min(1).max(50).refine((list) => new Set(list).size === list.length, 'each value once')
const scope = z.strictObject({ markets: uniqueList(z.uuid()).optional(), item_classes: uniqueList(z.string().min(1).max(50)).optional() })
  .refine((value) => value.markets !== undefined || value.item_classes !== undefined, 'name markets, item classes or both')
const terms = {
  name: z.string().trim().min(1).max(100),
  unit_value_minor: positiveMinor.nullable(),
  expiry_days: z.number().int().min(1).max(3650).nullable(),
  expiry_notice_days: z.number().int().min(1).max(3650).nullable(),
  redemption_scope: scope.nullable(),
  taxable: z.boolean(),
}
const createBody = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, 'upper-case letters, digits and _, 2-32 characters'),
  ...terms,
  unit_value_minor: terms.unit_value_minor.optional(),
  expiry_days: terms.expiry_days.optional(),
  expiry_notice_days: terms.expiry_notice_days.optional(),
  redemption_scope: terms.redemption_scope.optional(),
})
const patchBody = z.strictObject({ expected_updated_at: z.iso.datetime({ offset: true }), ...z.object(terms).partial().shape, active: z.boolean().optional() })
const listQuery = z.strictObject({ active: z.enum(['true', 'false']).transform((value) => value === 'true').optional() })
const idParams = z.object({ id: z.uuid() })

type Scope = z.infer<typeof scope>
interface Terms {
  readonly expiry_days: number | null
  readonly expiry_notice_days: number | null
  readonly redemption_scope: Scope | null
}

const TYPE_COLUMNS = `id, code, name, unit_value_minor::text AS unit_value_minor, expiry_days, expiry_notice_days, redemption_scope, taxable,
  active, updated_at`

const invalid = (field: string, message: string) => new ApiError(422, 'VALIDATION_FAILED', message, { field })

/** Both expiry fields or neither, the notice within the expiry; scope markets of the tenant (422 MARKET_NOT_FOUND). */
async function assertTerms(tx: Tx, t: Terms): Promise<void> {
  if ((t.expiry_days === null) !== (t.expiry_notice_days === null)) {
    throw invalid(t.expiry_days === null ? 'expiry_days' : 'expiry_notice_days', 'Give the expiry and its notice days together, or neither.')
  }
  if (t.expiry_days !== null && t.expiry_notice_days !== null && t.expiry_notice_days > t.expiry_days) {
    throw invalid('expiry_notice_days', 'The notice cannot come before the credits are awarded.')
  }
  const markets = t.redemption_scope?.markets ?? []
  if (markets.length === 0) return
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM market WHERE id = ANY ($1)', [markets])
  const missing = markets.filter((id) => !rows.some((row) => row.id === id))
  if (missing.length > 0) throw new ApiError(422, 'MARKET_NOT_FOUND', 'The redemption scope names a market that does not exist.', { market_ids: missing })
}

async function createType(tx: Tx, body: z.infer<typeof createBody>): Promise<Record<string, unknown>> {
  const t = { expiry_days: body.expiry_days ?? null, expiry_notice_days: body.expiry_notice_days ?? null, redemption_scope: body.redemption_scope ?? null }
  await assertTerms(tx, t)
  const { rows } = await tx.query(
    `INSERT INTO credit_type (tenant_id, code, name, unit_value_minor, expiry_days, expiry_notice_days, redemption_scope, taxable)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, code) DO NOTHING RETURNING ${TYPE_COLUMNS}`,
    [body.code, body.name, body.unit_value_minor ?? null, t.expiry_days, t.expiry_notice_days, t.redemption_scope, body.taxable],
  )
  const created = rows[0]
  if (created === undefined) throw new ApiError(409, 'CODE_TAKEN', 'A credit type with this code exists already.', { code: body.code })
  await recordAudit(tx, { action: 'CREDIT_TYPE.CREATED', objectType: 'credit_type', objectId: created.id as string, after: created })
  return created
}

async function updateType(tx: Tx, id: string, body: z.infer<typeof patchBody>): Promise<Record<string, unknown>> {
  const { rows } = await tx.query(`SELECT ${TYPE_COLUMNS}, date_trunc('milliseconds', updated_at) = $2::timestamptz AS current
    FROM credit_type WHERE id = $1 FOR UPDATE`, [id, body.expected_updated_at])
  if (rows[0] === undefined) throw notFound()
  const { current, ...before } = rows[0]
  if (current !== true) {
    throw new ApiError(409, 'STALE_VERSION', 'The credit type changed since you loaded it: reload and apply your change again.', { updated_at: before.updated_at })
  }
  const { expected_updated_at: _expected, ...changes } = body
  const next = { ...before, ...changes } as Record<string, unknown> & Terms
  await assertTerms(tx, next)
  const { rows: updated } = await tx.query(
    `UPDATE credit_type SET name = $2, unit_value_minor = $3, expiry_days = $4, expiry_notice_days = $5, redemption_scope = $6, taxable = $7,
       active = $8, updated_by = app_user_id(), updated_at = date_trunc('milliseconds', clock_timestamp())
     WHERE id = $1 RETURNING ${TYPE_COLUMNS}`,
    [id, next.name, next.unit_value_minor, next.expiry_days, next.expiry_notice_days, next.redemption_scope, next.taxable, next.active],
  )
  await recordAudit(tx, { action: 'CREDIT_TYPE.UPDATED', objectType: 'credit_type', objectId: id, before, after: updated[0] })
  return updated[0]!
}

export function registerCreditTypeRoutes(app: FastifyInstance): void {
  const manage = { preHandler: [requireRealm('tenant'), requirePermission('credit.manage'), requireAllMarkets('credit.manage'), requireStepUp()] }

  // The catalogue is tenant-wide and holds no personal data: credit.read holders and rule editors (SC-04 "Pay in credits") list it.
  app.get('/v1/credit-types', { preHandler: [requireRealm('tenant'), requireAnyPermission('credit.read', 'plan.edit')] }, async (request) => {
    const { active } = parse(listQuery, request.query)
    const { rows } = await inTenant(request, (tx) =>
      tx.query(`SELECT ${TYPE_COLUMNS} FROM credit_type WHERE $1::boolean IS NULL OR active = $1 ORDER BY code`, [active ?? null]))
    return envelope(rows)
  })

  app.post('/v1/credit-types', manage, async (request, reply) => {
    const body = parse(createBody, request.body)
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => ({ statusCode: 201, body: envelope(await createType(tx, body)) })))
    return sendIdempotent(reply, result)
  })

  app.patch('/v1/credit-types/:id', manage, async (request) => {
    const { id } = parse(idParams, request.params)
    const body = parse(patchBody, request.body)
    return envelope(await inTenant(request, (tx) => updateType(tx, id, body)))
  })
}
