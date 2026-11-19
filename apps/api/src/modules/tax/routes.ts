import { createHmac, randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { currentAuth, marketScope, requirePermission, requireRealm, requireStepUp } from '../../lib/auth.js'
import { inTenant } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope, parse } from '../../lib/http.js'
import { idempotent, sendIdempotent } from '../../lib/idempotency.js'
import { open, seal } from '../../lib/secret-box.js'

// D-B4-17: a PUT closes the current version now and starts the next one; fields not sent carry over, so a tax id given
// later applies from then on, never retroactively. shortcut: generic tax-id format, market-pack formats in B-MKT.

const idParams = z.object({ id: z.uuid() })
const putBody = z.strictObject({
  residency: z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code').optional(),
  entity_type: z.enum(['individual', 'company', 'partnership', 'other']).optional(),
  tax_id: z.string().max(100).optional(),
})

const TAX_ID = /^[A-Z0-9-]{4,32}$/
const context = (versionId: string) => `tax_profile:${versionId}`
const masked = (taxId: string) => `•••• ${taxId.slice(-4)}`

interface Version {
  id: string
  residency: string | null
  entity_type: string | null
  tax_id_sealed: string | null
  tax_id_masked: string | null
  valid_from: Date
  valid_to: Date | null
}

async function versions(tx: Tx, participantId: string, scope: readonly string[] | null): Promise<Version[]> {
  const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM participant WHERE id = $1', [participantId])
  if (rows[0] === undefined || (scope !== null && !scope.includes(rows[0].market_id))) throw notFound()
  const { rows: found } = await tx.query<Version>(
    `SELECT id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, valid_to FROM tax_profile
     WHERE participant_id = $1 ORDER BY valid_from DESC`,
    [participantId],
  )
  return found
}

const view = ({ tax_id_sealed: _sealed, ...rest }: Version) => rest
const isCurrent = (v: Version) => v.valid_to === null || v.valid_to > new Date()

export function registerTaxProfileRoutes(app: FastifyInstance): void {
  const tenant = requireRealm('tenant')
  const { secretKey } = app.config

  app.get('/v1/participants/:id/tax-profile', { preHandler: [tenant, requirePermission('participant.read')] }, async (request) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'participant.read')
    const all = await inTenant(request, (tx) => versions(tx, id, scope))
    const current = all.find(isCurrent)
    return envelope({ current: current === undefined ? null : view(current), history: all.filter((v) => v !== current).map(view) })
  })

  app.put('/v1/participants/:id/tax-profile', { preHandler: [tenant, requirePermission('tax.manage'), requireStepUp()] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const body = parse(putBody, request.body)
    if (Object.keys(body).length === 0) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Send at least one of residency, entity_type, tax_id.', { issues: [{ path: '', message: 'nothing to change' }] })
    }
    const taxId = body.tax_id === undefined ? undefined : body.tax_id.replace(/\s+/g, '').toUpperCase()
    if (taxId !== undefined && !TAX_ID.test(taxId)) {
      throw new ApiError(422, 'TAX_ID_FORMAT', 'The tax id must be 4 to 32 letters, digits or hyphens.')
    }
    const auth = currentAuth(request)
    // The Idempotency-Key hash is unkeyed SHA-256: it gets a keyed digest of the tax id, never the tax id itself.
    if (taxId !== undefined) request.body = { ...body, tax_id: createHmac('sha256', secretKey).update(`tax:${auth.tenantId}:${taxId}`).digest('hex') }
    const scope = marketScope(auth, 'tax.manage')
    const result = await inTenant(request, (tx) => idempotent(tx, request, async () => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('tax_profile:' || app_tenant_id() || ':' || $1::text, 0))`, [id])
      // clock_timestamp, not now(): a PUT that waited here began before the version it closes was written (now() is that start).
      const { rows: clock } = await tx.query<{ at: string }>('SELECT clock_timestamp()::text AS at') // text keeps the microseconds
      const at = clock[0]!.at
      const previous = (await versions(tx, id, scope)).find((v) => v.valid_to === null)
      const versionId = randomUUID()
      const sealed = taxId !== undefined
        ? seal(secretKey, taxId, context(versionId))
        : previous?.tax_id_sealed == null ? null : seal(secretKey, open(secretKey, previous.tax_id_sealed, context(previous.id)), context(versionId))
      const mask = taxId !== undefined ? masked(taxId) : previous?.tax_id_masked ?? null
      if (previous !== undefined) await tx.query('UPDATE tax_profile SET valid_to = $2::timestamptz WHERE id = $1', [previous.id, at])
      const { rows } = await tx.query<Version>(
        `INSERT INTO tax_profile (id, tenant_id, participant_id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, created_by)
         VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, $7::timestamptz, app_user_id())
         RETURNING id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, valid_to`,
        [versionId, id, body.residency ?? previous?.residency ?? null, body.entity_type ?? previous?.entity_type ?? null, sealed, mask, at],
      )
      await recordAudit(tx, {
        action: 'TAX_PROFILE.VERSION_CREATED', objectType: 'tax_profile', objectId: versionId,
        after: { participant_id: id, previous_id: previous?.id ?? null, fields: Object.keys(body).sort(), tax_id_masked: mask },
      })
      return { statusCode: 200, body: envelope(view(rows[0]!)) }
    }))
    return sendIdempotent(reply, result)
  })

  app.post('/v1/participants/:id/tax-profile/unmask', { preHandler: [tenant, requirePermission('participant.unmask'), requireStepUp()] }, async (request, reply) => {
    const { id } = parse(idParams, request.params)
    const scope = marketScope(currentAuth(request), 'participant.unmask')
    const taxId = await inTenant(request, async (tx) => {
      const current = (await versions(tx, id, scope)).find(isCurrent)
      if (current?.tax_id_sealed == null) throw notFound()
      await recordAudit(tx, { action: 'TAX_ID.UNMASKED', objectType: 'tax_profile', objectId: current.id, after: { participant_id: id } })
      return open(secretKey, current.tax_id_sealed, context(current.id))
    })
    reply.header('cache-control', 'no-store')
    return envelope({ tax_id: taxId })
  })
}
